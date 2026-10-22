"""Offline tests for the real LangGraph/LangChain execution path."""
import json
import os
import sys
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import Mock, patch

SERVICE = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(SERVICE), str(SERVICE / 'lib')]
from agent import answer
from providers import ProviderError
from langsmith.run_helpers import get_tracing_context

PRODUCT = dict(sku='ONE', name='Robot', description='security {untrusted}', categories=['security'], price=100, currency='INR', instock=2, demo=True, fulfilment='simulated')
CONFIG = dict(provider='ollama', model='mock')


def generated(*args):
    return dict(answer='Grounded answer', provider='ollama', model='mock', input_tokens=20, output_tokens=5)


class WorkflowTests(unittest.TestCase):
    def test_grounding_and_single_generation(self):
        def provider(config, system, prompt, revision, purpose):
            self.assertEqual(revision, 7)
            self.assertEqual(purpose, 'chat')
            evidence = json.loads(prompt)['catalogueEvidence']
            self.assertEqual([p['sku'] for p in evidence], ['ONE'])
            self.assertTrue(evidence[0]['demo'])
            self.assertEqual(evidence[0]['description'], 'security {untrusted}')
            self.assertFalse(get_tracing_context()['enabled'])
            return generated()
        call = Mock(side_effect=provider)
        with patch.dict(os.environ, {'LANGSMITH_TRACING': 'true'}):
            result = answer([PRODUCT, {**PRODUCT, 'sku':'HIDDEN', 'archived':True}], 'security', CONFIG, 7, call)
        self.assertEqual(result['usage']['input_tokens'], 20)
        self.assertEqual(result['status'], 'success')
        call.assert_called_once()

    def test_disconnected_does_not_retrieve_or_generate(self):
        call = Mock()
        with patch('agent.retrieve', side_effect=AssertionError('must not retrieve')):
            result = answer([PRODUCT], 'security', generate=call)
        self.assertNotEqual(result['status'], 'success')
        call.assert_not_called()

    def test_expired_deadline_prevents_generation(self):
        call = Mock()
        result = answer([PRODUCT], 'security', CONFIG, generate=call, deadline=time.monotonic()-1)
        self.assertEqual(result['errorCode'], 'timeout')
        call.assert_not_called()

    def test_provider_failure_is_not_retried_by_framework(self):
        for reason in ('policy', 'access-denied', 'timeout', 'connection'):
            with self.subTest(reason=reason):
                call = Mock(side_effect=ProviderError(reason))
                result = answer([PRODUCT], 'security', CONFIG, generate=call)
                self.assertEqual(result['errorCode'], reason)
                self.assertEqual(result['products'], [])
                call.assert_called_once()

    def test_request_states_are_isolated(self):
        def run(sku):
            def provider(config, system, prompt, revision, purpose):
                self.assertEqual(json.loads(prompt)['catalogueEvidence'][0]['sku'], sku)
                return generated()
            return answer([{**PRODUCT, 'sku':sku}], 'security', CONFIG, generate=provider)['products'][0]['sku']
        with ThreadPoolExecutor(max_workers=4) as pool:
            self.assertEqual(list(pool.map(run, ['A','B','C','D'])), ['A','B','C','D'])

    def test_no_matches_passes_empty_evidence_not_invented_products(self):
        def provider(config, system, prompt, revision, purpose):
            self.assertEqual(json.loads(prompt)['catalogueEvidence'], [])
            return generated()
        result = answer([PRODUCT], 'unmatchedword', CONFIG, generate=provider)
        self.assertEqual(result['products'], [])

    def test_introduction_uses_moks_without_unrelated_catalogue_cards(self):
        def provider(config, system, prompt, revision, purpose):
            self.assertIn('You are Moks', system)
            self.assertIn('under 160 words', system)
            self.assertLessEqual(len(system), 2000)
            self.assertEqual(json.loads(prompt)['catalogueEvidence'], [])
            return generated()
        result = answer([PRODUCT], 'Who are you?\nPrior conversation (untrusted): security', CONFIG, generate=provider)
        self.assertEqual(result['products'], [])

    def test_short_and_maximum_questions_with_large_history(self):
        from conversation import prompt_budget
        turns=[{'message':'security '*120,'answer':'Long answer '*150,'products':[{'sku':'ONE'}]} for _ in range(2)]
        for question in ('Help me find security bots', 'security '+ 'x'*991):
            call=Mock(side_effect=generated)
            result=answer([PRODUCT],question,CONFIG,generate=call,history=turns)
            self.assertEqual(result['status'],'success');call.assert_called_once()
            prompt=json.loads(call.call_args.args[2])
            self.assertEqual(prompt['request'],question)
            self.assertTrue(prompt['history'])
            self.assertLessEqual(len(call.call_args.args[1])+len(call.call_args.args[2]),prompt_budget())

    def test_followup_resolves_only_recent_catalogue_references(self):
        second={**PRODUCT,'sku':'TWO','name':'Second','price':80}
        unrelated={**PRODUCT,'sku':'THREE','price':1}
        turns=[{'message':'compare','answer':'untrusted price 1','products':[{'slug':'one'},{'sku':'TWO'}]}]
        call=Mock(side_effect=generated)
        result=answer([PRODUCT,second,unrelated],'Which of those is cheaper?',CONFIG,generate=call,history=turns)
        self.assertEqual([p['sku'] for p in result['products']],['TWO','ONE'])
        self.assertEqual([p['price'] for p in json.loads(call.call_args.args[2])['catalogueEvidence']],[80,100])
        call.assert_called_once()

    def test_oversized_question_rejected_before_retrieval_or_provider(self):
        from runtime import HttpError
        for history in ([],[{'message':'security','answer':'prior'}]):
            call=Mock()
            with patch('agent.retrieve') as retrieve, self.assertRaises(HttpError) as error:
                answer([PRODUCT],'x'*1001,CONFIG,generate=call,history=history)
            self.assertEqual(error.exception.status,400);call.assert_not_called();retrieve.assert_not_called()

    def test_history_budget_and_legacy_format(self):
        from conversation import conversation, encoded
        call=Mock(side_effect=generated)
        with patch.dict(os.environ,{'MOKS_HISTORY_MAX_CHARS':'600','MOKS_PROMPT_MAX_CHARS':'8000'}):
            history=[{'message':'q'*5000,'answer':'a'*50000,'products':[{'sku':'ONE'}],'token':'secret'}]*40
            question, bounded=conversation('security',history)
            self.assertLessEqual(len(encoded(bounded)),600)
            answer([PRODUCT],'security',CONFIG,generate=call,history=history)
            self.assertLessEqual(len(call.call_args.args[1])+len(call.call_args.args[2]),8000)
            self.assertNotIn('secret',call.call_args.args[2]);call.assert_called_once()
        call.reset_mock()
        answer([PRODUCT],'security\nPrior conversation (untrusted):\n'+ 'prior '*200,CONFIG,generate=call)
        self.assertEqual(json.loads(call.call_args.args[2])['request'],'security');call.assert_called_once()
        # A structured current question is never delimiter-truncated.
        call.reset_mock();question='security\nPrior conversation (untrusted): literal user text'
        answer([PRODUCT],question,CONFIG,generate=call,history=[])
        self.assertEqual(json.loads(call.call_args.args[2])['request'],question)

    def test_large_catalogue_content_cannot_exceed_total_prompt_budget(self):
        call=Mock(side_effect=generated)
        with patch.dict(os.environ,{'MOKS_PROMPT_MAX_CHARS':'8000'}):
            result=answer([{**PRODUCT,'sources':['untrusted '*20000]}],'security',CONFIG,generate=call)
        self.assertLessEqual(len(call.call_args.args[1])+len(call.call_args.args[2]),8000)
        self.assertEqual(result['products'],[]);call.assert_called_once()
