"""Fail-closed human verification challenge boundary and persistent per-IP limits."""

import hashlib
import http.client
import ipaddress
import json
import os
import time
import threading
from concurrent.futures import ThreadPoolExecutor, TimeoutError

POOL = ThreadPoolExecutor(max_workers=4, thread_name_prefix="registration-verify")
SLOTS = threading.BoundedSemaphore(4)
from datetime import datetime, timedelta, timezone
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError
from runtime import HttpError, now


def client_address(req):
    peer = req.environ.get("REMOTE_ADDR", "")
    try:
        address = ipaddress.ip_address(peer)
        trusted = [
            ipaddress.ip_network(c.strip())
            for c in os.getenv("TRUSTED_PROXY_CIDRS", "").split(",")
            if c.strip()
        ]
        if os.getenv("TRUST_PROXY") == "true" and any(
            address in net for net in trusted
        ):
            return str(ipaddress.ip_address(req.headers.get("x-real-ip", "")))
        return str(address)
    except ValueError:
        return peer


class DisabledChallenge:
    def verify(self, token, ip, action="register"):
        return


class TurnstileChallenge:
    def verify(self, token, ip, action="register"):
        if not SLOTS.acquire(blocking=False):
            raise HttpError(
                503, "Challenge verification is busy. Retry with a fresh challenge."
            )
        future = POOL.submit(self._verify, token, ip, action)
        future.add_done_callback(lambda _: SLOTS.release())
        try:
            return future.result(timeout=5)
        except TimeoutError:
            raise HttpError(
                503, "Challenge verification timed out. Retry with a fresh challenge."
            )

    def _verify(self, token, ip, action="register"):
        secret, hostname = os.getenv("TURNSTILE_SECRET_KEY", ""), os.getenv(
            "TURNSTILE_HOSTNAME", ""
        )
        if not secret or not hostname or not os.getenv("TURNSTILE_SITE_KEY"):
            raise HttpError(
                503, "Authentication protection is unavailable. Please try later."
            )
        if not isinstance(token, str) or not 1 <= len(token) <= 2048:
            raise HttpError(400, "Complete a fresh human verification challenge.")
        conn = http.client.HTTPSConnection("challenges.cloudflare.com", timeout=4)
        try:
            conn.request(
                "POST",
                "/turnstile/v0/siteverify",
                json.dumps({"secret": secret, "response": token, "remoteip": ip}),
                {"Content-Type": "application/json"},
            )
            response = conn.getresponse()
            raw = response.read(16385)
            if len(raw) > 16384:
                raise ValueError()
            result = json.loads(raw)
            if not isinstance(result, dict):
                raise ValueError()
            codes = result.get("error-codes", [])
            if any(code in codes for code in ("invalid-input-secret", "missing-input-secret")):
                print(json.dumps({"service": "ai-gateway", "event": "turnstile_configuration_error"}), flush=True)
                raise HttpError(503, "Sign-in verification is misconfigured. Please contact the store administrator.")
            if response.status >= 500 or "internal-error" in codes:
                raise HttpError(503, "Verification service is temporarily unavailable. Please try again later.")
            if response.status not in (200, 400):
                raise ValueError()
            if result.get("success") is not True:
                raise HttpError(
                    400,
                    "Challenge expired, reused or invalid. Complete a fresh challenge.",
                )
            issued = datetime.fromisoformat(
                result.get("challenge_ts", "").replace("Z", "+00:00")
            )
            age = (now() - issued).total_seconds()
            valid = (
                result.get("success") is True
                and result.get("hostname") == hostname
                and result.get("action") == action
                and 0 <= age <= 300
            )
        except HttpError:
            raise
        except Exception:
            raise HttpError(
                503,
                "Challenge verification failed or timed out. Complete a fresh challenge and retry.",
            )
        finally:
            conn.close()
        if not valid:
            raise HttpError(
                400,
                "Challenge expired, reused or invalid. Complete a fresh challenge and retry.",
            )


class Registration:
    def __init__(self, db):
        self.db = db
        db.registration_limits.create_index("expiresAt", expireAfterSeconds=0)
        db.registration_tokens.create_index("expiresAt", expireAfterSeconds=0)

    def public(self):
        mode = os.getenv("REGISTRATION_CHALLENGE_PROVIDER", "disabled")
        return {
            "provider": mode,
            "siteKey": (
                os.getenv("TURNSTILE_SITE_KEY", "") if mode == "turnstile" else ""
            ),
            "action": "register",
        }

    def check(self, data, ip, action="register"):
        window = int(time.time() // 900)
        key = hashlib.sha256(f"{action}:{ip}:{window}".encode()).hexdigest()
        row = self.db.registration_limits.find_one_and_update(
            {"_id": key},
            {
                "$inc": {"count": 1},
                "$setOnInsert": {"expiresAt": now() + timedelta(minutes=30)},
            },
            upsert=True,
            return_document=ReturnDocument.AFTER,
        )
        if row["count"] > (5 if action == "register" else 20):
            raise HttpError(
                429, "Too many authentication attempts. Wait 15 minutes before retrying."
            )
        if data.pop("website", "") != "":
            raise HttpError(
                400,
                "Registration could not be completed. Leave the website field empty.",
            )
        token = data.pop("challengeToken", "")
        mode = self.public()["provider"]
        if mode == "disabled" and os.getenv("APP_ENV", "development") in (
            "development",
            "test",
        ):
            DisabledChallenge().verify(token, ip)
            return
        if mode != "turnstile":
            raise HttpError(
                503, "Authentication protection must be configured. Please try later."
            )
        if not isinstance(token, str) or not 1 <= len(token) <= 2048:
            raise HttpError(400, "Complete a fresh human verification challenge.")
        # Claim before external verification; every attempt consumes its token across replicas.
        try:
            self.db.registration_tokens.insert_one(
                {
                    "_id": hashlib.sha256(token.encode()).hexdigest(),
                    "expiresAt": now() + timedelta(minutes=10),
                }
            )
        except DuplicateKeyError:
            raise HttpError(400, "Challenge already used. Complete a fresh challenge.")
        TurnstileChallenge().verify(token, ip, action)
