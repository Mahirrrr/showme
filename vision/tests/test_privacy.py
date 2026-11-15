import base64
from io import BytesIO

import pytest
from fastapi.testclient import TestClient
from PIL import Image, ImageDraw
from test_api import HEAD, create
from vision.checker import Verdict
from vision.config import Settings
from vision.main import create_app
from vision.thumbs import prepare_frames


def screenshot(size=(640, 360)):
    image = Image.new('RGB', size, 'black')
    draw = ImageDraw.Draw(image)
    draw.rectangle((200, 0, 439, 359), fill=(240, 240, 240))
    draw.rectangle((208, 8, 250, 23), fill=(255, 0, 0))  # top overlay
    draw.rectangle((210, 294, 297, 348), fill=(0, 255, 0))  # self-view
    draw.rectangle((500, 290, 639, 359), fill=(0, 0, 255))  # excluded controls
    out = BytesIO()
    image.save(out, 'JPEG', quality=95)
    return base64.b64encode(out.getvalue()).decode()


def assert_private_regions_removed(raw):
    with Image.open(BytesIO(raw)) as image:
        pixels = image.convert('RGB').tobytes()
        for r, g, b in zip(pixels[0::3], pixels[1::3], pixels[2::3]):
            assert not (r > 150 and g < 90 and b < 90)
            assert not (g > 150 and r < 90 and b < 90)
            assert not (b > 150 and r < 90 and g < 90)
            assert not (r > 150 and b > 150 and g < 90)


def test_facetime_default_sanitization():
    result = prepare_frames([screenshot()] * 4, frame_mode='facetime')
    assert len(result) == 4
    for raw in result:
        assert_private_regions_removed(raw)
        assert Image.open(BytesIO(raw)).size == (232, 324)


class RecordingChecker:
    def __init__(self):
        self.calls = []

    async def evaluate(self, challenge, frames):
        for frame in frames:
            assert_private_regions_removed(frame)
        self.calls.append(list(frames))
        return Verdict(result='passed', confidence=.9, reason='Synthetic privacy test.', best_frame=0)

    async def close(self):
        pass


def test_api_sanitizes_before_checker_and_thumbnail():
    checker = RecordingChecker()
    with TestClient(create_app(Settings(mock=True, agent_key='test-key', frame_mode='facetime'), checker=checker)) as client:
        d = create(client)
        root = '/api/agent/requests/' + d['request_id']
        challenge = client.post(root + '/start', headers=HEAD).json()['challenges'][0]
        response = client.post('/api/agent/check', headers=HEAD, json=dict(request_id=d['request_id'], challenge_id=challenge['id'], attempt=1, frames=[screenshot()] * 4))
        assert response.status_code == 200
        assert response.json()['result'] == 'passed'
        assert len(checker.calls) == 1
        stored = client.app.state.store.get(d['request_id'])
        thumb = base64.b64decode(stored['results'][0]['thumb'].split(',')[1])
        assert_private_regions_removed(thumb)
        assert Image.open(BytesIO(thumb)).width <= 400
        assert 'frames' not in stored
        assert all('frames' not in row for row in stored['results'])


@pytest.mark.parametrize('settings,frame', [
    ({}, screenshot((320, 180))),
    ({}, screenshot((1280, 720))),
    ({'crop_box': (0, 0, 9999, 9999)}, screenshot()),
    ({'crop_box': (0, 0, 20, 20)}, screenshot()),
    ({'mask_boxes': ((0, 0, 640, 360),)}, screenshot()),
    ({'mask_boxes': ((0, 0, 9999, 9999),)}, screenshot()),
])
def test_unusable_evidence_unverified_without_checker_or_thumbnail(settings, frame):
    checker = RecordingChecker()
    with TestClient(create_app(Settings(mock=True, agent_key='test-key', frame_mode='facetime', **settings), checker=checker)) as client:
        d = create(client)
        root = '/api/agent/requests/' + d['request_id']
        challenge = client.post(root + '/start', headers=HEAD).json()['challenges'][0]
        response = client.post('/api/agent/check', headers=HEAD, json=dict(request_id=d['request_id'], challenge_id=challenge['id'], attempt=1, frames=[frame] * 2))
        assert response.status_code == 200
        assert response.json()['result'] == 'unverified'
        assert checker.calls == []
        stored = client.app.state.store.get(d['request_id'])
        assert stored['results'][0]['thumb'] == ''
        assert stored['results'][0]['attempts'] == 1


def test_custom_crop_masks_source_coordinates_and_removes_metadata():
    original = Image.new('RGB', (1280, 720), 'white')
    draw = ImageDraw.Draw(original)
    draw.rectangle((200, 200, 299, 299), fill='red')
    exif = Image.Exif()
    exif[270] = 'PRIVATE SOURCE METADATA'
    out = BytesIO()
    original.save(out, 'JPEG', exif=exif)
    encoded = base64.b64encode(out.getvalue()).decode()
    frames = prepare_frames([encoded] * 2, (100, 100, 500, 500), frame_mode='facetime', frame_size=(1280, 720), mask_boxes=((180, 180, 320, 320),))
    for frame in frames:
        image = Image.open(BytesIO(frame))
        assert image.size == (400, 400)
        assert image.getpixel((150, 150))[0] < 20  # source x=250,y=250
        assert image.getpixel((20, 20))[0] > 220  # remaining evidence survives
        assert not image.getexif()
        assert b'PRIVATE SOURCE METADATA' not in frame


def test_environment_privacy_settings(monkeypatch):
    monkeypatch.setenv('VISION_FRAME_MODE', 'facetime')
    monkeypatch.setenv('VISION_FRAME_SIZE', '1280,720')
    monkeypatch.setenv('VISION_CROP_BOX', '80,80,520,380')
    monkeypatch.setenv('VISION_MASK_BOXES', '0,0,1280,72;0,400,1280,720')
    settings = Settings.from_env()
    assert settings.frame_mode == 'facetime'
    assert settings.frame_size == (1280, 720)
    assert settings.crop_box == (80, 80, 520, 380)
    assert len(settings.mask_boxes) == 2
    monkeypatch.setenv('VISION_CROP_BOX', 'not coordinates')
    settings = Settings.from_env()
    assert settings.crop_box == ()
    from vision.thumbs import UnusableEvidence
    with pytest.raises(UnusableEvidence):
        prepare_frames([screenshot()] * 2, settings.crop_box, frame_mode=settings.frame_mode)


def test_mixed_dimensions_reject_whole_batch():
    from vision.thumbs import UnusableEvidence
    with pytest.raises(UnusableEvidence):
        prepare_frames([screenshot(), screenshot((320, 180))], frame_mode='facetime')


def test_calibrated_layout_retains_lower_right_evidence():
    from vision.thumbs import FACETIME_CROP, FACETIME_MASKS
    assert FACETIME_CROP == (204, 28, 436, 352)
    assert FACETIME_MASKS == ((204, 288, 304, 352),)
    raw = prepare_frames([screenshot()], frame_mode='facetime')[0]
    image = Image.open(BytesIO(raw)).convert('RGB')
    assert image.size == (232, 324)
    # At source x=250,y=320 the self-view is black, but x=400,y=320 survives.
    assert max(image.getpixel((46, 292))) < 20
    assert min(image.getpixel((196, 292))) > 220
    # Caller crop boundaries contain useful light pixels rather than side margins.
    assert min(image.getpixel((0, 100))) > 220
    assert min(image.getpixel((231, 100))) > 220


def test_local_calibration_samples_when_available():
    from pathlib import Path
    from vision.thumbs import thumbnail
    for name in ('frame1.jpg', 'frame2.jpg'):
        path = Path(__file__).resolve().parents[1] / 'local_samples' / name
        if not path.exists():
            pytest.skip('Ignored local calibration samples are not in the repository')
        # Original bytes are read solely for local sanitizer calibration, never sent.
        with Image.open(path) as original:
            assert original.size == (640, 360)
        raw = prepare_frames([base64.b64encode(path.read_bytes()).decode()], frame_mode='facetime')[0]
        with Image.open(BytesIO(raw)) as sanitized:
            assert sanitized.size == (232, 324)
            assert not sanitized.getexif()
            assert max(sanitized.convert('RGB').getpixel((30, 300))) < 20
        thumb = Image.open(BytesIO(base64.b64decode(thumbnail(raw).split(',')[1])))
        assert thumb.width <= 400
        assert max(thumb.convert('RGB').getpixel((30, 300))) < 20


def test_camera_mode_is_environment_default(monkeypatch):
    monkeypatch.setattr('vision.config.load_dotenv', lambda *args, **kwargs: None)
    for name in ('VISION_FRAME_MODE', 'VISION_CROP_BOX', 'VISION_MASK_BOXES'):
        monkeypatch.delenv(name, raising=False)
    settings = Settings.from_env()
    assert settings.frame_mode == 'camera'
    assert settings.crop_box is None
    assert settings.mask_boxes is None


def agent_cropped_frame():
    image = Image.new('RGB', (480, 520), 'white')
    draw = ImageDraw.Draw(image)
    # Colored borders are useful caller evidence; no part should be cut or masked.
    draw.rectangle((0, 0, 479, 24), fill='red')
    draw.rectangle((0, 495, 479, 519), fill='blue')
    draw.rectangle((0, 25, 24, 494), fill='green')
    draw.rectangle((455, 25, 479, 494), fill='yellow')
    metadata = Image.Exif()
    metadata[270] = 'PRIVATE EXIF'
    output = BytesIO()
    image.save(output, 'JPEG', quality=95, exif=metadata)
    return base64.b64encode(output.getvalue()).decode()


def assert_camera_evidence_preserved(raw, size):
    image = Image.open(BytesIO(raw)).convert('RGB')
    assert image.size == size
    assert image.getpixel((size[0] // 2, 5))[0] > 180
    assert image.getpixel((size[0] // 2, size[1] - 6))[2] > 180
    assert image.getpixel((5, size[1] // 2))[1] > 90
    right = image.getpixel((size[0] - 6, size[1] // 2))
    assert right[0] > 180 and right[1] > 180


def test_camera_mode_keeps_agent_crop_and_strips_metadata():
    from vision.thumbs import thumbnail
    prepared = prepare_frames([agent_cropped_frame()] * 4)
    for raw in prepared:
        assert_camera_evidence_preserved(raw, (480, 520))
        assert not Image.open(BytesIO(raw)).getexif()
        assert b'PRIVATE EXIF' not in raw
        thumb = base64.b64decode(thumbnail(raw).split(',')[1])
        assert_camera_evidence_preserved(thumb, (369, 400))
        assert Image.open(BytesIO(thumb)).width <= 400


def test_camera_mode_api_keeps_full_agent_crop_for_checker_and_report():
    class CameraChecker(RecordingChecker):
        async def evaluate(self, challenge, frames):
            for frame in frames:
                assert_camera_evidence_preserved(frame, (480, 520))
                assert not Image.open(BytesIO(frame)).getexif()
            self.calls.append(list(frames))
            return Verdict(result='passed', confidence=.95, reason='Synthetic camera-mode check.', best_frame=0)

    checker = CameraChecker()
    with TestClient(create_app(Settings(mock=True, agent_key='test-key'), checker=checker)) as client:
        d = create(client)
        root = '/api/agent/requests/' + d['request_id']
        challenge = client.post(root + '/start', headers=HEAD).json()['challenges'][0]
        result = client.post('/api/agent/check', headers=HEAD, json=dict(request_id=d['request_id'], challenge_id=challenge['id'], attempt=1, frames=[agent_cropped_frame()] * 2))
        assert result.status_code == 200 and result.json()['result'] == 'passed'
        assert len(checker.calls) == 1
        report = client.get('/api/requests/' + d['token']).json()
        thumb = base64.b64decode(report['results'][0]['thumb_url'].split(',')[1])
        assert_camera_evidence_preserved(thumb, (369, 400))
        stored = client.app.state.store.get(d['request_id'])
        assert 'frames' not in stored and all('frames' not in row for row in stored['results'])
