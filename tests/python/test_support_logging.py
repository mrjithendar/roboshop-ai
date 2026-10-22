import importlib.util
import pathlib
import unittest
from unittest.mock import Mock, patch
import urllib.error

ROOT=pathlib.Path(__file__).resolve().parents[2]
class SupportLoggingTests(unittest.TestCase):
    def runtimes(self):
        for path in ROOT.glob('services/*/lib/runtime.py'):
            spec=importlib.util.spec_from_file_location('support_runtime',path)
            module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
            yield module
    def test_readable_format_is_single_line_and_logger_failure_is_safe(self):
        for r in self.runtimes():
            with patch.dict(r.os.environ, LOG_FORMAT='text'):
                value=r.format_log({'timestamp':'2026-10-22','service':'user-service','level':'WARN','event':'user_login_failed','username':'a\nb@example.com'})
                self.assertIn('User failed to log in',value)
                self.assertNotIn('\n',value)
                with patch('builtins.print',side_effect=OSError('sink unavailable')):
                    r.log_event('request_failed','ERROR')

    def test_safe_reasons_and_secret_redaction(self):
        for r in self.runtimes():
            self.assertEqual(r.error_details(r.HttpError(401,'Invalid email or password.'))['errorCode'],'AUTH_INVALID_CREDENTIALS')
            self.assertNotIn('secret-password',str(r.error_details(ValueError('secret-password'))))
    def test_read_retries_once_with_shared_budget(self):
        for r in self.runtimes():
            error=r.HttpError(503,'unavailable');error.__cause__=urllib.error.URLError('private-token')
            fn=Mock(side_effect=[error,{'ok':True}])
            with patch.object(r.time,'sleep'):
                self.assertEqual(r._retry_read(fn,'http://catalogue/products',None,None,2,None),{'ok':True})
            self.assertEqual(fn.call_count,2)
            self.assertLessEqual(fn.call_args.args[3],2)
    def test_writes_probes_and_auth_never_retry(self):
        for r in self.runtimes():
            for url,method,data,status in [('http://payments/orders','POST',{},503),('http://app/ready','GET',None,503),('http://app/products','GET',None,401)]:
                error=r.HttpError(502,'unavailable');error.__cause__=urllib.error.HTTPError(url,status,'private',{},None)
                fn=Mock(side_effect=error)
                with self.assertRaises(r.HttpError):r._retry_read(fn,url,data,None,2,method)
                self.assertEqual(fn.call_count,1)
