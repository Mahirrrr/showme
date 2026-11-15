import base64
import binascii
from io import BytesIO
from PIL import Image, ImageOps, UnidentifiedImageError

Image.MAX_IMAGE_PIXELS = 16_000_000


def prepare_frames(frames, crop_box=None):
    prepared = []
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
                if crop_box:
                    if len(crop_box) != 4 or not (0 <= crop_box[0] < crop_box[2] <= image.width and 0 <= crop_box[1] < crop_box[3] <= image.height):
                        raise ValueError('Configured crop is outside the frame')
                    image = image.crop(crop_box)
                image.thumbnail((640, 640))
                out = BytesIO()
                image.save(out, 'JPEG', quality=70)
                prepared.append(out.getvalue())
        except (binascii.Error, UnidentifiedImageError, OSError, Image.DecompressionBombError, Image.DecompressionBombWarning) as exc:
            raise ValueError('Invalid JPEG frame') from exc
    return prepared


def thumbnail(raw):
    with Image.open(BytesIO(raw)) as image:
        image.thumbnail((400, 400))
        out = BytesIO()
        image.convert('RGB').save(out, 'JPEG', quality=70)
        return 'data:image/jpeg;base64,' + base64.b64encode(out.getvalue()).decode()
