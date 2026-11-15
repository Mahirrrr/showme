"""Run a labeled real-camera manifest against Gemini, without storing camera frames.
python -m vision.evaluate vision/local_samples/manifest.json
Manifest: [{"prompt": "...", "expect": "...", "result": "passed",
            "frames": ["on-1.jpg", "on-2.jpg"]}]
"""
import asyncio
import base64
import json
import statistics
import sys
import time
from pathlib import Path
from .checker import GeminiChecker
from .config import Settings
from .thumbs import prepare_frames


async def evaluate(path):
    settings = Settings.from_env()
    if not settings.gemini_api_key:
        raise SystemExit('Set GEMINI_API_KEY locally to run real evaluations')
    manifest = json.loads(path.read_text())
    if not manifest:
        raise SystemExit('Manifest is empty')
    checker = GeminiChecker(settings)
    durations, correct = [], 0
    try:
        for i, sample in enumerate(manifest):
            if not 2 <= len(sample['frames']) <= 4:
                raise ValueError('Each sample needs 2–4 chronological JPEG frames')
            frames = prepare_frames([base64.b64encode((path.parent / p).read_bytes()).decode() for p in sample['frames']], settings.crop_box)
            started = time.monotonic()
            result = await asyncio.wait_for(checker.evaluate_strict(sample, frames), settings.check_timeout)
            elapsed = time.monotonic() - started
            frames.clear()
            durations.append(elapsed)
            correct += result.result == sample['result']
            print(json.dumps({'sample': i, 'expected': sample['result'], 'actual': result.result, 'reason': result.reason, 'seconds': round(elapsed, 3)}))
    finally:
        await checker.close()
    print(json.dumps({'accuracy': correct / len(manifest), 'median_seconds': statistics.median(durations), 'samples': len(manifest)}))


if __name__ == '__main__':
    asyncio.run(evaluate(Path(sys.argv[1]).resolve()))
