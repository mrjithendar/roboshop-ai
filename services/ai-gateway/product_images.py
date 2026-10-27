"""Admin product image uploads, stored in MongoDB and served from a content-addressed URL.

Uploads are decoded and re-encoded with Pillow, so only a fresh baseline JPEG is ever stored or
served: metadata, scripts in polyglot files, animation frames and original bytes are discarded.
"""
import base64
import binascii
import hashlib
import io
import re

from bson.binary import Binary
from PIL import Image, ImageOps, UnidentifiedImageError

from auth import require_role
from runtime import HttpError, UserError, now

UPLOAD_PATH = "/api/admin/product-images"
# Data-URL characters accepted by the upload route; the ASGI and NGINX body limits follow this.
MAX_UPLOAD_CHARS = 1_500_000
MAX_SOURCE_PIXELS = 40_000_000
MAX_EDGE = 1600
PUBLIC_PATTERN = re.compile(r"/api/product-images/([0-9a-f]{32})\.jpg")
DATA_URL = re.compile(r"data:image/(?:jpeg|png|webp);base64,([A-Za-z0-9+/=]+)")


def public_path(image_id):
    return f"/api/product-images/{image_id}.jpg"


def exists(db, path):
    match = PUBLIC_PATTERN.fullmatch(path or "")
    return bool(match) and db.product_images.count_documents({"_id": match[1]}, limit=1) == 1


def normalize(value):
    match = DATA_URL.fullmatch(value) if isinstance(value, str) and len(value) <= MAX_UPLOAD_CHARS else None
    if not match:
        raise UserError(400, "Upload a JPEG, PNG or WebP image under 1 MB.")
    try:
        raw = base64.b64decode(match[1], validate=True)
        with Image.open(io.BytesIO(raw)) as image:
            if image.format not in ("JPEG", "PNG", "WEBP") or getattr(image, "n_frames", 1) != 1 \
                    or image.width * image.height > MAX_SOURCE_PIXELS or min(image.size) < 200:
                raise ValueError()
            image = ImageOps.exif_transpose(image).convert("RGBA")
            image.thumbnail((MAX_EDGE, MAX_EDGE), Image.Resampling.LANCZOS)
            background = Image.new("RGB", image.size, "white")
            background.paste(image, mask=image.getchannel("A"))
            output = io.BytesIO()
            background.save(output, format="JPEG", quality=85, optimize=True, progressive=True)
            return output.getvalue(), background.size
    except (ValueError, OSError, UnidentifiedImageError, binascii.Error, Image.DecompressionBombError):
        raise UserError(400, "This image could not be processed. Use a JPEG, PNG or WebP at least 200 × 200 pixels.")


def upload(req, db):
    actor = require_role(req.user, ("admin", "superadmin"))
    data = req.body(MAX_UPLOAD_CHARS + 1024)
    if set(data) != {"image"}:
        raise UserError(400, "Upload a JPEG, PNG or WebP image under 1 MB.")
    content, (width, height) = normalize(data["image"])
    image_id = hashlib.sha256(content).hexdigest()[:32]
    # Content addressing makes repeated uploads idempotent and lets browsers cache forever.
    db.product_images.update_one(
        {"_id": image_id},
        {"$setOnInsert": {"data": Binary(content), "contentType": "image/jpeg", "width": width, "height": height,
                          "bytes": len(content), "createdAt": now(), "createdBy": actor["id"]}},
        upsert=True,
    )
    return {"image": public_path(image_id), "width": width, "height": height, "bytes": len(content)}, 201, []


def serve(path, db):
    match = PUBLIC_PATTERN.fullmatch(path)
    if not match:
        return None
    row = db.product_images.find_one({"_id": match[1]}, {"data": 1})
    if not row:
        raise HttpError(404, "Not found")
    return bytes(row["data"]), 200, [
        ("Content-Type", "image/jpeg"),
        ("Cache-Control", "public, max-age=31536000, immutable"),
    ]
