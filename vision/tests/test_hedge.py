import asyncio
import time

import pytest

from vision.hedge import hedged


def make_calls(*plan):
    """Each call i sleeps plan[i][0] seconds, then returns plan[i][1] or raises it."""
    calls = []

    async def make(i):
        delay, outcome = plan[len(calls)]
        calls.append(time.monotonic())
        await asyncio.sleep(delay)
        if isinstance(outcome, Exception):
            raise outcome
        return outcome
    return make, calls


def run(coro):
    return asyncio.run(coro)


def test_fast_first_call_never_starts_a_second():
    make, calls = make_calls((0.01, 'a'), (0.01, 'b'))
    assert run(hedged(make, hedge_after=0.2, total=1)) == 'a'
    assert len(calls) == 1


def test_slow_first_call_is_beaten_by_the_hedge():
    make, calls = make_calls((1.0, 'slow'), (0.01, 'fast'))
    t = time.monotonic()
    assert run(hedged(make, hedge_after=0.05, total=2)) == 'fast'
    assert len(calls) == 2 and time.monotonic() - t < 0.5


def test_failure_starts_next_try_at_once():
    make, calls = make_calls((0.01, RuntimeError('504')), (0.01, 'ok'))
    t = time.monotonic()
    assert run(hedged(make, hedge_after=5, total=2)) == 'ok'
    assert time.monotonic() - t < 0.5


def test_all_fail_raises_last_error():
    make, _ = make_calls((0.01, RuntimeError('one')), (0.01, RuntimeError('two')))
    with pytest.raises(RuntimeError, match='two'):
        run(hedged(make, hedge_after=0.05, total=1))


def test_total_timeout():
    make, _ = make_calls((5, 'a'), (5, 'b'))
    t = time.monotonic()
    with pytest.raises(TimeoutError):
        run(hedged(make, hedge_after=0.05, total=0.2))
    assert time.monotonic() - t < 1


def test_rate_limited_model_sits_out():
    from vision.hedge import note_failure, pick_model

    async def go():
        models = ('fast-x', 'main-x')
        assert [pick_model(models, i) for i in range(3)] == ['fast-x', 'main-x', 'fast-x']
        note_failure('fast-x', RuntimeError('504 DEADLINE_EXCEEDED'))  # not a rate limit: stays in
        assert pick_model(models, 0) == 'fast-x'
        note_failure('fast-x', RuntimeError("429 RESOURCE_EXHAUSTED. {'error': ...}"))
        assert [pick_model(models, i) for i in range(3)] == ['main-x'] * 3
    run(go())
