import copy
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import mongomock

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / 'services/ai-gateway/lib'), str(ROOT / 'services/ai-gateway'), str(ROOT / 'services/moks')]
from runtime import HttpError, Request
from store import Store
from server import Gateway
from product_details import related, require_purchasable
from catalogue import retrieve
from moks_agent import import_agent
answer = import_agent().answer

ROWS = json.loads((ROOT / 'services/catalogue-service/reference-products.json').read_text())

class ReferenceTests(unittest.TestCase):
    def test_reference_retrieval_without_fake_stock_and_budget_currency(self):
        self.assertTrue(retrieve(ROWS, 'RP2040'))
        self.assertTrue(retrieve(ROWS, 'under $200'))
        self.assertEqual(retrieve(ROWS, 'under ₹999'), [])
        self.assertTrue(all(p['instock'] == 0 for p in retrieve(ROWS, 'RP2040')))
        unknown = dict(ROWS[0], priceType='on-request', price=0)
        self.assertEqual(retrieve([unknown], 'under $200'), [])
        self.assertTrue(related(ROWS[0], ROWS))

    def test_all_reference_variants_rejected_even_with_forged_sale_flags(self):
        for p in ROWS:
            for row in [p, dict(p, priceType='sale', showcase=False)]:
                with self.assertRaises(HttpError):
                    require_purchasable(row)
        with tempfile.TemporaryDirectory() as directory:
            store = Store(directory)
            session = store.session(None, 'alice')
            with self.assertRaises(HttpError):
                store.update(session, ROWS[0]['sku'], 1, ROWS)
            store.state['sessions'][session]['items'][ROWS[0]['sku']] = 1
            with self.assertRaises(HttpError):
                store.begin_payment(session, 'a' * 32, ROWS)
            self.assertEqual(store.state['orders'], [])

    def test_comparison_does_not_mix_price_types_or_collections(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {'USER_SERVICE_TOKEN': 'u'*64}):
            gateway = Gateway(mongomock.MongoClient(tz_aware=True).db, Store(directory))
            rows = copy.deepcopy(ROWS[:2])
            gateway.catalogue = lambda: rows
            gateway.auth.current = lambda token: None
            req = Request({'REQUEST_METHOD':'GET','PATH_INFO':'/api/compare','QUERY_STRING':'skus='+','.join(p['sku'] for p in rows)})
            self.assertEqual(gateway.handle(req)['lowestPrice'], 194.95)
            rows[1]['priceType'] = 'sale'
            self.assertIsNone(gateway.handle(req)['lowestPrice'])
            rows[1]['priceType'] = 'on-request'
            self.assertIsNone(gateway.handle(req)['lowestPrice'])
            rows[1]['priceType'] = 'reference'; rows[1]['currency'] = 'INR'
            self.assertIsNone(gateway.handle(req)['lowestPrice'])

    def test_ai_evidence_preserves_reference_price_and_source_context(self):
        def generate(config, instructions, prompt, revision, operation):
            self.assertIn('not merchant offers', instructions)
            evidence = json.loads(prompt)['catalogueEvidence']
            self.assertTrue(evidence)
            for item in evidence:
                self.assertEqual(item['collection'], 'reference')
                self.assertEqual(item['priceType'], 'reference')
                self.assertEqual(item['instock'], 0)
                self.assertEqual(item['fulfilment'], 'simulated')
                self.assertTrue(item['priceSourceUrl']); self.assertTrue(item['priceCheckedAt'])
                self.assertTrue(item['compatibility']); self.assertTrue(item['unresolvedFields'])
            return {'answer':'Reference guidance', 'input_tokens':1, 'output_tokens':1}
        result = answer(ROWS, 'RP2040', {'provider':'ollama', 'model':'mock'}, generate=generate)
        self.assertEqual(result['status'], 'success')
