"""Verify the existing OTLP export contract without contacting Langfuse."""
import base64
import json
import os
import sys
import time
import unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'lib'))
import runtime


class LangfuseTests(unittest.TestCase):
    def test_metadata_auth_and_trace_parent(self):
        context = dict(traceId='a'*32, spanId='b'*16, parentSpanId='c'*16, attributes={'gen_ai.request.model':'mock','gen_ai.usage.input_tokens':10})
        env = dict(LANGFUSE_BASE_URL='http://langfuse-web.langfuse.svc.cluster.local:3000', LANGFUSE_PUBLIC_KEY='pk-lf-test', LANGFUSE_SECRET_KEY='sk-lf-test')
        with patch.dict(os.environ, env, clear=True), patch.object(runtime, '_request') as send, patch.object(runtime.exports, 'submit', side_effect=lambda fn,*args:fn(*args)):
            runtime.telemetry('moks', context, time.time_ns(), 'llm chat', 200)
        url, payload, headers = send.call_args.args
        self.assertTrue(url.endswith('/api/public/otel/v1/traces'))
        self.assertEqual(headers['x-langfuse-ingestion-version'], '4')
        self.assertEqual(headers['Authorization'], 'Basic '+base64.b64encode(b'pk-lf-test:sk-lf-test').decode())
        span=payload['resourceSpans'][0]['scopeSpans'][0]['spans'][0]
        self.assertEqual(span['parentSpanId'], 'c'*16)
        self.assertNotIn('sk-lf-test', json.dumps(payload))

    def test_missing_keys_or_other_service_do_not_export(self):
        context=dict(traceId='a'*32,spanId='b'*16,attributes={})
        with patch.dict(os.environ, {}, clear=True), patch.object(runtime.exports,'submit') as send:
            runtime.telemetry('moks',context,time.time_ns(),'request',200)
            send.assert_not_called()

    def test_export_failure_does_not_fail_request(self):
        env=dict(LANGFUSE_BASE_URL='http://langfuse',LANGFUSE_PUBLIC_KEY='pk',LANGFUSE_SECRET_KEY='sk')
        with patch.dict(os.environ,env,clear=True), patch.object(runtime,'_request',side_effect=TimeoutError), patch.object(runtime.exports,'submit',side_effect=lambda fn,*args:fn(*args)):
            runtime.telemetry('moks',dict(traceId='a'*32,spanId='b'*16,attributes={}),time.time_ns(),'request',200)
