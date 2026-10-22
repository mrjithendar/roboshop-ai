import hashlib
import hmac
import re
import secrets
import threading
import time
import uuid
from datetime import timedelta, datetime, timezone
from pymongo import MongoClient, ReturnDocument
from pymongo.errors import DuplicateKeyError
from runtime import HttpError, text, now, database_operation


def connect_mongo():
    import os

    uri = os.getenv("MONGODB_URL")
    name = os.getenv("MONGODB_DATABASE", "roboshop")
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


def hash_password(password):
    if not isinstance(password, str) or not 12 <= len(password) <= 128:
        raise HttpError(400, "Use a password of 12–128 characters.")
    salt = secrets.token_hex(16)
    return "scrypt:" + salt + ":" + derive(password, salt).hex()


def derive(password, salt):
    return hashlib.scrypt(
        password.encode(),
        salt=salt.encode(),
        n=32768,
        r=8,
        p=3,
        maxmem=64 * 1024 * 1024,
        dklen=64,
    )


def verify(password, encoded):
    try:
        _, salt, expected = encoded.split(":")
        return hmac.compare_digest(derive(password, salt), bytes.fromhex(expected))
    except (ValueError, TypeError):
        return False


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def require_role(user, roles=("customer", "admin", "superadmin")):
    if not user:
        raise HttpError(401, "Please log in to continue.")
    if user["role"] not in roles:
        raise HttpError(403, "You do not have permission to perform this action.")
    return user


class Auth:
    def __init__(self, db):
        self.db = db
        self.users = db.users
        self.sessions = db.auth_sessions
        self.slots = threading.BoundedSemaphore(4)

    def initialize(self):
        self.users.create_index("email", unique=True)
        self.users.create_index(
            "role",
            unique=True,
            partialFilterExpression={"role": "superadmin"},
            name="one_superadmin",
        )
        self.sessions.create_index("expiresAt", expireAfterSeconds=0)
        self.sessions.create_index("userId")
        self.db.auth_limits.create_index("expiresAt", expireAfterSeconds=0)
        self.dummy = hash_password(secrets.token_hex(32))

    def work(self, fn):
        if not self.slots.acquire(blocking=False):
            raise HttpError(429, "Authentication is busy. Please try again shortly.")
        try:
            return fn()
        finally:
            self.slots.release()

    @database_operation("auth.limit")
    def limit(self, address):
        window = int(time.time() // 900)
        row = self.db.auth_limits.find_one_and_update(
            {"_id": digest(f"{address}:{window}")},
            {
                "$inc": {"count": 1},
                "$setOnInsert": {
                    "expiresAt": datetime.fromtimestamp(
                        (window + 1) * 900, timezone.utc
                    )
                },
            },
            upsert=True,
            return_document=ReturnDocument.AFTER,
        )
        if row["count"] > 20:
            raise HttpError(429, "Too many login attempts. Please try again later.")

    @database_operation("auth.register")
    def register(self, data):
        if set(data) - {"name", "email", "password"}:
            raise HttpError(400, "Only name, email and password are accepted.")
        user = {
            "_id": str(uuid.uuid4()),
            "name": text(data.get("name"), "Name", 100),
            "email": email_address(data.get("email")),
            "role": "customer",
            "disabled": False,
            "version": 1,
            "createdAt": now(),
            "passwordHash": self.work(lambda: hash_password(data.get("password"))),
        }
        try:
            self.users.insert_one(user)
        except DuplicateKeyError:
            raise HttpError(
                409, "Unable to register this email. Try logging in instead."
            )
        return user

    @database_operation("auth.login")
    def login(self, data):
        email = email_address(data.get("email"))
        password = data.get("password")
        if not isinstance(password, str) or len(password) > 128:
            raise HttpError(401, "Invalid email or password.")
        user = self.users.find_one({"email": email})
        valid = self.work(
            lambda: verify(password, user["passwordHash"] if user else self.dummy)
        )
        if not valid or not user or user.get("disabled"):
            raise HttpError(401, "Invalid email or password.")
        return user

    @database_operation("auth.issue")
    def issue(self, user):
        token = secrets.token_hex(32)
        self.sessions.insert_one(
            {
                "_id": digest(token),
                "userId": user["_id"],
                "version": user["version"],
                "expiresAt": now() + timedelta(hours=8),
            }
        )
        return token

    @database_operation("auth.current")
    def current(self, token):
        if not token:
            return None
        session = self.sessions.find_one(
            {"_id": digest(token), "expiresAt": {"$gt": now()}}
        )
        if not session:
            return None
        user = self.users.find_one(
            {
                "_id": session["userId"],
                "disabled": {"$ne": True},
                "version": session["version"],
            }
        )
        return public_user(user) if user else None

    @database_operation("auth.logout")
    def logout(self, token):
        if token:
            self.sessions.delete_one({"_id": digest(token)})

    @database_operation("auth.change_user")
    def change_user(self, actor, id, data):
        require_role(actor, ["superadmin"])
        if (
            set(data) - {"role", "disabled"}
            or data.get("role") not in ("customer", "admin")
            or type(data.get("disabled")) is not bool
        ):
            raise HttpError(
                400, "Choose customer/admin and an enabled/disabled status."
            )
        user = self.users.find_one_and_update(
            {"_id": id, "role": {"$ne": "superadmin"}},
            {"$set": data, "$inc": {"version": 1}},
            return_document=ReturnDocument.AFTER,
        )
        if not user:
            raise HttpError(
                409,
                "User not found or the protected super admin cannot be changed here.",
            )
        self.sessions.delete_many({"userId": id})
        return public_user(user)

    def ensure_superadmin(self, email, password):
        """Deployment-managed admin: preserve identity, reconcile only on change."""
        email = email_address(email)
        if not isinstance(password, str) or not 12 <= len(password) <= 128:
            raise HttpError(400, "Invalid superadmin password configuration.")
        other = self.users.find_one({"role": "superadmin", "email": {"$ne": email}})
        if other:
            raise HttpError(409, "Another superadmin exists; resolve explicitly before deploying.")
        user = self.users.find_one({"email": email})
        if not user:
            try:
                return self.bootstrap(email, password, "Team Admin")
            except HttpError as error:
                # Another startup may have created the same account. Re-read;
                # the unique partial index still prevents a second superadmin.
                user = self.users.find_one({"email": email})
                if not user:
                    raise error
        if user.get("role") == "superadmin" and not user.get("disabled") and verify(password, user.get("passwordHash", "")):
            return public_user(user)
        updated = self.users.find_one_and_update(
            {"_id": user["_id"], "version": user.get("version")},
            {"$set": {"role": "superadmin", "disabled": False, "passwordHash": hash_password(password)}, "$inc": {"version": 1}},
            return_document=ReturnDocument.AFTER,
        )
        if not updated:
            raise HttpError(409, "Superadmin changed concurrently; retry startup.")
        self.sessions.delete_many({"userId": user["_id"]})
        return public_user(updated)

    def bootstrap(self, email, password, name="Super Admin"):
        if self.users.find_one({"role": "superadmin"}):
            raise HttpError(
                409, "A super admin already exists. No account was changed."
            )
        user = {
            "_id": str(uuid.uuid4()),
            "email": email_address(email),
            "name": text(name or "Super Admin", "Name", 100),
            "role": "superadmin",
            "disabled": False,
            "version": 1,
            "createdAt": now(),
            "passwordHash": hash_password(password),
        }
        try:
            self.users.insert_one(user)
        except DuplicateKeyError:
            raise HttpError(
                409, "Super admin or email already exists. No account was changed."
            )
        return public_user(user)
