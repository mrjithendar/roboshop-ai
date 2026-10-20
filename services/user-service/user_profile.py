"""Self-service profile edits; identity and authorization fields are never writable."""
import base64
import binascii
import io
import re
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from PIL import Image, ImageOps, UnidentifiedImageError
from accounts import public_user
from runtime import HttpError, now

FIELDS = {"phone": 32, "company": 100, "jobTitle": 100, "bio": 500, "countryCode": 2, "timezone": 64}


def read_profile(db, user_id):
    row = db.users.find_one({"_id": user_id}, {"name": 1, "email": 1, "role": 1, "disabled": 1, "profile": 1, "profilePhoto": 1, "createdAt": 1})
    if not row:
        raise HttpError(404, "Account not found.")
    return {"user": public_user(row), "details": row.get("profile", {}), "photo": row.get("profilePhoto", ""), "memberSince": row.get("createdAt")}


def clean(value, label, maximum, required=False):
    if not isinstance(value, str) or len(value) > maximum or any((ord(c) < 32 or ord(c) == 127) and not (label == "bio" and c in "\n\r") for c in value):
        raise HttpError(400, f"Invalid {label}.")
    value = value.strip()
    if required and not value:
        raise HttpError(400, f"Enter {label}.")
    return value


def update_profile(db, user_id, data):
    if set(data) != {"name", *FIELDS}:
        raise HttpError(400, "Send only the supported profile fields.")
    name = clean(data["name"], "name", 100, True)
    details = {key: clean(data[key], key, size) for key, size in FIELDS.items()}
    if details["phone"] and not re.fullmatch(r"\+?[0-9 ()-]{5,32}", details["phone"]):
        raise HttpError(400, "Enter a valid contact phone number.")
    if details["countryCode"] and not re.fullmatch(r"[A-Z]{2}", details["countryCode"]):
        raise HttpError(400, "Use a two-letter country code.")
    if details["timezone"]:
        try:
            ZoneInfo(details["timezone"])
        except (ZoneInfoNotFoundError, ValueError):
            raise HttpError(400, "Enter a valid time zone, such as Asia/Kolkata.")
    result = db.users.update_one({"_id": user_id, "disabled": {"$ne": True}}, {"$set": {"name": name, "profile": details, "updatedAt": now()}})
    if not result.matched_count:
        raise HttpError(404, "Account not found.")
    return read_profile(db, user_id)


def update_photo(db, user_id, data):
    if set(data) != {"image"} or not isinstance(data["image"], str):
        raise HttpError(400, "Send a profile image.")
    value = data["image"]
    # Empty value removes the photo. Never fetch arbitrary URLs or store SVG/HTML.
    if value:
        if len(value) > 12000 or not re.fullmatch(r"data:image/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+", value):
            raise HttpError(400, "Use a small JPEG, PNG or WebP profile image.")
        try:
            raw = base64.b64decode(value.split(",", 1)[1], validate=True)
            with Image.open(io.BytesIO(raw)) as image:
                if image.format not in ("JPEG", "PNG", "WEBP") or image.width * image.height > 262144 or getattr(image, "n_frames", 1) != 1:
                    raise ValueError()
                image = ImageOps.exif_transpose(image).convert("RGBA")
                image = ImageOps.fit(image, (128, 128))
                background = Image.new("RGB", image.size, "white")
                background.paste(image, mask=image.getchannel("A"))
                output = io.BytesIO()
                background.save(output, format="JPEG", quality=70, optimize=True)
                value = "data:image/jpeg;base64," + base64.b64encode(output.getvalue()).decode()
        except (ValueError, OSError, UnidentifiedImageError, binascii.Error, Image.DecompressionBombError):
            raise HttpError(400, "This image could not be processed. Choose another photo.")
    result = db.users.update_one({"_id": user_id, "disabled": {"$ne": True}}, {"$set": {"profilePhoto": value, "updatedAt": now()}})
    if not result.matched_count:
        raise HttpError(404, "Account not found.")
    return {"photo": value}
