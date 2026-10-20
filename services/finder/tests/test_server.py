import importlib.util
import io
import json
import os
from datetime import datetime, timezone
from pathlib import Path
import unittest
from unittest.mock import patch
spec = importlib.util.spec_from_file_location('finder_server', Path(__file__).resolve().parents[1] / 'server.py')
s = importlib.util.module_from_spec(spec)
spec.loader.exec_module(s)

class FinderTests(unittest.TestCase):
    def setUp(self):
        env = patch.dict(os.environ, {'TURNSTILE_SITE_KEY': 'site', 'TURNSTILE_SECRET_KEY': 'secret', 'LLM_SERVICE_TOKEN': 'a'*64})
        env.start(); self.addCleanup(env.stop)
        s.RATE.update(window=0, count=0)

    def call(self, path, method='GET', body=None, origin=None):
        raw = json.dumps(body).encode() if body is not None else b''
        env = {'PATH_INFO': path, 'REQUEST_METHOD': method, 'CONTENT_LENGTH': str(len(raw)), 'wsgi.input': io.BytesIO(raw)}
        if origin is not None: env['HTTP_ORIGIN'] = origin
        response = []
        content = b''.join(s.application(env, lambda status, headers: response.extend([status, dict(headers)])))
        return response[0], response[1], content

    def test_same_origin_availability_and_outage(self):
        for state in [True, False]:
            with patch.object(s, 'available', return_value=state):
                status, _, body = self.call('/available')
                self.assertTrue(status.startswith('200' if state else '503'))
                self.assertEqual(json.loads(body)['available'], state)
        self.assertTrue(self.call('/health')[0].startswith('200'))

    def test_origins_and_no_forwarded_credentials(self):
        with patch.object(s, 'verify', return_value=True), patch.object(s, 'upstream', return_value={'answer': 'Found', 'products': [{'name': 'Item', 'sku': 'ONE'}]}) as backend:
            self.assertTrue(self.call('/chat', 'POST', {'message': 'help', 'challengeToken': 'token'}, 'https://evil.example')[0].startswith('403'))
            backend.assert_not_called()
            status, headers, body = self.call('/chat', 'POST', {'message': 'help', 'challengeToken': 'token'}, 'https://jithendar.com')
            self.assertTrue(status.startswith('200'))
            self.assertEqual(headers['Access-Control-Allow-Origin'], 'https://jithendar.com')
            self.assertNotIn('Access-Control-Allow-Credentials', headers)
            backend.assert_called_once_with(s.CHAT_URL, {'message': 'help'}, timeout=22)
            self.assertEqual(json.loads(body)['products'][0]['slug'], 'one')

    def test_validation_and_failure(self):
        for payload in [[], {'message': 'x', 'config': {}}, {'message': 'x'*1001}, {'message': ' '}]:
            self.assertTrue(self.call('/chat','POST',payload,'https://jithendar.com')[0].startswith('400'))
        with patch.object(s, 'verify', side_effect=TimeoutError):
            self.assertTrue(self.call('/chat','POST',{'message':'help', 'challengeToken':'token'},'https://jithendar.com')[0].startswith('503'))
        self.assertTrue(self.call('/chat','POST',{'message':'help', 'challengeToken':'token'})[0].startswith('403'))

    def test_capacity_is_bounded(self):
        for _ in range(4): s.SLOTS.acquire()
        try:
            self.assertTrue(self.call('/chat','POST',{'message':'help', 'challengeToken':'token'},'https://jithendar.com')[0].startswith('429'))
        finally:
            for _ in range(4): s.SLOTS.release()

    def test_rejected_token_never_reaches_llm(self):
        with patch.object(s, 'verify', return_value=False), patch.object(s, 'upstream') as backend:
            self.assertTrue(self.call('/chat','POST',{'message':'help','challengeToken':'bad'},'https://jithendar.com')[0].startswith('403'))
            backend.assert_not_called()

    def test_missing_configuration_and_rate_limit_fail_closed(self):
        with patch.dict(os.environ, {'TURNSTILE_SECRET_KEY': ''}), patch.object(s, 'upstream') as backend:
            self.assertTrue(self.call('/chat','POST',{'message':'help','challengeToken':'token'},'https://jithendar.com')[0].startswith('503'))
            self.assertFalse(json.loads(self.call('/available')[2])['available'])
            backend.assert_not_called()
        with patch.object(s, 'allow_attempt', return_value=False), patch.object(s, 'verify') as verify:
            self.assertTrue(self.call('/chat','POST',{'message':'help','challengeToken':'token'},'https://jithendar.com')[0].startswith('429'))
            verify.assert_not_called()

    def test_siteverify_checks_hostname_action_and_expiry(self):
        good = {'success': True, 'hostname': 'jithendar.com', 'action': 'finder', 'challenge_ts': datetime.now(timezone.utc).isoformat()}
        from unittest.mock import MagicMock
        for changes, valid in [({},True), ({'success':False},False), ({'hostname':'evil.example'},False), ({'action':'register'},False), ({'challenge_ts':'2000-01-01T00:00:00Z'},False)]:
            response = MagicMock(); response.__enter__.return_value.read.return_value = json.dumps({**good, **changes}).encode()
            with patch.object(s, 'urlopen', return_value=response) as call:
                self.assertEqual(s.verify('token','https://jithendar.com'),valid)
                self.assertEqual(call.call_args.args[0].full_url,'https://challenges.cloudflare.com/turnstile/v0/siteverify')

if __name__ == '__main__': unittest.main()
