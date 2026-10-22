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
            self.assertEqual('Under 500',provider.call_args.args[1]['message'])
            self.assertIn('Personal assistance',str(provider.call_args.args[1]['history']))
            self.assertIn('Choose a budget',str(provider.call_args.args[1]['history']))
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

    def test_generation_context_cannot_cross_accounts(self):
        self.gateway.chat_history.save('alice','alice-private',{'answer':'alice-only','products':[]})
        self.gateway.auth.current.return_value={'id':'bob','role':'customer'}
        with patch('server.request',return_value={'answer':'bob-answer','products':[],'mode':'ai'}) as provider:
            self.gateway.handle(self.req('/api/chat',{'message':'bob-question'}))
            self.assertEqual(provider.call_args.args[1]['history'],[])
            self.assertNotIn('alice',str(provider.call_args.args))
        self.assertEqual(self.gateway.chat_history.read('alice')[0]['message'],'alice-private')

    def test_maximum_current_question_preserved_and_oversized_rejected(self):
        for n in range(2):self.gateway.chat_history.save('alice','q'*1000,{'answer':'a'*12000,'products':[]})
        with patch('server.request',return_value={'answer':'ok','products':[],'mode':'ai'}) as provider:
            self.gateway.handle(self.req('/api/chat',{'message':'x'*1000}))
            self.assertEqual(provider.call_args.args[1]['message'],'x'*1000)
            self.assertEqual(len(provider.call_args.args[1]['history']),2)
            provider.assert_called_once();provider.reset_mock()
            with self.assertRaises(HttpError):self.gateway.handle(self.req('/api/chat',{'message':'x'*1001}))
            provider.assert_not_called()

    def test_unicode_history_respects_internal_body_limit(self):
        for n in range(2):self.gateway.chat_history.save('alice','😀'*1000,{'answer':'😀'*12000,'products':[]})
        with patch('server.request',return_value={'answer':'ok','products':[],'mode':'ai'}) as provider:
            self.gateway.handle(self.req('/api/chat',{'message':'😀'*1000}))
            payload=provider.call_args.args[1]
            self.assertEqual(payload['message'],'😀'*1000)
            self.assertLessEqual(len(json.dumps(payload).encode()),16384)
