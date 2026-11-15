import asyncio
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient
from test_api import HEAD, create, frames
from vision.checker import GeminiChecker, Verdict
from vision.config import Settings
from vision.main import create_app


def sdk_response(data):
    generate = AsyncMock(return_value=SimpleNamespace(text=json.dumps(data)))
    return SimpleNamespace(aio=SimpleNamespace(models=SimpleNamespace(generate_content=generate)))


@pytest.mark.parametrize('result,confidence,expected', [('passed', .9, 'passed'), ('passed', .69, 'unverified'), ('failed', .9, 'failed'), ('unverified', .1, 'unverified')])
def test_gemini_schema_and_policy(result, confidence, expected):
    sdk = sdk_response(dict(result=result, confidence=confidence, reason='Visible evidence.', best_frame=1))
    checker = GeminiChecker(Settings(), client=sdk)
    verdict = asyncio.run(checker.evaluate({'prompt': 'Hold up 3 fingers', 'expect': 'exactly 3 fingers'}, [b'jpeg', b'jpeg']))
    assert verdict.result == expected
    args = sdk.aio.models.generate_content.call_args.kwargs
    assert 'exactly 3 fingers' in args['contents'][0]
    assert len(args['contents']) == 3
    assert args['config'].response_json_schema == Verdict.model_json_schema()


@pytest.mark.parametrize('data', [dict(result='passed', confidence=2, reason='x', best_frame=0), dict(result='passed', confidence=.9, reason='x', best_frame=5), {}, {'result': 'passed'}])
def test_bad_gemini_response(data):
    checker = GeminiChecker(Settings(), client=sdk_response(data))
    assert asyncio.run(checker.evaluate({'prompt': 'x', 'expect': 'x'}, [b'x', b'x'])).result == 'unverified'


def test_gemini_error():
    sdk = sdk_response({})
    sdk.aio.models.generate_content.side_effect = RuntimeError('secret provider details')
    checker = GeminiChecker(Settings(), client=sdk)
    verdict = asyncio.run(checker.evaluate({'prompt': 'x', 'expect': 'x'}, [b'x', b'x']))
    assert verdict.result == 'unverified'
    assert 'secret' not in verdict.reason


class SlowChecker:
    async def evaluate(self, challenge, frames):
        await asyncio.sleep(1)

    async def close(self):
        pass


def test_timeout_persists_unverified(frames):
    with TestClient(create_app(Settings(mock=True, agent_key='test-key', check_timeout=.01), checker=SlowChecker())) as client:
        d = create(client)
        root = '/api/agent/requests/' + d['request_id']
        c = client.post(root + '/start', headers=HEAD).json()['challenges'][0]
        for attempt in (1, 2, 3):
            response = client.post('/api/agent/check', headers=HEAD, json=dict(request_id=d['request_id'], challenge_id=c['id'], attempt=attempt, frames=frames))
            assert response.status_code == 200
            assert response.json()['result'] == 'unverified'
        report = client.get('/api/requests/' + d['token']).json()
        assert report['results'][0]['attempts'] == 3
        assert report['current_challenge']['attempt'] == 3


class FailingLiveness:
    async def evaluate(self, challenge, frames):
        return Verdict(result='failed' if challenge['kind'] == 'liveness' else 'passed', confidence=.95, reason='Test double.', best_frame=0)

    async def close(self):
        pass


def test_no_liveness_has_not_run_summary(frames):
    with TestClient(create_app(Settings(mock=True, agent_key='test-key'), checker=FailingLiveness())) as client:
        d = create(client)
        root = '/api/agent/requests/' + d['request_id']
        checks = client.post(root + '/start', headers=HEAD).json()['challenges']
        for c in checks:
            client.post('/api/agent/check', headers=HEAD, json=dict(request_id=d['request_id'], challenge_id=c['id'], attempt=1, frames=frames))
        result = client.post(root + '/finish', headers=HEAD).json()['summary']
        assert result['passed'] == 3
        assert result['liveness'] == 'not_run'


def test_timeout_defaults_and_environment_override(monkeypatch):
    monkeypatch.setattr('vision.config.load_dotenv', lambda *args, **kwargs: None)
    monkeypatch.delenv('CHECK_TIMEOUT_SECONDS', raising=False)
    assert Settings().check_timeout == 20
    assert Settings.from_env().check_timeout == 20
    monkeypatch.setenv('CHECK_TIMEOUT_SECONDS', '30')
    assert Settings.from_env().check_timeout == 30


@pytest.mark.parametrize('seconds', [20, 30])
def test_sdk_receives_timeout_in_milliseconds(monkeypatch, seconds):
    from unittest.mock import Mock
    constructor = Mock()
    monkeypatch.setattr('vision.checker.genai.Client', constructor)
    GeminiChecker(Settings(gemini_api_key='test-only-placeholder', check_timeout=seconds))
    options = constructor.call_args.kwargs['http_options']
    assert options.timeout == seconds * 1000
    assert options.retry_options.attempts == 1


def test_fastapi_uses_configured_checker_deadline(monkeypatch, frames):
    import vision.main as main
    original = asyncio.wait_for
    deadlines = []

    async def recorded_wait_for(awaitable, timeout):
        deadlines.append(timeout)
        return await original(awaitable, timeout)

    monkeypatch.setattr(main.asyncio, 'wait_for', recorded_wait_for)
    with TestClient(create_app(Settings(mock=True, agent_key='test-key'))) as client:
        d = create(client)
        challenge = client.post('/api/agent/requests/' + d['request_id'] + '/start', headers=HEAD).json()['challenges'][0]
        response = client.post('/api/agent/check', headers=HEAD, json=dict(request_id=d['request_id'], challenge_id=challenge['id'], attempt=1, frames=frames))
        assert response.status_code == 200
        assert response.json()['result'] == 'passed'
    assert 20 in deadlines
