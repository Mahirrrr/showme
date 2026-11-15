from datetime import timedelta
import pytest
from test_api import HEAD, create, client, frames
from vision.main import now


@pytest.mark.parametrize('method,path', [
    ('get', '/api/agent/requests/by-code/4827'),
    ('get', '/api/agent/requests/latest-waiting'),
    ('post', '/api/agent/requests/watch'),
    ('post', '/api/agent/requests/x/start'),
    ('post', '/api/agent/requests/x/finish'),
    ('post', '/api/agent/requests/x/abort'),
    ('post', '/api/agent/check'),
])
def test_all_agent_routes_protected(client, method, path):
    for headers in ({}, {'X-Agent-Key': 'wrong'}):
        assert getattr(client, method)(path, headers=headers).status_code == 401


def test_unique_and_expiry(client):
    docs = [create(client) for _ in range(20)]
    assert len({d['code'] for d in docs}) == 20
    assert len({d['token'] for d in docs}) == 20
    d = docs[0]
    store = client.app.state.store
    doc = store.get(d['request_id'])
    assert timedelta(hours=23, minutes=59) < doc['expires_at'] - now() <= timedelta(hours=24)
    doc['expires_at'] = now() - timedelta(seconds=1)
    store.save(doc)
    report = client.get('/api/requests/' + d['token']).json()
    assert report['status'] == 'expired'
    assert 'code' not in report
    assert client.get('/api/agent/requests/by-code/' + d['code'], headers=HEAD).status_code == 404
    assert client.post('/api/agent/requests/' + d['request_id'] + '/start', headers=HEAD).status_code == 409


def test_attempts_and_frame_validation(client, frames):
    d = create(client)
    root = '/api/agent/requests/' + d['request_id']
    challenges = client.post(root + '/start', headers=HEAD).json()['challenges']
    assert client.post(root + '/start', headers=HEAD).json()['challenges'] == challenges
    body = dict(request_id=d['request_id'], challenge_id=challenges[0]['id'], attempt=1, frames=frames)
    assert client.post('/api/agent/check', headers=HEAD, json={**body, 'attempt': 2}).status_code == 409
    assert client.post('/api/agent/check', headers=HEAD, json={**body, 'challenge_id': 'unknown'}).status_code == 404
    for bad in ([], ['not-base64'] * 2, frames * 3, [frames[0]]):
        r = client.post('/api/agent/check', headers=HEAD, json={**body, 'frames': bad})
        assert r.status_code == 422
        assert frames[0] not in r.text
    first = client.post('/api/agent/check', headers=HEAD, json=body)
    assert first.status_code == 200
    assert client.post('/api/agent/check', headers=HEAD, json=body).json() == first.json()
    assert client.post('/api/agent/check', headers=HEAD, json={**body, 'attempt': 2}).status_code == 409
    client.post(root + '/finish', headers=HEAD)
    assert client.post('/api/agent/check', headers=HEAD, json=body).status_code == 409


def test_mock_fixtures_and_cache(client):
    for state in ('awaiting_seller', 'in_call', 'complete', 'complete_recording', 'expired'):
        response = client.get('/api/requests/mock-' + state)
        assert response.status_code == 200
        assert response.headers['cache-control'] == 'no-store'
        assert response.json()['status'] == ('complete' if state == 'complete_recording' else state)
    assert client.get('/api/requests/missing').status_code == 404


def test_payload_limit(client):
    assert client.post('/api/agent/check', content=b'x' * 12_000_001).status_code == 413


def test_abort_after_expiry_and_completed_report_retention(client):
    d = create(client)
    root = '/api/agent/requests/' + d['request_id']
    client.post(root + '/start', headers=HEAD)
    store = client.app.state.store
    doc = store.get(d['request_id'])
    doc['expires_at'] = now() - timedelta(seconds=1)
    store.save(doc)
    assert client.post(root + '/abort', headers=HEAD).status_code == 200
    assert client.get('/api/requests/' + d['token']).json()['status'] == 'expired'
    d = create(client)
    root = '/api/agent/requests/' + d['request_id']
    client.post(root + '/start', headers=HEAD)
    client.post(root + '/finish', headers=HEAD)
    doc = store.get(d['request_id'])
    doc['expires_at'] = now() - timedelta(days=1)
    store.save(doc)
    assert client.get('/api/requests/' + d['token']).json()['status'] == 'complete'
    assert client.post(root + '/abort', headers=HEAD).status_code == 409


def test_allocation_retries_collision(client, monkeypatch):
    import vision.main as main
    numbers = iter([4827, 1234])  # 4827 is reserved by the seeded waiting fixture
    monkeypatch.setattr(main.secrets, 'randbelow', lambda n: next(numbers))
    assert create(client)['code'] == '1234'


def test_unknown_routes_and_custom_only(client):
    for suffix in ('start', 'finish', 'abort'):
        assert client.post('/api/agent/requests/missing/' + suffix, headers=HEAD).status_code == 404
    response = client.post('/api/requests', json={'item_name': 'Cable', 'category': 'other', 'tests': [], 'custom_test': 'Show the connector'})
    assert response.status_code == 200
    checks = client.post('/api/agent/requests/' + response.json()['request_id'] + '/start', headers=HEAD).json()['challenges']
    assert sum(c['kind'] == 'custom' for c in checks) == 1
