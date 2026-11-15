"""Contract v5: selected tests only, minimum two, and final-attempt semantics."""
import pytest
import mongomock
from fastapi.testclient import TestClient
from test_api import HEAD, create, client, frames
from vision.checker import Verdict
from vision.config import Settings
from vision.main import create_app
from vision.store import MongoStore


@pytest.mark.parametrize('tests', [[], ['power_on']])
def test_minimum_two_not_bypassed_by_custom(client, tests):
    r = client.post('/api/requests', json=dict(item_name='Controller', category='console', tests=tests, custom_test='Show the cable.'))
    assert r.status_code == 422


def test_two_selected_tests_are_enough(client):
    response = client.post('/api/requests', json=dict(item_name='Item', category='other', tests=['power_on', 'serial']))
    assert response.status_code == 200
    challenges = client.post('/api/agent/requests/' + response.json()['request_id'] + '/start', headers=HEAD).json()['challenges']
    assert len(challenges) == 2


def test_three_unique_standard_suggested_or_mixed(client):
    specs = [dict(id=f'pick_{i}', label=f'Pick {i}', prompt=f'Show part {i}.', expect=f'part {i} visible') for i in range(3)]
    for tests in (['power_on', 'serial', 'all_sides'], specs, ['power_on', *specs[:2]]):
        response = client.post('/api/requests', json=dict(item_name='Item', category='other', tests=tests))
        assert response.status_code == 200
        d = response.json()
        challenges = client.post('/api/agent/requests/' + d['request_id'] + '/start', headers=HEAD).json()['challenges']
        assert len(challenges) == 3
        assert all(c['kind'] == 'buyer' for c in challenges)
    assert client.post('/api/requests', json=dict(item_name='Item', category='other', tests=['power_on', 'serial', 'serial'])).status_code == 422


class RecoveringChecker:
    def __init__(self, states):
        self.states = iter(states)
        self.calls = 0

    async def evaluate(self, challenge, frames):
        self.calls += 1
        result = next(self.states)
        return Verdict(result=result, confidence=.95, reason='Visible evidence for this attempt.', best_frame=0)

    async def close(self):
        pass


@pytest.mark.parametrize('states', [('failed', 'passed'), ('failed', 'unverified', 'passed'), ('failed', 'failed', 'failed')])
def test_history_and_final_result_survive_mongo_restart(frames, states):
    collection = mongomock.MongoClient(tz_aware=True).showme.requests
    checker = RecoveringChecker(states)
    settings = Settings(mock=True, agent_key='test-key')
    with TestClient(create_app(settings, store=MongoStore(collection=collection), checker=checker)) as c:
        d = create(c)
        root = '/api/agent/requests/' + d['request_id']
        challenges = c.post(root + '/start', headers=HEAD).json()['challenges']
        assert len(challenges) == 3 and all(ch['kind'] == 'buyer' for ch in challenges)
        for attempt in range(1, len(states) + 1):
            body = dict(request_id=d['request_id'], challenge_id=challenges[0]['id'], attempt=attempt, frames=frames)
            first = c.post('/api/agent/check', headers=HEAD, json=body)
            assert first.status_code == 200 and first.json()['result'] == states[attempt - 1]
            assert c.post('/api/agent/check', headers=HEAD, json=body).json() == first.json()
        assert checker.calls == len(states)  # duplicate HTTP retries neither re-evaluate nor add history
        assert c.post('/api/agent/check', headers=HEAD, json={**body, 'attempt': 4}).status_code == 422
        c.post(root + '/finish', headers=HEAD)
    with TestClient(create_app(settings, store=MongoStore(collection=collection))) as restarted:
        report = restarted.get('/api/requests/' + d['token']).json()
        row = report['results'][0]
        assert row['result'] == states[-1]
        assert [h['result'] for h in row['attempt_history']] == list(states)
        assert [h['attempt'] for h in row['attempt_history']] == list(range(1, len(states) + 1))
        assert all(set(h) == {'attempt', 'result', 'confidence', 'reason'} for h in row['attempt_history'])
        assert {k: report['summary'][k] for k in ('passed','failed','unverified','total','liveness')} == dict(passed=int(states[-1] == 'passed'), failed=int(states[-1] == 'failed'), unverified=2, total=3, liveness='not_run')
        assert report['summary']['overall_verdict'] == 'failed'
        assert all(r['kind'] != 'liveness' for r in report['results'])
        saved = collection.find_one({'request_id': d['request_id']})
        assert all('thumb' not in h and 'frames' not in h for h in saved['results'][0]['attempt_history'])


def test_completed_legacy_reports_remain_readable_and_unchanged(client):
    store = client.app.state.store
    before = store.get('req_mock_complete_recording')
    report = client.get('/api/requests/mock-complete_recording').json()
    assert report['summary']['liveness'] == 'failed'
    assert any(r['kind'] == 'liveness' for r in report['results'])
    assert store.get('req_mock_complete_recording') == before


def test_already_running_legacy_liveness_keeps_failure_summary(frames):
    """New calls omit liveness; an old in-flight call must not lose its evidence."""
    from test_checker import FailingLiveness
    settings = Settings(mock=True, agent_key='test-key')
    with TestClient(create_app(settings, checker=FailingLiveness())) as c:
        d = create(c)
        root = '/api/agent/requests/' + d['request_id']
        c.post(root + '/start', headers=HEAD)
        store = c.app.state.store
        legacy = store.get(d['request_id'])
        legacy.pop('inspection_version', None)
        legacy['challenges'].append(dict(id='legacy_liveness', kind='liveness', prompt='Show three fingers.', expect='three fingers visible'))
        store.save(legacy)
        for challenge in legacy['challenges']:
            response = c.post('/api/agent/check', headers=HEAD, json=dict(request_id=d['request_id'], challenge_id=challenge['id'], attempt=1, frames=frames))
            assert response.status_code == 200
        report = c.post(root + '/finish', headers=HEAD).json()
        assert {k: report['summary'][k] for k in ('passed','failed','unverified','total','liveness')} == dict(passed=3, failed=1, unverified=0, total=4, liveness='failed')
        assert report['summary']['overall_verdict'] == 'passed'
