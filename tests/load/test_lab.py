import json, os, subprocess, tempfile, threading, unittest
from pathlib import Path
from urllib.request import Request,urlopen
from urllib.error import HTTPError
from unittest.mock import patch
from http.server import ThreadingHTTPServer
import lab
import mocks
from identity import client_identity

class LoadGuards(unittest.TestCase):
 def test_synthetic_identities_are_bounded_and_do_not_trust_unknown_sessions(self):
  from unittest.mock import Mock
  users=lab.fixtures('load-identity',2)['users']
  original=Mock(return_value='127.0.0.1');resolve=client_identity(users,original)
  requests=[Mock() for _ in range(3)]
  for request,value in zip(requests,[users[0]['session'],users[1]['session'],'unknown']):request.cookie.return_value=value
  self.assertNotEqual(resolve(requests[0]),resolve(requests[1]))
  self.assertEqual(resolve(requests[0]),resolve(requests[0]))
  self.assertEqual(resolve(requests[2]),'127.0.0.1')
  original.assert_called_once_with(requests[2])

 def test_existing_run_preserved_before_services_start(self):
  with tempfile.TemporaryDirectory() as temporary:
   root=Path(temporary);run=root/'.runs/load-existing';run.mkdir(parents=True)
   marker=run/'summary.json';marker.write_text('existing results')
   with patch.object(lab,'HERE',root),patch.object(lab.subprocess,'Popen') as start:
    with self.assertRaisesRegex(lab.RunExistsError,'Omit --run-id'):
     with lab.running('load-existing',1):self.fail('Must not start')
    start.assert_not_called()
   self.assertEqual(marker.read_text(),'existing results')

 def test_run_identity_and_independent_sessions(self):
  for bad in ('../prod','', 'x'*41,'UPPER'):
   with self.assertRaises(ValueError):lab.safe_run(bad)
  f=lab.fixtures('load-test',50)
  self.assertEqual(len({u['session'] for u in f['users']}),50)
  self.assertEqual(len({u['id'] for u in f['users']}),50)
  self.assertTrue(all(p['demo'] and p['synthetic'] for p in f['products']))
 def test_durable_check_rejects_oversell_and_duplicates(self):
  with tempfile.TemporaryDirectory() as folder:
   path=Path(folder);f=lab.fixtures('load-test',1);(path/'fixtures.json').write_text(json.dumps(f));(path/'ledger').mkdir()
   order={'session':'one','key':'one','paymentMode':'test','demo':True,'items':[{'sku':'LOAD-LIMITED','quantity':4}]}
   (path/'ledger/store.json').write_text(json.dumps({'orders':[order,order]}))
   with self.assertRaises(RuntimeError):lab.verify(path)
 def test_mock_protocol_and_no_external_transport(self):
  state=mocks.State(lab.fixtures('load-test',1));server=ThreadingHTTPServer(('127.0.0.1',0),mocks.handler(state))
  thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
  base='http://127.0.0.1:'+str(server.server_port)
  try:
   with urlopen(base+'/api/tags') as r:self.assertEqual(json.load(r)['models'][0]['name'],'load-mock')
   body={'messages':[{'role':'system','content':'test'},{'role':'user','content':json.dumps({'request':'vacuum','catalogueEvidence':[]})}]}
   with urlopen(Request(base+'/api/chat',data=json.dumps(body).encode())) as r:self.assertTrue(json.load(r)['done'])
   with patch.dict(os.environ,MOCK_ERROR_EVERY='1',MOCK_STATUS='429'):
    with self.assertRaises(HTTPError) as error:urlopen(Request(base+'/api/chat',data=json.dumps(body).encode()))
    self.assertEqual(error.exception.code,429)
  finally:server.shutdown();server.server_close();thread.join()
 def test_k6_rejects_unallowlisted_target_before_requests(self):
  k6=Path(__file__).parent/'.tools/k6'
  if not k6.exists():self.skipTest('Install pinned k6 first')
  with tempfile.TemporaryDirectory() as folder:
   f=lab.fixtures('load-guard',1);f['baseUrl']='http://127.0.0.1:1';path=Path(folder)/'fixture.json';path.write_text(json.dumps(f))
   env={**os.environ,'FIXTURES':str(path),'RUN_ID':'load-guard','BASE_URL':f['baseUrl'],'TARGET_ALLOWLIST':'','VUS':'1'}
   result=subprocess.run([str(k6),'inspect','--include-system-env-vars',str(Path(__file__).parent/'load.js')],env=env,capture_output=True,text=True)
   self.assertNotEqual(result.returncode,0);self.assertIn('allowlist required',result.stderr)
