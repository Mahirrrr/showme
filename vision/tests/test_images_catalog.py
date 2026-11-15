import base64
from io import BytesIO
import pytest
from PIL import Image
from test_api import frames
from vision.catalog import CATALOG, build_challenges
from vision.thumbs import prepare_frames, thumbnail


def test_catalog_complete():
    assert {k: len(v) for k, v in CATALOG.items()} == {'console': 5, 'phone': 6, 'laptop': 5, 'other': 3}
    for entries in CATALOG.values():
        assert len({t['id'] for t in entries}) == len(entries)
        assert all(set(t) == {'id', 'label', 'prompt', 'expect'} for t in entries)


def test_selected_challenges_and_custom_only():
    variants = set()
    ids = set()
    for _ in range(30):
        checks = build_challenges({'category': 'console', 'tests': ['power_on'], 'custom_test': 'Show the cable'})
        assert sum(c['kind'] == 'buyer' for c in checks) == 1
        assert sum(c['kind'] == 'custom' for c in checks) == 1
        assert not any(c['kind'] == 'liveness' for c in checks)
        assert not ids.intersection(c['id'] for c in checks)
        ids.update(c['id'] for c in checks)
        variants.add(tuple(c['prompt'] for c in checks))
    assert len(variants) == 1


def test_crop_and_thumbnail(frames):
    prepared = prepare_frames(frames, (20, 30, 420, 330))
    assert Image.open(BytesIO(prepared[0])).size == (400, 300)
    encoded = thumbnail(prepared[0]).split(',')[1]
    assert Image.open(BytesIO(base64.b64decode(encoded))).width <= 400
    with pytest.raises(ValueError):
        prepare_frames(frames, (0, 0, 9999, 9999))


def test_non_jpeg_rejected():
    output = BytesIO()
    Image.new('RGB', (10, 10)).save(output, 'PNG')
    with pytest.raises(ValueError):
        prepare_frames([base64.b64encode(output.getvalue()).decode()] * 2)
