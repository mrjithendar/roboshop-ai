import re
from pymongo import MongoClient
from runtime import HttpError


def connect_mongo():
    import os

    uri = os.getenv("MONGODB_URL")
    name = os.getenv("MONGODB_DATABASE", "robotshop")
    if not uri or not re.fullmatch("[A-Za-z0-9_-]{1,64}", name):
        raise RuntimeError("Configure MONGODB_URL and a valid MONGODB_DATABASE.")
    client = MongoClient(
        uri,
        maxPoolSize=10,
        serverSelectionTimeoutMS=5000,
        connectTimeoutMS=5000,
        socketTimeoutMS=10000,
        tz_aware=True,
    )
    return client, client[name]



def public_user(u):
    return {
        "id": u["_id"],
        "email": u["email"],
        "name": u["name"],
        "role": u["role"],
        "disabled": u.get("disabled") is True,
    }


def email_address(value):
    if (
        not isinstance(value, str)
        or len(value) > 254
        or not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", value)
    ):
        raise HttpError(400, "Enter a valid email address.")
    return value.strip().lower()



def require_role(user, roles=("customer", "admin", "superadmin")):
    if not user:
        raise HttpError(401, "Please log in to continue.")
    if user["role"] not in roles:
        raise HttpError(403, "You do not have permission to perform this action.")
    return user


