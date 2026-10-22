import importlib.util
import io
import json
import os
from pathlib import Path
import unittest
from unittest.mock import patch, MagicMock
spec = importlib.util.spec_from_file_location('finder_server', Path(__file__).resolve().parents[1] / 'server.py')
s = importlib.util.module_from_spec(spec)
spec.loader.exec_module(s)

class FinderTests(unittest.TestCase):
    def setUp(self):
        env = patch.dict(os.environ, {'LLM_SERVICE_TOKEN': 'a'*64})
        env.start(); self.addCleanup(env.stop)
        s.RATE.update(window=0, count=0)

    def call(self, body=None, path='/chat', origin='https://jithendar.com'):
        raw = json.dumps(body).encode() if body is not None else b''
        env = {'PATH_INFO':path,'REQUEST_METHOD':'POST' if body is not None else 'GET','HTTP_ORIGIN':origin,'CONTENT_LENGTH':str(len(raw)),'wsgi.input':io.BytesIO(raw)}
        result=[]
        content=b''.join(s.application(env,lambda status,headers:result.extend([status,dict(headers)])))
        return result[0],result[1],json.loads(content)

    def test_guest_and_old_guest_tokens_cannot_reach_ai(self):
        with patch.object(s,'authenticated',return_value=False),patch.object(s,'upstream') as backend:
            for extra in [{},{'verificationToken':'old-guest-pass','challengeToken':'turnstile-token'}]:
                status,_,body=self.call({'message':'help',**extra})
                self.assertTrue(status.startswith('401'))
                self.assertEqual(body['code'],'login-required')
            backend.assert_not_called()

    def test_authenticated_chat_and_context(self):
        with patch.object(s,'authenticated',return_value=True),patch.object(s,'upstream',return_value={'answer':'Found','products':[{'name':'Robot','sku':'ONE'}],'mode':'ai'}) as backend:
            status,_,body=self.call({'message':'Which one?','context':'Compare A and B'})
            self.assertTrue(status.startswith('200'))
            self.assertEqual(body['products'][0]['slug'],'one')
            self.assertIn('Compare A and B',backend.call_args.args[1]['message'])
            self.assertNotIn('verificationToken',body)

    def test_logout_and_expiry_rechecked_on_every_message(self):
        with patch.object(s,'authenticated',side_effect=[True,False]),patch.object(s,'upstream',return_value={'answer':'OK'}) as backend:
            self.assertTrue(self.call({'message':'first'})[0].startswith('200'))
            self.assertTrue(self.call({'message':'second'})[0].startswith('401'))
            self.assertEqual(backend.call_count,1)

    def test_invalid_requests_and_origin(self):
        with patch.object(s,'authenticated',return_value=True),patch.object(s,'upstream') as backend:
            for data in [[],{}, {'message':' '},{'message':'x'*1001},{'message':'help','context':'x'*501},{'message':'help','verificationToken':'fake'}]:
                self.assertTrue(self.call(data)[0].startswith('400'))
            self.assertTrue(self.call({'message':'help'},origin='https://evil.example')[0].startswith('403'))
            backend.assert_not_called()

    def test_gateway_checks_cookie_and_rejects_invalid_session(self):
        response=MagicMock()
        for user in [None,{'id':'customer'}]:
            response.__enter__.return_value.read.return_value=json.dumps({'user':user}).encode()
            with patch.object(s,'urlopen',return_value=response) as backend:
                self.assertEqual(s.authenticated({'HTTP_COOKIE':'rs_auth='+'a'*64+'; other=private','HTTP_ORIGIN':'https://jithendar.com'}),bool(user))
                self.assertEqual(backend.call_args.args[0].get_header('Cookie'),'rs_auth='+'a'*64)
                backend.reset_mock()
                self.assertFalse(s.authenticated({'HTTP_COOKIE':'rs_auth='+'a'*64,'HTTP_ORIGIN':'https://other.example'}))
                backend.assert_not_called()
        with patch.object(s,'urlopen',side_effect=TimeoutError):
            self.assertFalse(s.authenticated({'HTTP_COOKIE':'rs_auth='+'a'*64}))

    def test_availability_does_not_require_turnstile(self):
        with patch.dict(os.environ,{'TURNSTILE_SITE_KEY':'','TURNSTILE_SECRET_KEY':''}),patch.object(s,'available',return_value=True),patch.object(s,'authenticated',return_value=False):
            status,headers,body=self.call(path='/available')
            self.assertTrue(status.startswith('200'))
            self.assertTrue(body['available'])
            self.assertFalse(body['authenticated'])
            self.assertEqual(headers['Cache-Control'],'no-store')

    def test_liveness_is_local_readiness_tracks_required_backends_and_recovery(self):
        with patch.object(s, 'authenticated', return_value=False) as auth, patch.object(s, 'upstream', side_effect=TimeoutError) as backend:
            s.HEALTH.update(until=0, ok=False)
            self.assertTrue(self.call(path='/health')[0].startswith('200'))
            backend.assert_not_called()
            self.assertTrue(self.call(path='/ready')[0].startswith('503'))
            auth.assert_not_called()
            backend.side_effect = None; backend.return_value = {'status': 'ready'}
            s.HEALTH['until'] = 0
            self.assertTrue(self.call(path='/ready')[0].startswith('200'))
            backend.return_value = {'assistantMode': 'not-configured'}
            s.HEALTH['until'] = 0
            self.assertTrue(self.call(path='/ready')[0].startswith('200'))
            status, _, body = self.call(path='/available')
            self.assertTrue(body['available'])
            self.assertFalse(body['aiConfigured'])
            self.assertIn('Please connect an LLM to get results', body['message'])

    def test_model_failure_is_explicit_feature_unavailable(self):
        with patch.object(s, 'authenticated', return_value=True), patch.object(s, 'upstream', return_value={'mode':'provider-unavailable','answer':'Model unavailable'}):
            status, _, body = self.call({'message':'help'})
            self.assertTrue(status.startswith('503'))
            self.assertEqual(body['code'], 'feature-unavailable')

    def test_missing_provider_returns_setup_notice(self):
        with patch.object(s, 'authenticated', return_value=True), patch.object(s, 'upstream', return_value={'mode':'not-configured'}):
            status, _, body = self.call({'message':'help'})
            self.assertTrue(status.startswith('503'))
            self.assertEqual(body['code'], 'ai-not-configured')
            self.assertIn('Please connect an LLM to get results', body['error'])

    def test_failures_and_limits(self):
        with patch.object(s,'authenticated',return_value=True),patch.object(s,'upstream',side_effect=TimeoutError):
            self.assertTrue(self.call({'message':'help'})[0].startswith('503'))
        with patch.object(s,'allow_attempt',return_value=False):
            self.assertTrue(self.call({'message':'help'})[0].startswith('429'))
        for _ in range(4):s.SLOTS.acquire()
        try:
            with patch.object(s,'authenticated',return_value=True):
                self.assertTrue(self.call({'message':'help'})[0].startswith('429'))
        finally:
            for _ in range(4):s.SLOTS.release()

if __name__ == '__main__': unittest.main()
