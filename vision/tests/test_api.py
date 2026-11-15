import base64
from io import BytesIO

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from vision.main import create_app
from vision.config import Settings


@pytest.fixture
def client():
    with TestClient(create_app(Settings(mock=True, agent_key='test-key'))) as c:
        yield c


@pytest.fixture
def frames():
    out = BytesIO()
    Image.new('RGB', (800, 600), 'white').save(out, 'JPEG')
    return [base64.b64encode(out.getvalue()).decode()] * 2


HEAD = {'X-Agent-Key': 'test-key'}


def create(client):
    r = client.post('/api/requests', json={'item_name': 'Controller', 'category': 'console', 'tests': ['power_on', 'buttons', 'serial']})
    assert r.status_code == 200, r.text
    return r.json()


def test_lifecycle(client, frames):
    d = create(client)
    url = '/api/requests/' + d['token']
    assert set(d) == {'request_id', 'token', 'code', 'link_url', 'line_number', 'status', 'expires_at'}
    public = client.get(url).json()
    assert public['code'] == d['code']
    assert 'challenges' not in public
    assert client.get('/api/agent/requests/by-code/' + d['code']).status_code == 401
    assert client.get('/api/agent/requests/latest-waiting', headers=HEAD).json()['request_id'] == d['request_id']
    assert client.post('/api/agent/requests/watch', headers=HEAD, json={'code': d['code'], 'chat_id': 'private-chat'}).json() == {'ok': True}
    root = '/api/agent/requests/' + d['request_id']
    challenges = client.post(root + '/start', headers=HEAD).json()['challenges']
    assert len(challenges) == 3 and all(c['kind'] == 'buyer' for c in challenges)
    assert 'code' not in client.get(url).json()
    for c in challenges:
        r = client.post('/api/agent/check', headers=HEAD, json={'request_id': d['request_id'], 'challenge_id': c['id'], 'attempt': 1, 'frames': frames})
        assert r.status_code == 200, r.text
        assert set(r.json()) == {'result', 'confidence', 'reason', 'best_frame'}
    done = client.post(root + '/finish', headers=HEAD).json()
    assert done['notify_chat_ids'] == ['private-chat']
    report = client.get(url).json()
    assert report['status'] == 'complete'
    assert report['summary']['total'] == len(challenges)
    assert 'private-chat' not in str(report)
    assert 'challenge_id' not in str(report)
    thumb = report['results'][0]['thumb_url'].split(',')[1]
    assert Image.open(BytesIO(base64.b64decode(thumb))).width <= 400


def test_abort_and_unfinished(client):
    d = create(client)
    root = '/api/agent/requests/' + d['request_id']
    assert client.post(root + '/finish', headers=HEAD).status_code == 409
    client.post(root + '/start', headers=HEAD)
    assert client.post(root + '/abort', headers=HEAD).json() == {'ok': True}
    assert client.get('/api/requests/' + d['token']).json()['results'] == []
    client.post(root + '/start', headers=HEAD)
    done = client.post(root + '/finish', headers=HEAD).json()
    assert done['summary']['passed'] == 0
    assert done['summary']['liveness'] == 'not_run'
    assert done['summary']['unverified'] == done['summary']['total']


@pytest.mark.parametrize('body', [
    {'item_name': '', 'category': 'console', 'tests': ['power_on']},
    {'item_name': 'x', 'category': 'console', 'tests': ['imei']},
    {'item_name': 'x', 'category': 'console', 'tests': []},
])
def test_invalid_request(client, body):
    assert client.post('/api/requests', json=body).status_code == 422
