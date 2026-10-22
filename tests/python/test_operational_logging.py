"""Log records explain failures without exporting payloads or credential strings."""
import contextlib
import io
import json
import os
import sys
from pathlib import Path
import unittest
from unittest.mock import patch
sys.path[:0]=[str(Path(__file__).resolve().parents[2]/'services/ai-gateway/lib')]
import runtime

class OperationalLogging(unittest.TestCase):
    def test_context_fields_allowlist_and_level(self):
        output=io.StringIO()
        token=runtime.ctx.set({'service':'ai-gateway','traceId':'a'*32})
        try:
            with contextlib.redirect_stdout(output),patch.dict(os.environ,LOG_LEVEL='INFO'):
                runtime.log_event('checkout_reserved',orderId='order-1',password='secret',prompt='private',authorization='Bearer secret')
                runtime.log_event('probe_ok','DEBUG')
            record=json.loads(output.getvalue())
            self.assertEqual(record['traceId'],'a'*32)
            self.assertEqual(record['event'],'checkout_reserved')
            self.assertEqual(record['orderId'],'order-1')
            self.assertIn('timestamp',record)
            self.assertNotIn('secret',output.getvalue());self.assertNotIn('private',output.getvalue())
        finally:runtime.ctx.reset(token)

    def test_dependency_failure_no_url_credentials_query_or_exception_message(self):
        output=io.StringIO()
        with contextlib.redirect_stdout(output),patch.object(runtime,'_request',side_effect=runtime.HttpError(503,'private upstream response')):
            with self.assertRaises(runtime.HttpError):
                runtime.request('https://user:secret@catalogue.example/path?token=private',{'prompt':'private'})
        record=json.loads(output.getvalue())
        self.assertEqual(record['dependency'],'catalogue.example')
        self.assertEqual(record['status'],503)
        self.assertEqual(record['level'],'ERROR')
        self.assertNotIn('private',output.getvalue());self.assertNotIn('secret',output.getvalue())

    def test_stdout_failure_does_not_change_checkout_result(self):
        with patch('builtins.print',side_effect=BrokenPipeError):
            runtime.log_event('checkout_reserved',orderId='order-1')
