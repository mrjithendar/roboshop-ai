import base64
import importlib.util
import json
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('elk', Path(__file__).resolve().parents[1]/'scripts/observability/elk.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

def response(text='', code=0):
    return subprocess.CompletedProcess([], code, text, 'sensitive error text')

def existing():
    return json.dumps({'type':'Opaque','data':{k:base64.b64encode(b'x'*32).decode() for k in m.KEYS}})

class CredentialsTests(unittest.TestCase):
    def test_missing_creation_stdin(self):
        with patch.object(m.subprocess,'run',side_effect=[response(),response(),response(),response()]) as run:
            m.ensure_credentials('test')
        args=run.call_args
        values=json.loads(args.kwargs['input'])['stringData']
        self.assertEqual(set(values),set(m.KEYS))
        self.assertEqual(len(set(values.values())),len(m.KEYS))
        self.assertIn('create',args.args[0])
        self.assertTrue(all(len(v)==64 and v not in str(args.args[0]) for v in values.values()))

    def test_existing_unchanged(self):
        with patch.object(m.subprocess,'run',side_effect=[response('namespace/elk'),response(existing())]) as run:
            m.ensure_credentials('mk4')
        self.assertEqual(run.call_count,2)

    def test_invalid_preserved(self):
        for value in ('{}', '{"data":{"ingestPassword":"!"}}'):
            with patch.object(m.subprocess,'run',side_effect=[response('namespace/elk'),response(value)]) as run:
                with self.assertRaisesRegex(RuntimeError,'preserved'):
                    m.ensure_credentials('mk4')
                self.assertEqual(run.call_count,2)

    def test_concurrent_creation_reuses_winner(self):
        with patch.object(m.subprocess,'run',side_effect=[response('namespace/elk'),response(),response(code=1),response(existing())]) as run:
            m.ensure_credentials('mk4')
        self.assertEqual(run.call_count,4)

    def test_api_error_redacted(self):
        with patch.object(m.subprocess,'run',return_value=response(code=1)):
            with self.assertRaises(RuntimeError) as error:
                m.ensure_credentials('mk4')
        self.assertNotIn('sensitive error text',str(error.exception))

    def test_preview_offline(self):
        with patch.object(m.sys,'argv',['elk','sync','--app','elk-core']),patch.object(m.subprocess,'run') as run,patch.object(m.subprocess,'check_output') as read:
            m.main()
            run.assert_not_called();read.assert_not_called()

if __name__ == '__main__':
    unittest.main()
