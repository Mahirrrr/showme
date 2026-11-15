"""Sanitize source pixels before resizing, model submission, or thumbnail creation."""
import base64
import binascii
from io import BytesIO
from PIL import Image, ImageDraw, ImageOps, UnidentifiedImageError

Image.MAX_IMAGE_PIXELS = 16_000_000
FACETIME_CROP = (204, 28, 436, 352)
# Calibrated on 640x360 agent-captured samples. Crop removes side margins/top UI;
# this buffered source-pixel mask removes only the bottom-left self-view tile.
FACETIME_MASKS = ((204, 288, 304, 352),)


class UnusableEvidence(ValueError):
    """No safe usable image remains. Never submit or retain the original."""


def valid_box(box, width, height):
    return (isinstance(box, (tuple, list)) and len(box) == 4
            and all(isinstance(v, int) and not isinstance(v, bool) for v in box)
            and 0 <= box[0] < box[2] <= width and 0 <= box[1] < box[3] <= height)


def sanitize(image, crop_box, frame_mode, frame_size, mask_boxes):
    if frame_mode not in ('camera', 'facetime'):
        raise UnusableEvidence('Unknown frame privacy mode; evidence was not evaluated.')
    if frame_mode == 'facetime':
        if len(frame_size) != 2 or image.size != tuple(frame_size):
            raise UnusableEvidence('Unexpected FaceTime frame dimensions; evidence was not evaluated.')
        crop_box = FACETIME_CROP if crop_box is None else crop_box
        mask_boxes = FACETIME_MASKS if mask_boxes is None else mask_boxes
    else:
        mask_boxes = () if mask_boxes is None else mask_boxes
    if crop_box is None:
        crop_box = (0, 0, image.width, image.height)
    if not valid_box(crop_box, image.width, image.height):
        raise UnusableEvidence('Invalid privacy crop; evidence was not evaluated.')
    if any(not valid_box(box, image.width, image.height) for box in mask_boxes):
        raise UnusableEvidence('Invalid privacy mask; evidence was not evaluated.')
    # Use fresh pixels, dropping source metadata (including EXIF and comments).
    clean = Image.new('RGB', image.size)
    clean.paste(image)
    visible = Image.new('L', image.size, 255)
    draw, coverage = ImageDraw.Draw(clean), ImageDraw.Draw(visible)
    for left, top, right, bottom in mask_boxes:
        # Coordinates use the same exclusive-right/bottom convention as Pillow.crop.
        box = (left, top, right - 1, bottom - 1)
        draw.rectangle(box, fill='black')
        coverage.rectangle(box, fill=0)
    clean = clean.crop(crop_box)
    visible = visible.crop(crop_box)
    pixels = visible.histogram()[255]
    if clean.width < 32 or clean.height < 32 or pixels < max(1024, clean.width * clean.height * .1):
        raise UnusableEvidence('Privacy filtering left insufficient evidence; check is unverified.')
    return clean


def prepare_frames(frames, crop_box=None, *, frame_mode='camera', frame_size=(640, 360), mask_boxes=None):
    prepared = []
    try:
        for frame in frames:
            if len(frame) > 2_800_000:
                raise ValueError('Frame exceeds 2 MB')
            try:
                raw = base64.b64decode(frame, validate=True)
                with Image.open(BytesIO(raw)) as image:
                    if image.width * image.height > Image.MAX_IMAGE_PIXELS:
                        raise ValueError('JPEG exceeds 16 million pixels')
                    if image.format != 'JPEG':
                        raise ValueError('Frames must be JPEG')
                    image = ImageOps.exif_transpose(image).convert('RGB')
                    image = sanitize(image, crop_box, frame_mode, frame_size, mask_boxes)
                    image.thumbnail((640, 640))
                    out = BytesIO()
                    image.save(out, 'JPEG', quality=70)
                    prepared.append(out.getvalue())
                del raw
            except (binascii.Error, UnidentifiedImageError, OSError, Image.DecompressionBombError, Image.DecompressionBombWarning) as exc:
                raise ValueError('Invalid JPEG frame') from exc
        return prepared
    except Exception:
        prepared.clear()  # Reject the entire batch; never partially submit it.
        raise


def thumbnail(raw):
    """Input must be sanitized bytes returned by prepare_frames, never source frames."""
    with Image.open(BytesIO(raw)) as image:
        image.thumbnail((400, 400))
        out = BytesIO()
        image.convert('RGB').save(out, 'JPEG', quality=70)
        return 'data:image/jpeg;base64,' + base64.b64encode(out.getvalue()).decode()
