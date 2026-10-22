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
