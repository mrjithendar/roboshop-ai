import base64
import os
from pathlib import Path
import sys
import time
import unittest
from datetime import timedelta
from unittest.mock import patch, Mock, MagicMock

sys.path[:0] = [str(Path(__file__).resolve().parents[1]), str(Path(__file__).resolve().parents[1] / 'lib')]
import mongomock
from cryptography.fernet import Fernet
from auth import Auth, public_user, digest, verify
from account_security import AccountSecurity, totp
from runtime import HttpError, now


class SecurityTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {'AUTH_ENCRYPTION_KEY': Fernet.generate_key().decode(), 'SMTP_HOST': 'smtp.example.com', 'SMTP_FROM': 'no-reply@example.com'})
        self.env.start()
        self.db = mongomock.MongoClient(tz_aware=True).security
        self.auth = Auth(self.db)
        self.auth.initialize()
        self.security = AccountSecurity(self.auth)
        self.user = self.auth.register({'name': 'Alice', 'email': 'alice@example.com', 'password': 'correct password 123'})
        self.actor = public_user(self.user)

    def tearDown(self):
        self.env.stop()

    def enroll(self):
        setup = self.security.enroll(self.actor, {'password': 'correct password 123'})
        code = totp(setup['secret'], int(time.time() // 30))
        result = self.security.confirm(self.actor, {'code': code})
        return setup, result, self.db.users.find_one({'_id': self.user['_id']})

    def request_reset(self):
        with patch.object(self.security, 'send') as send:
            result = self.security.request_reset({'email': self.user['email']})
        return result, send.call_args.args[1]

    def test_totp_rfc6238_sha1_vector(self):
        secret = base64.b32encode(b'12345678901234567890').decode()
        self.assertEqual(totp(secret, 59 // 30), '287082')
        self.assertEqual(totp(secret, 1111111109 // 30), '081804')

    def test_setup_encrypts_seed_requires_confirmation_and_revokes_sessions(self):
        token = self.auth.issue(self.user)
        setup, result, user = self.enroll()
        self.assertTrue(setup['qr'].startswith('data:image/png;base64,'))
        self.assertNotEqual(user['mfa']['secret'], setup['secret'])
        self.assertEqual(len(result['backupCodes']), 10)
        self.assertNotIn(result['backupCodes'][0], user['mfa']['backupCodes'])
        self.assertIsNone(self.auth.current(token))
        self.assertNotIn('mfaPending', user)
        with self.assertRaises(HttpError):
            self.security.confirm(self.actor, {'code': '123456'})

    def test_no_session_before_mfa_and_backup_is_single_use(self):
        _, result, user = self.enroll()
        challenge = self.security.challenge(user)
        self.assertEqual(self.db.auth_sessions.count_documents({}), 0)
        verified = self.security.finish_login({'challengeId': challenge['challengeId'], 'code': result['backupCodes'][0]})
        self.assertEqual(verified['_id'], user['_id'])
        with self.assertRaises(HttpError):
            self.security.factor(user, result['backupCodes'][0])
        with self.assertRaises(HttpError):
            self.security.finish_login({'challengeId': challenge['challengeId'], 'code': result['backupCodes'][1]})

    def test_authenticator_code_replay_rejected(self):
        setup, _, user = self.enroll()
        code = totp(setup['secret'], int(time.time() // 30))
        with self.assertRaises(HttpError):
            self.security.factor(user, code)
        future = (int(time.time() // 30) + 2) * 30
        with patch('account_security.time.time', return_value=future):
            self.security.factor(user, totp(setup['secret'], future // 30))
            with self.assertRaises(HttpError):
                self.security.factor(user, totp(setup['secret'], future // 30))

    def test_challenge_five_attempts_and_version_check(self):
        _, result, user = self.enroll()
        challenge = self.security.challenge(user)['challengeId']
        for _ in range(5):
            with self.assertRaises(HttpError):
                self.security.finish_login({'challengeId': challenge, 'code': 'bad'})
        with self.assertRaises(HttpError):
            self.security.finish_login({'challengeId': challenge, 'code': result['backupCodes'][0]})
        challenge = self.security.challenge(user)['challengeId']
        self.db.users.update_one({'_id': user['_id']}, {'$inc': {'version': 1}})
        with self.assertRaises(HttpError):
            self.security.finish_login({'challengeId': challenge, 'code': result['backupCodes'][0]})

    def test_reset_is_five_minutes_one_use_revokes_sessions_and_keeps_mfa(self):
        _, _, user = self.enroll()
        token = self.auth.issue(user)
        result, code = self.request_reset()
        row = self.db.auth_challenges.find_one({'_id': digest(result['resetId'])})
        self.assertLessEqual((row['expiresAt'] - now()).total_seconds(), 300)
        self.assertGreater((row['expiresAt'] - now()).total_seconds(), 295)
        self.assertNotEqual(row['codeHash'], digest(code))
        data = {'resetId': result['resetId'], 'code': code, 'password': 'new password 456'}
        self.security.reset_password(data)
        changed = self.db.users.find_one({'_id': user['_id']})
        self.assertTrue(verify('new password 456', changed['passwordHash']))
        self.assertIn('mfa', changed)
        self.assertIsNone(self.auth.current(token))
        with self.assertRaises(HttpError):
            self.security.reset_password(data)

    def test_expired_and_replaced_reset_codes_fail(self):
        result, code = self.request_reset()
        self.db.auth_challenges.update_many({}, {'$set': {'expiresAt': now() - timedelta(seconds=1)}})
        with self.assertRaises(HttpError):
            self.security.reset_password({'resetId': result['resetId'], 'code': code, 'password': 'new password 456'})
        previous, code = self.request_reset()
        self.request_reset()
        with self.assertRaises(HttpError):
            self.security.reset_password({'resetId': previous['resetId'], 'code': code, 'password': 'new password 456'})

    def test_unknown_or_disabled_user_not_disclosed_and_no_email_sent(self):
        result, _ = self.request_reset()
        with patch.object(self.security, 'send') as send:
            missing = self.security.request_reset({'email': 'absent@example.com'})
            self.assertEqual(missing['message'], result['message'])
            self.assertEqual(len(missing['resetId']), 64)
            send.assert_not_called()
            self.db.users.update_one({'_id': self.user['_id']}, {'$set': {'disabled': True}})
            self.security.request_reset({'email': self.user['email']})
            send.assert_not_called()

    def test_mail_failure_removes_code_and_does_not_expose_smtp_error(self):
        with patch.object(self.security, 'send', side_effect=OSError('secret SMTP details')), self.assertLogs('account_security', level='ERROR') as logs:
            response = self.security.request_reset({'email': self.user['email']})
        self.assertNotIn('secret SMTP details', str(response) + str(logs.output))
        self.assertIsNone(self.db.auth_challenges.find_one({'_id': digest(response['resetId'])}))

    def test_missing_key_fails_closed(self):
        with patch.dict(os.environ, {'AUTH_ENCRYPTION_KEY': ''}):
            security = AccountSecurity(self.auth)
        with self.assertRaises(HttpError):
            security.request_reset({'email': self.user['email']})
        with self.assertRaises(HttpError):
            security.enroll(self.actor, {'password': 'correct password 123'})

    def test_disable_requires_password_and_factor(self):
        _, result, user = self.enroll()
        with self.assertRaises(HttpError):
            self.security.disable(self.actor, {'password': 'wrong', 'code': result['backupCodes'][0]})
        self.security.disable(self.actor, {'password': 'correct password 123', 'code': result['backupCodes'][0]})
        self.assertNotIn('mfa', self.db.users.find_one({'_id': user['_id']}))

    def test_expired_enrollment_and_reset_attempt_limit(self):
        setup = self.security.enroll(self.actor, {'password': 'correct password 123'})
        self.db.users.update_one({'_id': self.user['_id']}, {'$set': {'mfaPending.expiresAt': now() - timedelta(seconds=1)}})
        with self.assertRaises(HttpError):
            self.security.confirm(self.actor, {'code': totp(setup['secret'], int(time.time() // 30))})
        result, code = self.request_reset()
        for _ in range(5):
            with self.assertRaises(HttpError):
                self.security.reset_password({'resetId': result['resetId'], 'code': 'bad', 'password': 'new password 456'})
        with self.assertRaises(HttpError):
            self.security.reset_password({'resetId': result['resetId'], 'code': code, 'password': 'new password 456'})

    def test_smtp_uses_verified_tls_and_client_certificate(self):
        client = MagicMock()
        client.__enter__.return_value = client
        with patch.dict(os.environ, {'SMTP_CA_FILE': '/ca.crt', 'SMTP_CLIENT_CERT': '/tls.crt', 'SMTP_CLIENT_KEY': '/tls.key', 'SMTP_SECURITY': 'starttls', 'SMTP_PORT': '587', 'SMTP_USERNAME': ''}), patch('account_security.ssl.create_default_context') as context, patch('account_security.smtplib.SMTP', return_value=client) as smtp:
            self.security.send('alice@example.com', '123456')
            context.assert_called_once_with(cafile='/ca.crt')
            context.return_value.load_cert_chain.assert_called_once_with('/tls.crt', '/tls.key')
            client.starttls.assert_called_once_with(context=context.return_value)
            smtp.assert_called_once_with('smtp.example.com', 587, timeout=8)
            message = client.send_message.call_args.args[0]
            self.assertEqual(message['To'], 'alice@example.com')
            self.assertIn('123456', message.get_content())

    def test_gateway_does_not_issue_cookie_until_second_factor(self):
        from server import Gateway
        from types import SimpleNamespace
        import threading
        _, codes, user = self.enroll()
        gateway = Gateway.__new__(Gateway)
        gateway.auth, gateway.security = self.auth, self.security
        gateway.origin = 'https://shop.example'
        gateway.limit = Mock()
        gateway.registration = Mock()
        gateway.customers = Mock()
        gateway.session = Mock(return_value='cart')
        gateway.store = SimpleNamespace(lock=threading.Lock(), state={'sessions': {'cart': {}}})
        request = SimpleNamespace(path='/api/auth/login', method='POST', headers={'origin': gateway.origin}, cookie=Mock(return_value=''), set_cookie=Mock(), body=Mock(return_value={'email': user['email'], 'password': 'correct password 123'}))
        with patch('server.client_address', return_value='192.0.2.1'):
            challenge = gateway.handle(request)
            self.assertTrue(challenge['mfaRequired'])
            request.set_cookie.assert_not_called()
            gateway.customers.record_login.assert_not_called()
            request.path = '/api/auth/mfa/verify'
            request.body.return_value = {'challengeId': challenge['challengeId'], 'code': codes['backupCodes'][0]}
            result = gateway.handle(request)
            self.assertEqual(result[0]['user']['id'], user['_id'])
            self.assertEqual(request.set_cookie.call_args.args[0], 'rs_auth')
            gateway.customers.record_login.assert_called_once()
            request.path = '/api/auth/password/request'
            request.headers['origin'] = 'https://attacker.example'
            with self.assertRaises(HttpError) as error:
                gateway.handle(request)
            self.assertEqual(error.exception.status, 403)


if __name__ == '__main__':
    unittest.main()
