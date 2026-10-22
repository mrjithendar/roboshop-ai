import io
import json
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import Mock, patch
import mongomock
SERVICE=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(SERVICE),str(SERVICE/'lib')]
from server import UserService, login_identity
from runtime import Request, HttpError

class LoginLoggingTests(unittest.TestCase):
    def setUp(self):
        env=patch.dict(os.environ, USER_SERVICE_TOKEN='u'*64, TELEMETRY_ID_KEY='test-hmac-key');env.start();self.addCleanup(env.stop)
        with patch('accounts.Auth.initialize'):
            self.service=UserService(mongomock.MongoClient(tz_aware=True).db)
        self.service.auth=Mock()
        self.service.auth.current.return_value=None
        self.user={'_id':'alice','name':'Alice','email':'alice@example.com','role':'customer'}
        self.service.auth.login.return_value=self.user
        self.service.auth.issue.return_value='s'*64
        self.service.registration=Mock()
        self.service.customers=Mock()
    def req(self):
        data=json.dumps({'email':'Alice@example.com','password':'DO-NOT-LOG-PASSWORD','challengeToken':'DO-NOT-LOG-TOKEN'}).encode()
        return Request({'PATH_INFO':'/api/auth/login','REQUEST_METHOD':'POST','HTTP_ORIGIN':self.service.origin,'CONTENT_TYPE':'application/json','CONTENT_LENGTH':str(len(data)),'wsgi.input':io.BytesIO(data),'REMOTE_ADDR':'127.0.0.1'})
    def test_success_and_failure_identity_reason_no_secrets(self):
        for fails in [False,True]:
            self.service.auth.login.side_effect=HttpError(401,'Invalid email or password.') if fails else None
            output=io.StringIO()
            with patch('sys.stdout',output):
                if fails:
                    with self.assertRaises(HttpError):self.service.handle_public(self.req())
                else:self.service.handle_public(self.req())
            records=[json.loads(line) for line in output.getvalue().splitlines()]
            event=next(r for r in records if r['event']==('user_login_failed' if fails else 'user_logged_in'))
            self.assertNotIn('username',event)
            self.assertEqual(len(event['usernameHash']),64)
            self.assertNotIn('alice@example.com',output.getvalue())
            self.assertEqual(event['outcome'],'failure' if fails else 'success')
            if fails:self.assertEqual(event['errorCode'],'AUTH_INVALID_CREDENTIALS')
            self.assertNotIn('DO-NOT-LOG',output.getvalue())
    def test_mfa_is_pending_not_success(self):
        self.user['mfa']=True;self.service.security=Mock()
        output=io.StringIO()
        with patch('sys.stdout',output):self.service.handle_public(self.req())
        self.assertIn('user_login_mfa_required',output.getvalue())
        self.assertNotIn('user_logged_in',output.getvalue())
        self.service.auth.issue.assert_not_called()
    def test_invalid_identifiers_do_not_enter_logs(self):
        for value in ['a\nforged@example.com', 'x'*1000, {'password':'secret'}, None]:
            self.assertEqual(login_identity({'email':value}),'invalid-or-missing')
