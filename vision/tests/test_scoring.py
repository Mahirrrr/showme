"""Authoritative overall scores use final selected-buyer outcomes only."""
import pytest
import mongomock
from fastapi.testclient import TestClient
from test_api import HEAD, frames
from vision.checker import Verdict
from vision.config import Settings
from vision.main import create_app
from vision.scoring import scored_summary
from vision.store import MongoStore


def document(outcomes):
    return dict(tests=[f't{i}' for i in range(len(outcomes))], results=[dict(challenge_id=f'c{i}', kind='buyer', result=result, attempts=1) for i, result in enumerate(outcomes)], summary=dict(passed=outcomes.count('passed'), failed=outcomes.count('failed'), unverified=outcomes.count('unverified'), total=len(outcomes), liveness='not_run'))


@pytest.mark.parametrize('outcomes,expected,percentage', [
    (['passed'] * 3 + ['failed'], 'passed', 75),
    (['passed'] * 3 + ['unverified'], 'passed', 75),
    (['passed'] * 2 + ['failed', 'unverified'], 'failed', 50),
    (['passed', 'passed', 'unverified'], 'failed', 200 / 3),
    (['unverified'] * 4, 'failed', 0),
    ([], 'failed', 0),
])
def test_threshold_boundaries(outcomes, expected, percentage):
    summary = scored_summary(document(outcomes), 75)
    assert summary['overall_verdict'] == expected
    assert summary['pass_percentage'] == pytest.approx(percentage)
    assert summary['passed_tests'] == outcomes.count('passed')
    assert summary['total_selected_tests'] == len(outcomes)


def test_custom_and_legacy_liveness_do_not_inflate_selected_score():
    doc = document(['passed', 'failed', 'unverified'])
    doc['results'] += [dict(kind=kind, result='passed') for kind in ('custom', 'liveness')]
    summary = scored_summary(doc, 75)
    assert summary['passed_tests'] == 1 and summary['total_selected_tests'] == 3
    assert summary['overall_verdict'] == 'failed'


def test_no_rounding_up_or_duplicate_retry_credit():
    doc = document(['passed', 'passed', 'failed'])
    doc['results'] += [{**doc['results'][0], 'attempts': 2}]
    score = scored_summary(doc, 66.67)
    assert score['passed_tests'] == 2 and score['overall_verdict'] == 'failed'


class Outcomes:
    def __init__(self, results): self.results = iter(results)
    async def evaluate(self, challenge, frames):
        return Verdict(result=next(self.results), confidence=.95, reason='Synthetic scoring fixture.', best_frame=0)
    async def close(self): pass


def test_api_retry_score_snapshot_and_legacy_read_compatibility(frames):
    settings = Settings(mock=True, agent_key='test-key')
    collection = mongomock.MongoClient(tz_aware=True).showme.requests
    with TestClient(create_app(settings, store=MongoStore(collection=collection), checker=Outcomes(['failed','passed','passed','passed','unverified']))) as c:
        created = c.post('/api/requests', json=dict(item_name='Controller', category='console', tests=['power_on','buttons','serial','all_sides'])).json()
        root = '/api/agent/requests/' + created['request_id']
        checks = c.post(root + '/start', headers=HEAD).json()['challenges']
        for i, challenge in enumerate(checks):
            for attempt in ((1,2) if i == 0 else (1,)):
                response = c.post('/api/agent/check', headers=HEAD, json=dict(request_id=created['request_id'], challenge_id=challenge['id'], attempt=attempt, frames=frames))
                assert response.status_code == 200
        finish = c.post(root + '/finish', headers=HEAD).json()
        summary = finish['summary']
        assert summary['overall_verdict'] == 'passed' and summary['pass_percentage'] == 75
        assert summary['passed_tests'] == 3 and summary['total_selected_tests'] == 4
        assert summary['passing_threshold_percent'] == 75
        view = c.get('/api/requests/' + created['token']).json()
        assert view['summary'] == summary
        assert view['results'][0]['result'] == 'passed'
        assert [h['result'] for h in view['results'][0]['attempt_history']] == ['failed','passed']
        assert view['results'][3]['result'] == 'unverified'
        assert collection.find_one({'request_id':created['request_id']})['summary'] == summary
    with TestClient(create_app(Settings(mock=True,agent_key='test-key',passing_threshold_percent=90), store=MongoStore(collection=collection))) as restarted:
        assert restarted.get('/api/requests/' + created['token']).json()['summary'] == summary
        assert restarted.post(root + '/finish', headers=HEAD).json()['summary'] == summary
        # Old documents keep their stored schema; scoring is added to the public view only.
        stored = collection.find_one({'request_id':created['request_id']})
        legacy_summary = {k:v for k,v in summary.items() if k not in ('overall_verdict','pass_percentage','passed_tests','total_selected_tests','passing_threshold_percent')}
        collection.update_one({'_id':stored['_id']},{'$set':{'summary':legacy_summary}})
        legacy = restarted.get('/api/requests/' + created['token']).json()['summary']
        assert legacy['overall_verdict'] == 'failed' and legacy['passing_threshold_percent'] == 90
        assert collection.find_one({'_id':stored['_id']})['summary'] == legacy_summary


def test_threshold_configuration(monkeypatch):
    monkeypatch.setattr('vision.config.load_dotenv',lambda *a,**kw:None)
    monkeypatch.delenv('PASSING_THRESHOLD_PERCENT',raising=False)
    assert Settings.from_env().passing_threshold_percent == 75
    monkeypatch.setenv('PASSING_THRESHOLD_PERCENT','80')
    assert Settings.from_env().passing_threshold_percent == 80
    assert scored_summary(document(['passed'] * 3 + ['failed']),80)['overall_verdict'] == 'failed'
    for bad in (0, -1, 101, float('nan'), float('inf')):
        with pytest.raises(ValueError): Settings(passing_threshold_percent=bad)


def test_unperformed_selected_test_stays_in_denominator(frames):
    with TestClient(create_app(Settings(mock=True,agent_key='test-key'),checker=Outcomes(['passed']*3))) as c:
        d=c.post('/api/requests',json=dict(item_name='Controller',category='console',tests=['power_on','buttons','serial','all_sides'])).json()
        root='/api/agent/requests/'+d['request_id']
        checks=c.post(root+'/start',headers=HEAD).json()['challenges']
        for challenge in checks[:3]:
            assert c.post('/api/agent/check',headers=HEAD,json=dict(request_id=d['request_id'],challenge_id=challenge['id'],attempt=1,frames=frames)).status_code==200
        summary=c.post(root+'/finish',headers=HEAD).json()['summary']
        assert summary['overall_verdict']=='passed' and summary['pass_percentage']==75
        assert summary['total_selected_tests']==4 and summary['unverified']==1
        rows=c.get('/api/requests/'+d['token']).json()['results']
        assert rows[-1]['result']=='unverified' and rows[-1]['attempts']==0
