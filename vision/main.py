"""Contract v4 API (v3-compatible). Run from root: uvicorn vision.main:app."""
import asyncio
import hmac
import json
import secrets
import sys
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Literal

# Also support the documented `cd vision && uvicorn main:app` invocation.
if not __package__:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    __package__ = 'vision'

from fastapi import APIRouter, Depends, FastAPI, Header, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from pymongo.errors import DuplicateKeyError, PyMongoError
from starlette.concurrency import run_in_threadpool
from .catalog import CATALOG, build_challenges
from .checker import GeminiChecker, MockChecker, unavailable
from .config import ROOT, Settings
from .store import Conflict, MemoryStore, MongoStore
from .scoring import scored_summary
from .listing import GeminiNamer, ListingRequest, parse_listing
from .hedge import hedged
from .suggest import GeminiSuggester, SuggestRequest, TestSpec, catalog_fallback, slug
from .thumbs import UnusableEvidence, prepare_frames, thumbnail


def now():
    return datetime.now(timezone.utc)


class Input(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)


class CreateRequest(Input):
    item_name: str = Field(min_length=1, max_length=200)
    category: Literal['console', 'phone', 'laptop', 'other']
    listing_url: str | None = Field(default=None, max_length=2048)
    # v3: catalog IDs. v4: full test objects (e.g. from /api/tests/suggest). Both may be mixed.
    tests: list[str | TestSpec] = Field(min_length=2, max_length=20)
    custom_test: str | None = Field(default=None, min_length=1, max_length=500)

    @field_validator('listing_url')
    @classmethod
    def valid_url(cls, value):
        if value and not value.startswith(('https://', 'http://')):
            raise ValueError('listing_url must use http or https')
        return value

    @model_validator(mode='after')
    def valid_tests(self):
        ids = {t['id'] for t in CATALOG[self.category]}
        if any(isinstance(t, str) and t not in ids for t in self.tests):
            raise ValueError('Test IDs must come from the selected category')
        for t in self.tests:
            if isinstance(t, TestSpec):
                t.id = slug(t.id)
        keys = [t if isinstance(t, str) else t.id for t in self.tests]
        if len(set(keys)) != len(keys):
            raise ValueError('Tests must be unique')
        return self

    def test_specs(self):
        """Every buyer test as {id,label,prompt,expect}, stored on the request."""
        catalog = {t['id']: t for t in CATALOG[self.category]}
        return [dict(catalog[t]) if isinstance(t, str) else t.model_dump() for t in self.tests]


class CheckRequest(Input):
    request_id: str = Field(min_length=1, max_length=100)
    challenge_id: str = Field(min_length=1, max_length=100)
    attempt: int = Field(ge=1, le=3, strict=True)
    frames: list[str] = Field(min_length=2, max_length=4)


class WatchRequest(Input):
    code: str = Field(pattern=r'^\d{4}$')
    chat_id: str = Field(min_length=1, max_length=200)


def public_view(doc, settings):
    """Allowlist only: internal IDs, watcher IDs and hidden challenges never leak."""
    view = {k: doc.get(k) for k in ('status', 'item_name', 'category', 'listing_url')}
    view['line_number'] = settings.line_number
    if doc.get('test_specs'):
        view['tests'] = [{'id': t['id'], 'label': t['label']} for t in doc['test_specs']]
    else:  # v3 documents
        catalog = {t['id']: t for t in CATALOG[doc['category']]}
        view['tests'] = [{'id': t, 'label': catalog[t]['label']} for t in doc['tests']]
    view['results'] = []
    for row in doc['results']:
        result = {k: row[k] for k in ('prompt', 'kind', 'result', 'confidence', 'reason', 'attempts')}
        result['thumb_url'] = row.get('thumb', '')
        if 'attempt_history' in row:
            result['attempt_history'] = [
                {k: attempt[k] for k in ('attempt', 'result', 'confidence', 'reason')}
                for attempt in row['attempt_history']
            ]
        view['results'].append(result)
    if doc['status'] == 'awaiting_seller':
        view['code'] = doc['code']
    if doc['status'] == 'in_call' and doc.get('current_challenge'):
        view['current_challenge'] = {k: doc['current_challenge'][k] for k in ('prompt', 'attempt')}
    if doc.get('summary'):
        view['summary'] = scored_summary(doc, settings.passing_threshold_percent)
    if doc.get('verified_at'):
        view['verified_at'] = doc['verified_at']
    return view


def create_app(settings=None, store=None, checker=None, suggester=None, namer=None, fetch=None):
    settings = settings or Settings.from_env()

    @asynccontextmanager
    async def lifespan(app):
        if not settings.agent_key:
            raise RuntimeError('Set AGENT_KEY, including in mock mode')
        if not settings.mock and (not settings.mongodb_uri or not settings.gemini_api_key):
            raise RuntimeError('Live mode requires MONGODB_URI and GEMINI_API_KEY; use MOCK=1 for offline work')
        app.state.store = store if store is not None else (MemoryStore() if settings.mock else await run_in_threadpool(MongoStore, settings.mongodb_uri, settings.mongodb_database))
        app.state.checker = checker if checker is not None else (MockChecker(settings.mock_result) if settings.mock else GeminiChecker(settings))
        # Suggestions only need a Gemini key (no frames, no DB), so they work in MOCK=1 too when a key is set.
        app.state.suggester = suggester if suggester is not None else (GeminiSuggester(settings) if settings.gemini_api_key else None)
        # Listing names reuse the suggester's Gemini client (same key, no frames, no DB).
        own_client = getattr(app.state.suggester, 'client', None)
        app.state.namer = namer if namer is not None else (GeminiNamer(own_client, settings.gemini_model, settings.fast_gemini_model) if own_client else None)
        app.state.settings = settings
        if settings.mock and store is None:
            seed_mock(app.state.store)
        try:
            yield
        finally:
            await app.state.checker.close()
            if app.state.suggester is not None and suggester is None:
                await app.state.suggester.close()
            await run_in_threadpool(app.state.store.close)

    app = FastAPI(title='ShowMe Vision', version='5.1', lifespan=lifespan)

    @app.exception_handler(RequestValidationError)
    async def validation_error(request, exc):
        # FastAPI's default includes input values (possibly megabytes of camera data).
        return JSONResponse(status_code=422, content={'detail': [{'loc': list(e['loc']), 'msg': e['msg'], 'type': e['type']} for e in exc.errors()]})

    @app.exception_handler(Conflict)
    async def conflict_error(request, exc):
        return JSONResponse(status_code=409, content={'detail': 'Request changed; reload state before retrying'})

    @app.exception_handler(PyMongoError)
    async def database_error(request, exc):
        return JSONResponse(status_code=503, content={'detail': 'Database unavailable; retry shortly'})

    @app.middleware('http')
    async def private_responses(request, call_next):
        # Bound streaming input before FastAPI parses the JSON, even without Content-Length.
        if request.method == 'POST':
            body = bytearray()
            async for chunk in request.stream():
                body.extend(chunk)
                if len(body) > 12_000_000:
                    return JSONResponse(status_code=413, content={'detail': 'Request body too large'})
            request._body = bytes(body)
        response = await call_next(request)
        response.headers['Cache-Control'] = 'no-store'
        return response

    def storage():
        return app.state.store

    def expire(doc):
        if doc['status'] == 'awaiting_seller' and doc['expires_at'] <= now():
            doc['status'] = 'expired'
            doc.pop('active_code', None)
            storage().save(doc)
        return doc

    def get_doc(request_id):
        doc = storage().get(request_id)
        if not doc:
            raise HTTPException(404, 'Request not found')
        return expire(doc)

    def waiting(code=None):
        storage().expire_waiting(now())
        doc = storage().find_waiting(code)
        if not doc:
            raise HTTPException(404, 'Waiting request not found')
        return doc

    def agent_key(x_agent_key: str | None = Header(default=None)):
        if not x_agent_key or not hmac.compare_digest(x_agent_key.encode(), settings.agent_key.encode()):
            raise HTTPException(401, 'Invalid agent key')

    def link(doc):
        return settings.public_base_url.rstrip('/') + '/v/' + doc['token']

    def require_call(doc):
        if doc['status'] != 'in_call':
            raise HTTPException(409, 'Request must be in_call')

    @app.get('/api/health')
    def health():
        return {'ok': True, 'mode': 'mock' if settings.mock else 'live'}

    @app.post('/api/requests')
    def create(body: CreateRequest):
        # Release expired reservations before allocating a code.
        storage().expire_waiting(now())
        for _ in range(100):
            code = f'{secrets.randbelow(10000):04d}'
            specs = body.test_specs()
            fields = {**body.model_dump(exclude={'tests'}), 'tests': [t['id'] for t in specs], 'test_specs': specs}
            doc = dict(request_id='req_' + secrets.token_urlsafe(16), token=secrets.token_urlsafe(24), code=code,
                       active_code=code, revision=0, **fields, status='awaiting_seller',
                       challenges=[], results=[], watch_chat_ids=[], created_at=now(), expires_at=now() + timedelta(hours=24))
            try:
                storage().insert(doc)
                return {**{k: doc[k] for k in ('request_id', 'token', 'code', 'status', 'expires_at')},
                        'link_url': link(doc), 'line_number': settings.line_number}
            except DuplicateKeyError:
                continue
        raise HTTPException(503, 'No verification code available; retry later')

    @app.post('/api/tests/suggest')
    async def suggest_tests(body: SuggestRequest):
        """Gemini picks tests for the exact item; never blocks the buyer (falls back to tests.json)."""
        if len(body.keep) >= 6:
            raise HTTPException(422, 'Already 6 tests kept')
        if app.state.suggester is None:
            return catalog_fallback(body)
        # Gemini swings 2-15 s on this prompt and sometimes 504s: a second try starts after 4 s (or
        # at once on failure) and the first answer wins, so a sweater doesn't get handed "Power on".
        try:
            return await hedged(lambda i: app.state.suggester.suggest(body, attempt=i), hedge_after=3, total=18,
                                tries=3, label='tests/suggest')
        except Exception as err:
            print(f'tests/suggest fell back to catalog: {type(err).__name__}', file=sys.stderr)
            return catalog_fallback(body)

    @app.post('/api/listing/parse')
    async def listing_parse(body: ListingRequest):
        """Pasted listing link, text or screenshot in; item name out (null + reason when unreadable)."""
        kw = {'fetch': fetch} if fetch is not None else {}
        return await parse_listing(body, app.state.namer, **kw)

    @app.get('/api/requests/{token}')
    def report(token: str):
        doc = storage().find_token(token)
        if not doc:
            raise HTTPException(404, 'Request not found')
        return public_view(expire(doc), settings)

    agent = APIRouter(prefix='/api/agent', dependencies=[Depends(agent_key)])

    def agent_view(doc):
        return {k: doc[k] for k in ('request_id', 'item_name', 'status')}

    @agent.get('/requests/by-code/{code}')
    def by_code(code: str):
        return agent_view(waiting(code))

    @agent.get('/requests/latest-waiting')
    def latest():
        return agent_view(waiting())

    @agent.post('/requests/watch')
    def watch(body: WatchRequest):
        doc = waiting(body.code)
        if body.chat_id not in doc['watch_chat_ids']:
            doc['watch_chat_ids'].append(body.chat_id)
            storage().save(doc)
        return {'ok': True}

    @agent.post('/requests/{request_id}/start')
    def start(request_id: str):
        doc = get_doc(request_id)
        if doc['status'] == 'in_call':
            return {'challenges': doc['challenges']}  # safe retry, no new randomization
        if doc['status'] != 'awaiting_seller':
            raise HTTPException(409, 'Request is not awaiting seller')
        doc['inspection_version'] = 5
        doc['challenges'] = build_challenges(doc)
        doc['status'] = 'in_call'
        doc['call_id'] = secrets.token_urlsafe(16)
        doc['current_challenge'] = {'prompt': doc['challenges'][0]['prompt'], 'attempt': 1}
        storage().save(doc)
        return {'challenges': doc['challenges']}

    @agent.post('/check')
    async def check(body: CheckRequest):
        doc = await run_in_threadpool(get_doc, body.request_id)
        require_call(doc)
        challenge = next((c for c in doc['challenges'] if c['id'] == body.challenge_id), None)
        if not challenge:
            raise HTTPException(404, 'Challenge not found')
        previous = next((r for r in doc['results'] if r['challenge_id'] == body.challenge_id), None)
        if previous and body.attempt == previous['attempts']:
            return previous['verdict']  # retry of a successfully persisted HTTP request
        if body.attempt != (previous['attempts'] + 1 if previous else 1) or (previous and previous['result'] == 'passed'):
            raise HTTPException(409, 'Attempts must be sequential, at most three, and stop after passing')
        privacy_failure = None
        frames = []
        try:
            frames = await run_in_threadpool(prepare_frames, body.frames, settings.crop_box,
                frame_mode=settings.frame_mode, frame_size=settings.frame_size, mask_boxes=settings.mask_boxes)
        except UnusableEvidence as exc:
            privacy_failure = str(exc)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        finally:
            body.frames.clear()
        doc['current_challenge'] = {'prompt': challenge['prompt'], 'attempt': body.attempt}
        # Persist BEFORE awaiting Gemini, so frontend polling sees progress.
        await run_in_threadpool(storage().save, doc)
        call_id = doc['call_id']
        try:
            if privacy_failure:
                verdict = unavailable(privacy_failure)
                thumb = ''
            else:
                try:
                    verdict = await asyncio.wait_for(app.state.checker.evaluate(challenge, frames), timeout=settings.check_timeout)
                except Exception:
                    verdict = unavailable()
                if verdict.result == 'passed' and verdict.confidence < 0.7:
                    verdict.result = 'unverified'
                if verdict.best_frame >= len(frames):
                    verdict = unavailable('Vision returned an invalid frame selection.')
                thumb = await run_in_threadpool(thumbnail, frames[verdict.best_frame])
        finally:
            frames.clear()
        result = dict(challenge_id=challenge['id'], kind=challenge['kind'], prompt=challenge['prompt'],
                      result=verdict.result, confidence=verdict.confidence, reason=verdict.reason,
                      attempts=body.attempt, thumb=thumb, verdict=verdict.model_dump())
        # Merge against fresh state: a concurrent watcher must not lose its registration.
        for _ in range(5):
            fresh = await run_in_threadpool(get_doc, body.request_id)
            require_call(fresh)
            if fresh['call_id'] != call_id:
                raise HTTPException(409, 'Call changed while check was running')
            existing = next((r for r in fresh['results'] if r['challenge_id'] == body.challenge_id), None)
            if existing and existing['attempts'] >= body.attempt:
                return existing['verdict']
            history = list(existing.get('attempt_history', [])) if existing else []
            if existing and not history:  # resume a pre-v5 call without losing its last attempt
                history.append(dict(attempt=existing['attempts'], **{k: existing[k] for k in ('result', 'confidence', 'reason')}))
            result['attempt_history'] = history + [dict(attempt=body.attempt, **{k: result[k] for k in ('result', 'confidence', 'reason')})]
            fresh['results'] = [r for r in fresh['results'] if r['challenge_id'] != body.challenge_id] + [result]
            try:
                await run_in_threadpool(storage().save, fresh)
                return verdict.model_dump()
            except Conflict:
                continue
        raise Conflict()

    @agent.post('/requests/{request_id}/finish')
    def finish(request_id: str):
        doc = get_doc(request_id)
        if doc['status'] != 'complete':
            require_call(doc)
            done = {r['challenge_id'] for r in doc['results']}
            for c in doc['challenges']:
                if c['id'] not in done:
                    doc['results'].append(dict(challenge_id=c['id'], kind=c['kind'], prompt=c['prompt'],
                        result='unverified', confidence=0, reason='Call ended before this check was evaluated.', attempts=0, thumb=''))
            results = doc['results']
            summary = {state: sum(r['result'] == state for r in results) for state in ('passed', 'failed', 'unverified')}
            liveness = [r for r in results if r['kind'] == 'liveness']
            liveness_status = 'not_run'
            if liveness:  # already-running legacy calls retain their original semantics
                liveness_status = 'passed' if all(r['result'] == 'passed' for r in liveness) else 'failed'
            summary.update(total=len(results), liveness=liveness_status)
            doc['summary'] = summary
            doc.update(summary=scored_summary(doc, settings.passing_threshold_percent), status='complete', verified_at=now())
            doc.pop('current_challenge', None)
            doc.pop('active_code', None)
            storage().save(doc)
        return {'summary': scored_summary(doc, settings.passing_threshold_percent), 'link_url': link(doc), 'notify_chat_ids': doc['watch_chat_ids']}

    @agent.post('/requests/{request_id}/abort')
    def abort(request_id: str):
        doc = get_doc(request_id)
        if doc['status'] == 'awaiting_seller':
            return {'ok': True}
        require_call(doc)
        doc.update(status='awaiting_seller', results=[], challenges=[])
        for key in ('current_challenge', 'call_id', 'summary', 'verified_at'):
            doc.pop(key, None)
        if doc['expires_at'] <= now():
            doc['status'] = 'expired'
            doc.pop('active_code', None)
        storage().save(doc)
        return {'ok': True}

    app.include_router(agent)
    return app


def seed_mock(store):
    fixtures = json.loads((ROOT / 'shared/mock_request.json').read_text())
    for state in ('awaiting_seller', 'in_call', 'complete', 'complete_recording', 'expired'):
        source = fixtures[state]
        doc = dict(request_id='req_mock_' + state, token='mock-' + state, code='4827' if state == 'awaiting_seller' else '0000',
            revision=0, item_name=source['item_name'], category=source['category'], listing_url=source['listing_url'],
            tests=[t['id'] for t in source['tests']], custom_test=None, status=source['status'], challenges=[], results=[],
            watch_chat_ids=[], created_at=now() - timedelta(hours=1), expires_at=now() + timedelta(hours=23))
        doc['results'] = [{**{k: r[k] for k in ('prompt', 'kind', 'result', 'confidence', 'reason', 'attempts')},
                           'thumb': r['thumb_url'], 'challenge_id': 'mock-' + str(i), **({'attempt_history': r['attempt_history']} if 'attempt_history' in r else {})} for i, r in enumerate(source['results'])]
        for key in ('summary', 'verified_at', 'current_challenge'):
            if key in source:
                doc[key] = source[key]
        if state == 'awaiting_seller':
            doc['active_code'] = '4827'
        if state == 'in_call':
            doc['challenges'] = build_challenges(doc)
            doc['call_id'] = 'mock-call'
        store.insert(doc)


app = create_app()
