"""MongoDB user service. Internal APIs require the gateway service credential."""
import hmac
import io
import json
import os
import re
import sys
from pathlib import Path
from urllib.parse import urlencode

sys.path.insert(0, str(Path(__file__).resolve().parent / 'lib'))
from runtime import HttpError, Request, serve, upstream, configure_telemetry
from accounts import Auth, connect_mongo, public_user, require_role
from account_security import AccountSecurity
from customers import Customers
from user_profile import read_profile, update_profile, update_photo
from registration import Registration, client_address

class UserService:
    def __init__(self, db):
        self.db = db
        self.auth = Auth(db)
        self.auth.initialize()
        self.security = AccountSecurity(self.auth)
        self.customers = Customers(db)
        self.registration = Registration(db)
        self.origin = os.getenv('PUBLIC_ORIGIN', 'http://localhost:3000')
        self.urls = {'shipping': os.getenv('SHIPPING_URL', 'http://127.0.0.1:4106')}
        self.service_token = os.getenv('USER_SERVICE_TOKEN', '')
        if len(self.service_token) < 32:
            raise RuntimeError('Configure USER_SERVICE_TOKEN with at least 32 characters.')
        configure_telemetry('user-service')

    def handle(self, req):
        if req.path == '/api/users/ready' and req.method == 'GET':
            self.db.command('ping')
            return {'ready': True}
        supplied = req.headers.get('x-user-service-token', '')
        if not supplied or not hmac.compare_digest(supplied.encode(), self.service_token.encode()):
            raise HttpError(401, 'User service authentication required.')
        if req.method != 'POST':
            raise HttpError(405, 'Method not allowed.')
        try:
            data = json.loads(req.raw(1048576))
            if not isinstance(data, dict): raise ValueError()
        except (ValueError, UnicodeError):
            raise HttpError(400, 'Expected a JSON object.')
        if req.path == '/internal/session':
            token = data.get('token', '')
            if not isinstance(token, str) or not re.fullmatch('[a-f0-9]{64}', token):
                return {'user': None}
            return {'user': self.auth.current(token)}
        if req.path == '/internal/limit':
            key = data.get('key')
            if not isinstance(key, str) or len(key) > 200: raise HttpError(400, 'Invalid limit key.')
            self.auth.limit(key)
            return {'limited': False}
        if req.path == '/internal/address':
            user_id = data.get('userId')
            if not isinstance(user_id, str) or not self.db.users.find_one({'_id': user_id}):
                raise HttpError(404, 'Account not found.')
            self.customers.save_address(user_id, data.get('shipping'))
            return {'saved': True}
        if req.path == '/internal/verified-purchase':
            return {'verified': self.customers.verified(data)}
        if req.path == '/internal/purchase':
            order = data.get('order', {})
            if not isinstance(order, dict) or order.get('status') != 'paid':
                raise HttpError(400, 'Only paid orders may be projected.')
            return {'saved': self.customers.project(order)}
        if req.path != '/internal/request':
            raise HttpError(404, 'Not found.')
        path, method = data.get('path'), data.get('method')
        if not isinstance(path, str) or not (path.startswith('/api/auth/') or path.startswith('/api/account/') or path == '/api/admin/users' or path.startswith('/api/admin/users/')):
            raise HttpError(404, 'Not found.')
        if method not in ('GET', 'POST', 'PUT', 'PATCH', 'DELETE'):
            raise HttpError(405, 'Method not allowed.')
        raw = json.dumps(data.get('body', {})).encode()
        env = {'PATH_INFO': path, 'REQUEST_METHOD': method, 'CONTENT_TYPE': 'application/json', 'CONTENT_LENGTH': str(len(raw)), 'wsgi.input': io.BytesIO(raw), 'REMOTE_ADDR': data.get('clientAddress', ''), 'QUERY_STRING': urlencode(data.get('query', {}))}
        for name in ('cookie', 'origin', 'sec-fetch-site', 'user-agent'):
            value = data.get('headers', {}).get(name)
            if value is not None:
                if not isinstance(value, str): raise HttpError(400, 'Invalid header.')
                env['HTTP_' + name.upper().replace('-', '_')] = value
        forwarded = Request(env)
        result = self.handle_public(forwarded)
        if result is None: raise HttpError(404, 'Not found.')
        body, status, headers = result if isinstance(result, tuple) else (result, 200, [])
        return {'body': body, 'status': status, 'cookies': forwarded.cookies}

    def handle_public(self, req):
        path, method = req.path, req.method
        if method != 'GET' and req.headers.get('origin') != self.origin:
            raise HttpError(403, 'Origin not allowed.')
        token = req.cookie('rs_auth', r'[a-f0-9]{64}')
        req.user = self.auth.current(token)
        if path == "/api/auth/challenge" and method == "GET":
            return self.registration.public()
        if path == "/api/auth/me" and method == "GET":
            return {"user": req.user}
        if path == "/api/auth/mfa" and method == "GET":
            return self.security.status(require_role(req.user))
        if path in ("/api/auth/mfa/enroll", "/api/auth/mfa/confirm", "/api/auth/mfa/disable", "/api/auth/password/request", "/api/auth/password/reset") and method == "POST":
            if req.headers.get("origin") != self.origin:
                raise HttpError(403, "Origin not allowed.")
            self.auth.limit(client_address(req))
            data = req.body()
            if path.startswith("/api/auth/mfa/"):
                actor = require_role(req.user)
                self.auth.limit("mfa:" + actor["id"])
                action = path.rsplit("/", 1)[1]
                result = getattr(self.security, action)(actor, data)
                if result.get("signInAgain"):
                    req.set_cookie("rs_auth", "", 0)
                return result
            if path.endswith("/request"):
                self.registration.check(data, client_address(req), "login")
                return self.security.request_reset(data)
            return self.security.reset_password(data)
        if path in ("/api/auth/register", "/api/auth/login", "/api/auth/logout", "/api/auth/mfa/verify") and method == "POST":
            if req.headers.get("origin") != self.origin:
                raise HttpError(403, "Origin not allowed.")
            if path.endswith("/logout"):
                self.auth.logout(token)
                req.set_cookie("rs_auth", "", 0)
                req.set_cookie("rs_session", "", 0)
                return {"loggedOut": True}
            self.auth.limit(client_address(req))
            data = req.body()
            if path.endswith("/mfa/verify"):
                user = self.security.finish_login(data)
            else:
                self.registration.check(data, client_address(req), "register" if path.endswith("/register") else "login")
                user = self.auth.register(data) if path.endswith("/register") else self.auth.login(data)
                if user.get("mfa"):
                    return self.security.challenge(user)
            self.customers.record_login(user["_id"], client_address(req), req.headers.get("user-agent", ""), registration=path.endswith("/register"))
            new = self.auth.issue(user)
            self.auth.logout(token)
            req.set_cookie("rs_auth", new, 28800)
            req.user = public_user(user)
            return {"user": req.user}, 201 if path.endswith("/register") else 200, []
        if path.startswith("/api/account/"):
            require_role(req.user)
            user_id = req.user["id"]
            if path == "/api/account/profile":
                if method == "GET":
                    return {**self.customers.profile(user_id), **read_profile(self.db, user_id)}
                if method == "PUT":
                    return update_profile(self.db, user_id, req.body())
            if path == "/api/account/photo" and method == "PUT":
                return update_photo(self.db, user_id, req.body())
            if path == "/api/account/addresses" and method == "POST":
                data = req.body()
                if set(data) != {"cityId", "recipient", "line1", "postalCode"}:
                    raise HttpError(400, "Send a city and delivery address.")
                shipping = upstream(self.urls["shipping"] + "/api/shipping/quote", data, timeout=5)
                self.customers.save_address(user_id, shipping)
                return {"addresses": self.customers.profile(user_id)["addresses"]}
            address = re.fullmatch(r"/api/account/addresses/([a-f0-9]{64})", path)
            if address and method == "DELETE":
                deleted = self.db.customer_addresses.delete_one({"_id": address[1], "userId": user_id})
                if not deleted.deleted_count:
                    raise HttpError(404, "Address not found.")
                return {"deleted": True}
            if path == "/api/account/purchases" and method == "GET":
                return self.customers.purchases(user_id, req.query.get("cursor", ""))
            if path == "/api/account/activity" and method == "GET":
                return self.customers.activity(user_id)
            return
        customer = re.fullmatch(
            r"/api/admin/users/([a-f0-9-]{36})/(profile|purchases|activity)", path
        )
        if customer and method == "GET":
            require_role(req.user, ["superadmin"])
            if not self.db.users.find_one({"_id": customer[1]}, {"_id": 1}):
                raise HttpError(404, "User not found.")
            if customer[2] == "profile":
                return self.customers.profile(customer[1])
            if customer[2] == "activity":
                return self.customers.activity(customer[1])
            return self.customers.purchases(customer[1], req.query.get("cursor", ""))
        require_role(req.user, ['superadmin'])
        actor = req.user
        auth = self.auth
        if path == "/api/admin/users" and method == "GET":
            after = req.query.get("after", "")
            if len(after) > 100:
                raise HttpError(400, "Invalid cursor.")
            users = list(
                auth.users.find(
                    {"_id": {"$gt": after}} if after else {}, {"passwordHash": 0}
                )
                .sort("_id", 1)
                .limit(101)
            )
            return {
                "users": [public_user(u) for u in users[:100]],
                "next": users[99]["_id"] if len(users) > 100 else None,
            }
        match = re.fullmatch(r"/api/admin/users/([a-f0-9-]{36})", path)
        if match and method == "PATCH":
            return {"user": auth.change_user(actor, match[1], req.body())}
        raise HttpError(404, 'Not found.')

if __name__ == '__main__':
    client, db = connect_mongo()
    try:
        service = UserService(db)
        serve('user-service', 4109, service.handle)
    finally:
        client.close()
