"""One listener dispatches public UI and authenticated private engine routes."""
import io
import json
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

SERVICE = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(SERVICE), str(SERVICE / 'lib')]
import server
import widget

class CombinedTests(unittest.TestCase):
    def setUp(self):
        env = patch.dict(os.environ, {'LLM_SERVICE_TOKEN': 'x' * 64})
        env.start(); self.addCleanup(env.stop)
        self.app = server.create_application()

    def call(self, path, body=None, token=None):
        raw = json.dumps(body).encode() if body is not None else b''
        env = {'PATH_INFO': path, 'REQUEST_METHOD': 'POST' if body is not None else 'GET',
               'CONTENT_LENGTH': str(len(raw)), 'wsgi.input': io.BytesIO(raw),
               'CONTENT_TYPE': 'application/json', 'HTTP_ORIGIN': 'https://jithendar.com'}
        if token: env['HTTP_AUTHORIZATION'] = 'Bearer ' + token
        result = []
        content = b''.join(self.app(env, lambda status, headers: result.append(status)))
        return int(result[0].split()[0]), content

    def test_branding_and_health_share_listener_without_remote_calls(self):
        with patch.object(widget, 'upstream', side_effect=AssertionError('No remote call')), patch.object(server, 'request', side_effect=AssertionError('No remote call')):
            status, body = self.call('/widget.js')
            self.assertEqual(status, 200)
            self.assertIn(b'An AI agent for everyone.', body)
            self.assertEqual(self.call('/health')[0], 200)

    def test_private_routes_still_require_service_auth(self):
        payload = {'config': {'provider': 'none'}, 'revision': 0, 'message': 'Hello'}
        self.assertEqual(self.call('/internal/chat', payload)[0], 403)
        status, body = self.call('/internal/chat', payload, 'x' * 64)
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)['mode'], 'not-configured')

    def test_public_chat_does_not_accept_service_token_in_place_of_login(self):
        with patch.object(widget, 'authenticated', return_value=False), patch.object(widget, 'upstream') as upstream:
            self.assertEqual(self.call('/chat', {'message': 'Hello'}, 'x' * 64)[0], 401)
            upstream.assert_not_called()

    def test_readiness_has_no_self_or_model_probe(self):
        self.assertNotIn('moks:', ','.join(widget.HEALTH_URLS))
        with patch.object(server, 'request', return_value={'ready': True}) as remote, patch.object(server, 'route', side_effect=AssertionError('No generation')):
            self.assertEqual(self.call('/ready')[0], 200)
            self.assertEqual(remote.call_count, 1)
            self.assertTrue(remote.call_args.args[0].endswith('/api/catalogue/ready'))

    def test_four_widget_calls_can_reenter_private_engine_on_same_listener(self):
        from concurrent.futures import ThreadPoolExecutor
        from threading import Thread
        from urllib.request import Request, urlopen
        from waitress import create_server
        listener = create_server(self.app, host='127.0.0.1', port=0, threads=16)
        thread = Thread(target=listener.run, daemon=True)
        thread.start()
        base = 'http://127.0.0.1:' + str(listener.effective_port)
        def post(path, data, internal=False):
            headers = {'Content-Type': 'application/json', 'Origin': 'https://jithendar.com'}
            if internal: headers['Authorization'] = 'Bearer ' + 'x' * 64
            with urlopen(Request(base + path, data=json.dumps(data).encode(), headers=headers), timeout=3) as response:
                return response.status, json.load(response)
        def gateway_callback(*args, **kwargs):
            # Simulate the gateway's authenticated callback, without any provider I/O.
            status, body = post('/internal/chat', {'config': {'provider': 'none'}, 'revision': 0, 'message': 'Hi'}, True)
            self.assertEqual(status, 200)
            return body
        try:
            with patch.object(widget, 'authenticated', return_value=True), patch.object(widget, 'allow_attempt', return_value=True), patch.object(widget, 'upstream', side_effect=gateway_callback):
                def call(_):
                    from urllib.error import HTTPError
                    try: return post('/chat', {'message': 'Hi'})
                    except HTTPError as error: return error.code, json.load(error)
                with ThreadPoolExecutor(max_workers=4) as clients:
                    results = list(clients.map(call, range(4)))
                self.assertTrue(all(code == 503 and data['code'] == 'ai-not-configured' for code, data in results))
        finally:
            listener.close()
            listener.task_dispatcher.shutdown()
