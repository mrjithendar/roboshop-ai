import io
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch
import mongomock
ROOT=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(ROOT),str(ROOT/'lib')]
from chat_history import ChatHistory
from server import Gateway
from store import Store
from runtime import Request, HttpError

class HistoryTests(unittest.TestCase):
    def setUp(self):
        env=patch.dict(os.environ,{'USER_SERVICE_TOKEN':'u'*64,'LLM_SERVICE_TOKEN':'l'*64});env.start();self.addCleanup(env.stop)
        self.db=mongomock.MongoClient().db
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.store=Store(self.tmp.name);self.addCleanup(self.store.close)
        self.gateway=Gateway(self.db,self.store)
        self.gateway.auth.current=Mock(return_value={'id':'alice','role':'customer'})
        self.gateway.catalogue=lambda **kwargs: []
        self.gateway.llm.current=lambda: {'config':{'provider':'bedrock','model':'mock'},'revision':1}

    def req(self,path,body=None,auth=True):
        raw=json.dumps(body).encode() if body is not None else b''
        return Request({'PATH_INFO':path,'REQUEST_METHOD':'GET' if body is None else 'POST','CONTENT_LENGTH':str(len(raw)),'CONTENT_TYPE':'application/json','wsgi.input':io.BytesIO(raw),'HTTP_COOKIE':'rs_auth='+'a'*64,'HTTP_AUTHORIZATION':'Bearer '+('l'*64 if auth else 'wrong')})

    def test_resume_uses_saved_context_and_new_repository_retains_turns(self):
        with patch('server.request',return_value={'answer':'Choose a budget','products':[],'mode':'ai'}) as provider:
            self.gateway.handle(self.req('/api/chat',{'message':'Personal assistance'}))
            self.gateway.handle(self.req('/api/chat',{'message':'Under 500'}))
            self.assertIn('Personal assistance',provider.call_args.args[1]['message'])
            self.assertIn('Choose a budget',provider.call_args.args[1]['message'])
        turns=ChatHistory(self.db).read('alice');self.assertEqual(len(turns),2)
        self.assertEqual(turns[-1]['message'],'Under 500')
        self.assertNotIn('config',turns[-1]);self.assertNotIn('token',str(turns))

    def test_history_is_owned_by_current_account_and_requires_both_auth_layers(self):
        self.gateway.chat_history.save('alice','private',{'answer':'private reply','products':[]})
        self.assertEqual(len(self.gateway.handle(self.req('/api/chat/history'))['turns']),1)
        self.gateway.auth.current.return_value={'id':'bob','role':'customer'}
        self.assertEqual(self.gateway.handle(self.req('/api/chat/history'))['turns'],[])
        request=self.req('/api/chat/history');request.query={'userId':'alice'}
        self.assertEqual(self.gateway.handle(request)['turns'],[])
        with self.assertRaises(HttpError):self.gateway.handle(self.req('/api/chat/history',auth=False))
        self.gateway.auth.current.return_value=None
        for req in [self.req('/api/chat/history'),self.req('/api/chat',{'message':'hello'})]:
            with self.assertRaises(HttpError) as error:self.gateway.handle(req)
            self.assertEqual(error.exception.status,401)

    def test_retention_atomic_pairs_and_no_save_on_provider_failure(self):
        for n in range(45):self.gateway.chat_history.save('alice',str(n),{'answer':str(n),'products':[]})
        turns=self.gateway.chat_history.read('alice');self.assertEqual(len(turns),40)
        self.assertEqual(turns[0]['message'],'5');self.assertTrue(all(t['message']==t['answer'] for t in turns))
        with patch('server.request',side_effect=HttpError(503,'provider offline')):
            self.assertEqual(self.gateway.handle(self.req('/api/chat',{'message':'failed'}))[1],503)
        self.assertEqual(self.gateway.chat_history.read('alice'),turns)

    def test_history_read_outage_stops_before_inference(self):
        with patch.object(self.gateway.chat_history.collection,'find_one',side_effect=RuntimeError('private mongo URL')),patch('server.request') as provider:
            with self.assertRaises(HttpError) as error:self.gateway.handle(self.req('/api/chat',{'message':'hello'}))
            self.assertEqual(error.exception.status,503);provider.assert_not_called()
            self.assertNotIn('private',str(error.exception))
