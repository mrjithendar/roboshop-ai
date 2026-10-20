"""Local-account TOTP and email recovery. Never log codes, seeds or passwords."""
import base64
import hashlib
import hmac
import os
import re
import secrets
import smtplib
import ssl
import struct
import time
from datetime import timedelta
from email.message import EmailMessage
from urllib.parse import quote, urlencode

from cryptography.fernet import Fernet, InvalidToken
from pymongo import ReturnDocument
import segno
from auth import digest, email_address, hash_password, verify
from runtime import HttpError, now


def totp(secret, counter):
    key = base64.b32decode(secret)
    mac = hmac.new(key, struct.pack('>Q', counter), hashlib.sha1).digest()
    offset = mac[-1] & 15
    return f'{(struct.unpack(">I", mac[offset:offset+4])[0] & 0x7fffffff) % 1000000:06d}'


class AccountSecurity:
    def __init__(self, auth):
        self.auth, self.db = auth, auth.db
        self.challenges = self.db.auth_challenges
        self.challenges.create_index('expiresAt', expireAfterSeconds=0)
        self.challenges.create_index('userId')
        self.key = os.getenv('AUTH_ENCRYPTION_KEY', '')
        self.cipher = Fernet(self.key.encode()) if self.key else None

    def configured(self):
        if not self.cipher:
            raise HttpError(503, 'Account security is not configured. Contact the store.')

    def encrypt(self, value):
        self.configured()
        return self.cipher.encrypt(value.encode()).decode()

    def decrypt(self, value):
        self.configured()
        try:
            return self.cipher.decrypt(value.encode()).decode()
        except InvalidToken:
            raise HttpError(503, 'Account security is unavailable. Contact the store.')

    def proof(self, value):
        self.configured()
        return hmac.new(self.key.encode(), value.encode(), hashlib.sha256).hexdigest()

    def user(self, actor):
        user = self.auth.users.find_one({'_id': actor['id'], 'disabled': {'$ne': True}})
        if not user:
            raise HttpError(401, 'Please sign in again.')
        return user

    def password(self, user, value):
        if not isinstance(value, str) or len(value) > 128 or not self.auth.work(lambda: verify(value, user['passwordHash'])):
            raise HttpError(400, 'The current password is incorrect.')

    def status(self, actor):
        user = self.user(actor)
        return {'enabled': bool(user.get('mfa')), 'available': bool(self.cipher), 'backupCodesRemaining': len(user.get('mfa', {}).get('backupCodes', []))}

    def enroll(self, actor, data):
        self.configured()
        user = self.user(actor)
        self.password(user, data.get('password'))
        if user.get('mfa'):
            raise HttpError(409, 'Authenticator is already enabled.')
        secret = base64.b32encode(secrets.token_bytes(20)).decode()
        encrypted = self.encrypt(secret)
        result = self.auth.users.update_one({'_id': user['_id'], 'version': user['version'], 'mfa': {'$exists': False}}, {'$set': {'mfaPending': {'secret': encrypted, 'expiresAt': now() + timedelta(minutes=5)}}})
        if not result.modified_count:
            raise HttpError(409, 'Account changed. Sign in again.')
        uri = 'otpauth://totp/' + quote('RobotShop:' + user['email'], safe='') + '?' + urlencode({'secret': secret, 'issuer': 'RobotShop', 'algorithm': 'SHA1', 'digits': 6, 'period': 30})
        return {'secret': secret, 'qr': segno.make(uri, micro=False).png_data_uri(scale=5), 'expiresIn': 300}

    def matched_counter(self, secret, code):
        if not isinstance(code, str) or not re.fullmatch(r'[0-9]{6}', code):
            return None
        current = int(time.time() // 30)
        for counter in (current, current - 1, current + 1):
            if hmac.compare_digest(totp(secret, counter), code):
                return counter
        return None

    def confirm(self, actor, data):
        user = self.user(actor)
        pending = user.get('mfaPending', {})
        if not pending or pending['expiresAt'] <= now():
            raise HttpError(400, 'Setup expired. Start authenticator setup again.')
        counter = self.matched_counter(self.decrypt(pending['secret']), data.get('code'))
        if counter is None:
            raise HttpError(400, 'Invalid authenticator code.')
        codes = [secrets.token_hex(8) for _ in range(10)]
        result = self.auth.users.update_one({'_id': user['_id'], 'version': user['version'], 'mfa': {'$exists': False}, 'mfaPending.secret': pending['secret'], 'mfaPending.expiresAt': {'$gt': now()}}, {'$set': {'mfa': {'secret': pending['secret'], 'lastCounter': counter, 'backupCodes': [digest(c) for c in codes]}}, '$unset': {'mfaPending': ''}, '$inc': {'version': 1}})
        if not result.modified_count:
            raise HttpError(409, 'Setup expired or already completed.')
        self.auth.sessions.delete_many({'userId': user['_id']})
        return {'backupCodes': codes, 'signInAgain': True}

    def factor(self, user, code):
        mfa = user.get('mfa')
        if not mfa or not isinstance(code, str):
            raise HttpError(400, 'Invalid or already used authenticator or backup code.')
        query = {'_id': user['_id'], 'version': user['version'], 'disabled': {'$ne': True}, 'mfa.secret': mfa['secret']}
        if re.fullmatch(r'[a-f0-9]{16}', code):
            query['mfa.backupCodes'] = digest(code)
            update = {'$pull': {'mfa.backupCodes': digest(code)}}
        else:
            counter = self.matched_counter(self.decrypt(mfa['secret']), code)
            if counter is None:
                raise HttpError(400, 'Invalid or already used authenticator or backup code.')
            query['mfa.lastCounter'] = {'$lt': counter}
            update = {'$set': {'mfa.lastCounter': counter}}
        if not self.auth.users.update_one(query, update).modified_count:
            raise HttpError(400, 'Invalid or already used authenticator or backup code.')

    def disable(self, actor, data):
        user = self.user(actor)
        self.password(user, data.get('password'))
        self.factor(user, data.get('code'))
        result = self.auth.users.update_one({'_id': user['_id'], 'version': user['version'], 'mfa.secret': user['mfa']['secret']}, {'$unset': {'mfa': '', 'mfaPending': ''}, '$inc': {'version': 1}})
        if not result.modified_count:
            raise HttpError(409, 'Account changed. Sign in again.')
        self.auth.sessions.delete_many({'userId': user['_id']})
        return {'signInAgain': True}

    def challenge(self, user):
        self.auth.limit("mfa-login:" + user["_id"])
        token = secrets.token_hex(32)
        self.challenges.insert_one({'_id': digest(token), 'kind': 'login', 'userId': user['_id'], 'version': user['version'], 'attempts': 0, 'expiresAt': now() + timedelta(minutes=5)})
        return {'mfaRequired': True, 'challengeId': token, 'expiresIn': 300}

    def attempt(self, token, kind):
        if not isinstance(token, str) or not re.fullmatch(r'[a-f0-9]{64}', token):
            raise HttpError(400, 'Verification expired or invalid. Start again.')
        row = self.challenges.find_one_and_update({'_id': digest(token), 'kind': kind, 'expiresAt': {'$gt': now()}, 'attempts': {'$lt': 5}}, {'$inc': {'attempts': 1}}, return_document=ReturnDocument.AFTER)
        if not row:
            raise HttpError(400, 'Verification expired or too many attempts. Start again.')
        return row

    def finish_login(self, data):
        row = self.attempt(data.get('challengeId'), 'login')
        self.auth.limit('mfa-verify:' + row['userId'])
        user = self.auth.users.find_one({'_id': row['userId'], 'version': row['version'], 'disabled': {'$ne': True}})
        if not user:
            raise HttpError(400, 'Account changed. Start sign-in again.')
        self.factor(user, data.get('code'))
        if not self.challenges.delete_one({'_id': row['_id']}).deleted_count:
            raise HttpError(400, 'Verification already used. Start again.')
        return user

    def mail_config(self):
        self.configured()
        host, sender = os.getenv('SMTP_HOST', ''), os.getenv('SMTP_FROM', '')
        if not host or not sender or os.getenv('SMTP_SECURITY', 'starttls') not in ('starttls', 'tls'):
            raise HttpError(503, 'Password recovery email is not configured. Contact the store.')
        return host, email_address(sender)

    def send(self, recipient, code):
        host, sender = self.mail_config()
        implicit = os.getenv('SMTP_SECURITY', 'starttls') == 'tls'
        message = EmailMessage()
        message['Subject'] = 'Your RobotShop password reset code'
        message['From'], message['To'] = sender, recipient
        message.set_content(f'Your password reset code is: {code}\n\nIt expires in 5 minutes and can be used once. If you did not request this, ignore this email. Never share this code.\n')
        port = int(os.getenv('SMTP_PORT', '465' if implicit else '587'))
        context = ssl.create_default_context(cafile=os.getenv('SMTP_CA_FILE') or None)
        if os.getenv('SMTP_CLIENT_CERT'):
            context.load_cert_chain(os.environ['SMTP_CLIENT_CERT'], os.environ['SMTP_CLIENT_KEY'])
        client = smtplib.SMTP_SSL(host, port, timeout=8, context=context) if implicit else smtplib.SMTP(host, port, timeout=8)
        with client:
            if not implicit:
                client.starttls(context=context)
            if os.getenv('SMTP_USERNAME'):
                client.login(os.environ['SMTP_USERNAME'], os.getenv('SMTP_PASSWORD', ''))
            client.send_message(message)

    def request_reset(self, data):
        self.mail_config()
        email = email_address(data.get('email'))
        # Account-scoped limit also applies across IPs; never reveal account existence.
        window = int(time.time() // 3600)
        limit = self.db.auth_limits.find_one_and_update({'_id': digest(f'reset:{email}:{window}')}, {'$inc': {'count': 1}, '$setOnInsert': {'expiresAt': now() + timedelta(hours=1)}}, upsert=True, return_document=ReturnDocument.AFTER)
        token, code = secrets.token_hex(32), f'{secrets.randbelow(1000000):06d}'
        user = self.auth.users.find_one({'email': email, 'disabled': {'$ne': True}})
        response = {'resetId': token, 'message': 'If the account is eligible, a code has been sent. It expires in five minutes.'}
        if not user or limit['count'] > 5:
            return response
        # New requests replace previous codes, even before Mongo TTL cleanup.
        self.challenges.delete_many({'kind': 'reset', 'userId': user['_id']})
        self.challenges.insert_one({'_id': digest(token), 'kind': 'reset', 'userId': user['_id'], 'version': user['version'], 'codeHash': self.proof(token + ':' + code), 'attempts': 0, 'expiresAt': now() + timedelta(minutes=5)})
        self.auth.users.update_one({'_id': user['_id'], 'version': user['version']}, {'$set': {'passwordResetId': digest(token)}})
        try:
            self.send(email, code)
        except (OSError, smtplib.SMTPException, ValueError):
            self.challenges.delete_one({'_id': digest(token)})
            # Do not expose the address, code, credentials or SMTP response.
            import logging
            logging.getLogger(__name__).error('Password reset email delivery failed; check SMTP configuration.')
        return response

    def reset_password(self, data):
        password = self.auth.work(lambda: hash_password(data.get('password')))
        row = self.attempt(data.get('resetId'), 'reset')
        code = data.get('code')
        if not isinstance(code, str) or not re.fullmatch(r'[0-9]{6}', code) or not hmac.compare_digest(row['codeHash'], self.proof(data['resetId'] + ':' + code)):
            raise HttpError(400, 'Invalid or expired reset code.')
        if not self.challenges.delete_one({'_id': row['_id']}).deleted_count:
            raise HttpError(400, 'Reset code already used.')
        result = self.auth.users.update_one({'_id': row['userId'], 'version': row['version'], 'disabled': {'$ne': True}, 'passwordResetId': row['_id']}, {'$set': {'passwordHash': password}, '$inc': {'version': 1}, '$unset': {'mfaPending': '', 'passwordResetId': ''}})
        if not result.modified_count:
            raise HttpError(400, 'Account changed. Request a new code.')
        # Password recovery never disables MFA. Backup codes recover only the second factor.
        self.auth.sessions.delete_many({'userId': row['userId']})
        self.challenges.delete_many({'userId': row['userId']})
        return {'message': 'Password updated. Sign in with your new password and authenticator if enabled.'}
