"""Explicit opt-in only. These tests use paid/external services, unlike test doubles."""
import asyncio
import os
import secrets
import pytest
from vision.checker import GeminiChecker
from vision.config import Settings
from vision.store import MongoStore
from vision.main import now
from vision.thumbs import prepare_frames
from test_api import frames

pytestmark = pytest.mark.skipif(os.getenv('SHOWME_LIVE_TESTS') != '1', reason='Set SHOWME_LIVE_TESTS=1 explicitly for real services')


def test_real_atlas_roundtrip():
    settings = Settings.from_env()
    assert settings.mongodb_uri, 'MONGODB_URI required'
    store = MongoStore(settings.mongodb_uri, settings.mongodb_database)
    request_id = 'probe_' + secrets.token_urlsafe(16)
    doc = dict(request_id=request_id, token=request_id, revision=0, status='complete', created_at=now())
    try:
        store.insert(doc)
        store.close()
        store = MongoStore(settings.mongodb_uri, settings.mongodb_database)
        assert store.get(request_id)['token'] == request_id
    finally:
        store.collection.delete_one({'request_id': request_id})
        store.close()


def test_real_gemini_blind_view_is_unverified(frames):
    settings = Settings.from_env()
    assert settings.gemini_api_key, 'GEMINI_API_KEY required'
    async def run():
        checker = GeminiChecker(settings)
        try:
            return await checker.evaluate_strict({'prompt': 'Show a readable serial label', 'expect': 'a readable serial label'}, prepare_frames(frames))
        finally:
            await checker.close()
    verdict = asyncio.run(run())
    # A fallback also returns unverified: insist on a nonfallback confidence/reason.
    assert verdict.result == 'unverified'
    assert 'unavailable' not in verdict.reason.lower()
    assert 'invalid frame' not in verdict.reason.lower()
