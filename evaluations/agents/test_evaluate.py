import json
from pathlib import Path
import unittest
from evaluate import evaluate,score_payloads,DATASET
class Evaluations(unittest.TestCase):
 def setUp(self):self.dataset=json.loads(DATASET.read_text());self.case=self.dataset['cases'][0]
 def result(self,products):return {'products':products,'traceId':'a'*32,'observationId':'b'*16}
 def test_correct_prices_and_linkage(self):
  row=self.result([self.dataset['products'][0]])
  scores=list(score_payloads(self.dataset,self.case,row))
  self.assertTrue(all(s['value']==1 for s in scores));self.assertEqual(scores[0]['traceId'],'a'*32);self.assertEqual(scores[0]['observationId'],'b'*16)
  self.assertEqual(scores,list(score_payloads(self.dataset,self.case,row)))
 def test_fabricated_product_price_and_currency_fail(self):
  for products,key in [([{'sku':'imaginary'}],'valid_product_ids'),([{**self.dataset['products'][0],'price':1}],'accurate_prices'),([self.dataset['products'][1]],'budget_and_currency'),([self.dataset['products'][2]],'available_products')]:
   self.assertEqual(evaluate(self.dataset,self.case,self.result(products))[key],0)
 def test_no_match_and_unsupported_claims(self):
  self.assertEqual(evaluate(self.dataset,self.dataset['cases'][4],self.result([]))['matching_products'],1)
  row={**self.result([]),'claims':[{'sku':'FIX-KIT','field':'flight','value':True}]}
  self.assertEqual(evaluate(self.dataset,self.dataset['cases'][5],row)['supported_structured_claims'],0)
 def test_missing_execution_ids_rejected(self):
  with self.assertRaises(ValueError):list(score_payloads(self.dataset,self.case,{'products':[]}))
