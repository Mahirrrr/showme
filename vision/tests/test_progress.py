import threading
from concurrent.futures import ThreadPoolExecutor
from fastapi.testclient import TestClient
from test_api import HEAD, create, frames
from vision.checker import Verdict
from vision.config import Settings
from vision.main import create_app


class ControlledChecker:
    def __init__(self):
        self.entered = threading.Event()
        self.release = threading.Event()

    async def evaluate(self, challenge, frames):
        import asyncio
        self.entered.set()
        await asyncio.to_thread(self.release.wait, 2)
        return Verdict(result='passed', confidence=.9, reason='Test double.', best_frame=0)

    async def close(self):
        pass


def test_progress_visible_during_evaluation_and_abort_cannot_resurrect(frames):
    checker = ControlledChecker()
    with TestClient(create_app(Settings(mock=True, agent_key='test-key'), checker=checker)) as client:
        d = create(client)
        root = '/api/agent/requests/' + d['request_id']
        challenge = client.post(root + '/start', headers=HEAD).json()['challenges'][0]
        with ThreadPoolExecutor() as pool:
            task = pool.submit(client.post, '/api/agent/check', headers=HEAD, json=dict(request_id=d['request_id'], challenge_id=challenge['id'], attempt=1, frames=frames))
            assert checker.entered.wait(2)
            progress = client.get('/api/requests/' + d['token']).json()
            assert progress['current_challenge'] == {'prompt': challenge['prompt'], 'attempt': 1}
            assert client.post(root + '/abort', headers=HEAD).status_code == 200
            client.post(root + '/start', headers=HEAD)
            checker.release.set()
            assert task.result().status_code == 409
        assert client.get('/api/requests/' + d['token']).json()['results'] == []
