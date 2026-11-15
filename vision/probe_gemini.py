"""Explicit real Gemini probe; never changes backend mode or prints secrets."""
import asyncio
import json
import time
from dataclasses import replace
from io import BytesIO
from pathlib import Path

from dotenv import dotenv_values
from google import genai
from google.genai import types
from PIL import Image, ImageDraw

from .checker import GeminiChecker
from .config import Settings


def output(data):
    print(json.dumps(data), flush=True)


def jpeg(label=None):
    image = Image.new('RGB', (640, 400), 'white')
    if label:
        draw = ImageDraw.Draw(image)
        draw.text((40, 150), label, fill='black', font_size=36)
    buffer = BytesIO()
    image.save(buffer, 'JPEG', quality=90)
    return buffer.getvalue()


async def main():
    local = dotenv_values(Path(__file__).with_name('.env'))
    settings = Settings.from_env()
    output({'environment': {'vision_env_exists': Path(__file__).with_name('.env').is_file(),
        'key_present_in_vision_env': bool(local.get('GEMINI_API_KEY')),
        'loaded_key_matches_vision_env': bool(settings.gemini_api_key) and settings.gemini_api_key == local.get('GEMINI_API_KEY'),
        'backend_mock': settings.mock, 'model': settings.gemini_model,
        'sdk_version': genai.__version__, 'backend_timeout_seconds': settings.check_timeout}})
    if not settings.mock or not settings.gemini_api_key:
        output({'error': 'Probe requires MOCK=1 and a configured Gemini key; no settings changed.'})
        return
    # Give standalone probes 30 seconds; the backend's configured budget is unchanged.
    probe_settings = replace(settings, check_timeout=30)
    checker = GeminiChecker(probe_settings)
    try:
        started = time.perf_counter()
        try:
            response = await asyncio.wait_for(checker.client.aio.models.generate_content(
                model=settings.gemini_model, contents='Reply with exactly OK.',
                config=types.GenerateContentConfig(temperature=0)), 30)
            output({'test': 'connectivity', 'seconds': round(time.perf_counter() - started, 3),
                    'success': True, 'nonempty_text': bool(response.text),
                    'response_is_OK': bool(response.text and response.text.strip() == 'OK')})
        except Exception as exc:
            output({'test': 'connectivity', 'seconds': round(time.perf_counter() - started, 3),
                    'success': False, 'error_type': type(exc).__name__, 'status_code': getattr(exc, 'code', None)})
        for name, frame, challenge, expected in [
            ('visible_serial', jpeg('SERIAL: SHOWME-4827'), {'prompt': 'Show the serial label', 'expect': 'a readable serial label'}, 'passed'),
            ('blank_image', jpeg(), {'prompt': 'Show the serial label', 'expect': 'a readable serial label'}, 'unverified'),
        ]:
            started = time.perf_counter()
            try:
                verdict = await asyncio.wait_for(checker.evaluate_strict(challenge, [frame, frame]), 30)
                output({'test': name, 'seconds': round(time.perf_counter() - started, 3), 'success': verdict.result == expected,
                        'expected': expected, 'actual': verdict.model_dump()})
            except Exception as exc:
                output({'test': name, 'seconds': round(time.perf_counter() - started, 3),
                        'success': False, 'error_type': type(exc).__name__, 'status_code': getattr(exc, 'code', None)})
    finally:
        await checker.close()


if __name__ == '__main__':
    asyncio.run(main())
