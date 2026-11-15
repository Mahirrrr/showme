"""Hedged Gemini calls: Gemini latency swings from 1 s to 15 s+ on the same prompt (measured
2026-11-15), so when the first call is slow, start a second and take whichever answers first."""
import asyncio
import sys


async def hedged(make, *, hedge_after, total, tries=2, label='gemini'):
    """Run make(i) (a coroutine factory; i is the try number, 0-based); start another copy every `hedge_after` seconds until
    `tries` are running, or right away when one fails. Return the first success. Raise the
    last error (or TimeoutError) if none succeeds within `total` seconds."""
    loop = asyncio.get_running_loop()
    deadline = loop.time() + total
    running, started, last_err = set(), 0, None
    try:
        while True:
            if started < tries and (not running or loop.time() >= next_at):
                running.add(asyncio.ensure_future(make(started)))
                started += 1
                next_at = loop.time() + hedge_after
            if not running:
                raise last_err or TimeoutError(f'{label}: no answer')
            left = deadline - loop.time()
            if left <= 0:
                raise TimeoutError(f'{label}: no answer in {total} s')
            wait = min(left, next_at - loop.time()) if started < tries else left
            done, running = await asyncio.wait(running, timeout=max(wait, 0), return_when=asyncio.FIRST_COMPLETED)
            for task in done:
                if task.exception() is None:
                    return task.result()
                last_err = task.exception()
                print(f'{label} try failed: {type(last_err).__name__}: {str(last_err)[:160]}', file=sys.stderr)
                next_at = loop.time()  # a failure starts the next try now
    finally:
        for task in running:
            task.cancel()


# Model -> loop time until which it is rate-limited (429). Shared by naming and test suggestions.
_cooling: dict[str, float] = {}
COOLDOWN_SECONDS = 60


def pick_model(models, attempt):
    """Alternate between the models by try number, skipping one that recently returned 429."""
    now = asyncio.get_running_loop().time()
    ready = [m for m in models if _cooling.get(m, 0) <= now] or list(models)
    return ready[attempt % len(ready)]


def note_failure(model, err):
    if '429' in str(err)[:40] or 'RESOURCE_EXHAUSTED' in str(err)[:80]:
        _cooling[model] = asyncio.get_running_loop().time() + COOLDOWN_SECONDS
