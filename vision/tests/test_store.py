from datetime import timedelta
import mongomock
import pytest
from fastapi.testclient import TestClient
from pymongo.errors import DuplicateKeyError, AutoReconnect
from test_api import HEAD, create, frames
from vision.config import Settings
from vision.main import create_app, now
from vision.store import MongoStore, MemoryStore, Conflict


def test_mongo_restart_persists_report(frames):
    collection = mongomock.MongoClient(tz_aware=True).showme.requests
    settings = Settings(mock=True, agent_key='test-key')
    store = MongoStore(collection=collection)
    with TestClient(create_app(settings, store=store)) as client:
        d = create(client)
        root = '/api/agent/requests/' + d['request_id']
        client.post('/api/agent/requests/watch', headers=HEAD, json={'code': d['code'], 'chat_id': 'chat'})
        c = client.post(root + '/start', headers=HEAD).json()['challenges'][0]
        client.post('/api/agent/check', headers=HEAD, json=dict(request_id=d['request_id'], challenge_id=c['id'], attempt=1, frames=frames))
        client.post(root + '/finish', headers=HEAD)
        before = client.get('/api/requests/' + d['token']).json()
    with TestClient(create_app(settings, store=MongoStore(collection=collection))) as restarted:
        assert restarted.get('/api/requests/' + d['token']).json() == before
        assert restarted.post(root + '/finish', headers=HEAD).json()['notify_chat_ids'] == ['chat']
    stored = collection.find_one({'request_id': d['request_id']})
    assert 'frames' not in stored
    assert all('frames' not in r for r in stored['results'])
    assert stored['results'][0]['thumb'].startswith('data:image/jpeg;base64,')
    assert 'expireAfterSeconds' not in collection.index_information()['expires_at_1']


@pytest.mark.parametrize('mongo', [True, False])
def test_store_uniqueness_and_conflict(mongo):
    store = MongoStore(collection=mongomock.MongoClient(tz_aware=True).db.requests) if mongo else MemoryStore()
    doc = dict(request_id='a', token='token', active_code='1234', revision=0)
    store.insert(doc)
    with pytest.raises(DuplicateKeyError):
        store.insert({**doc, 'request_id': 'b', 'token': 'different'})
    first, stale = store.get('a'), store.get('a')
    first['item_name'] = 'changed'
    store.save(first)
    with pytest.raises(Conflict):
        store.save(stale)


def test_database_error_is_sanitized():
    store = MemoryStore()
    store.find_token = lambda token: (_ for _ in ()).throw(AutoReconnect('mongodb://secret:password@host'))
    with TestClient(create_app(Settings(mock=True, agent_key='test-key'), store=store)) as client:
        response = client.get('/api/requests/token')
        assert response.status_code == 503
        assert 'password' not in response.text


def test_missing_live_credentials_fail_closed():
    with pytest.raises(RuntimeError, match='Live mode requires'):
        with TestClient(create_app(Settings(agent_key='key'))):
            pass


def test_missing_agent_key_fails_closed():
    with pytest.raises(RuntimeError, match='AGENT_KEY'):
        with TestClient(create_app(Settings(mock=True))):
            pass
