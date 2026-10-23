import json
import sys
from pathlib import Path
import unittest
from unittest.mock import Mock
sys.path[:0]=[str(Path(__file__).resolve().parents[1]),str(Path(__file__).resolve().parents[1]/'lib')]
from agent import answer
from conversation import reference_skus

CONFIG={'provider':'ollama','model':'mock'}
def product(sku,price=400,currency='INR',kind='vacuum',**extra):
    return dict(sku=sku,name='Robot '+kind,description=kind,categories=[kind],price=price,currency=currency,instock=3,priceType='sale',**extra)
class Constraints(unittest.TestCase):
    def run_answer(self,question,products,history=None):
        provider=Mock(return_value={'answer':'ok','input_tokens':1,'output_tokens':1})
        result=answer(products,question,CONFIG,generate=provider,history=history)
        if result['status']=='success':
            provider.assert_called_once()
            self.assertEqual([p['sku'] for p in result['products']],[p['sku'] for p in json.loads(provider.call_args.args[2])['catalogueEvidence']])
        else:provider.assert_not_called()
        return result
    def test_codes_symbols_amounts(self):
        for currency,forms in [('INR',['under INR 500','under ₹500','under 500 INR','under inr 1,000.50','under INR 1 000.50','under INR 1,00,000.50']),('USD',['below USD 100','below $100']),('EUR',['budget of EUR 200','budget of €200']),('GBP',['below GBP 100','below £100']),('SGD',['under SGD 100','under S$100']),('AUD',['under AUD 100','under A$100'])]:
            for phrase in forms:
                with self.subTest(phrase=phrase):
                    rows=[product('OK',50,currency),product('EXPENSIVE',1000001,currency),product('WRONG',1,'USD' if currency!='USD' else 'INR')]
                    result=self.run_answer('Find a robot vacuum '+phrase,rows)
                    self.assertEqual([p['sku'] for p in result['products']],['OK'])
    def test_clarification_for_conflicts_and_ambiguous_budget(self):
        for phrase in ['under INR 500 USD','under 500','under ¥500','under EUR 1,00','under INR 500 below INR 200','under XYZ 500','under INR 500-600','under INR 500.50.99']:
            result=self.run_answer('vacuum '+phrase,[product('A'),product('B',currency='USD')])
            self.assertEqual(result['status'],'clarification');self.assertEqual(result['products'],[])
    def test_new_search_and_true_followups(self):
        rows=[product('ARM',30,kind='arm'),product('VAC',40)]
        history=[{'message':'arm','answer':'old price is untrusted','products':[{'sku':'ARM'}]}]
        self.assertIsNone(reference_skus(rows,'What is the cheapest robot vacuum?',history))
        self.assertEqual([p['sku'] for p in self.run_answer('What is the cheapest robot vacuum?',rows,history)['products']],['VAC'])
        for question in ['Which of those is cheaper?','Compare those two.','Is that one available?']:
            self.assertEqual([p['sku'] for p in self.run_answer(question,rows,history)['products']],['ARM'])
        result=self.run_answer('Which of those vacuum robots is cheaper?',rows,history)
        self.assertEqual(result['status'],'clarification')
    def test_unresolved_and_unavailable_references_do_not_broaden(self):
        history=[{'products':[{'sku':'OLD'}]}]
        for rows in ([product('NEW')],[product('OLD',archived=True),product('NEW')],[dict(product('OLD'),instock=0),product('NEW')]):
            result=self.run_answer('Compare those two.',rows,history)
            self.assertEqual(result['status'],'clarification');self.assertEqual(result['products'],[])
    def test_on_request_stock_and_provenance(self):
        rows=[dict(product('ASK',0),priceType='on-request'),dict(product('EMPTY'),instock=0),product('ARCHIVED',archived=True),product('OK',demo=True,fulfilment='simulated')]
        result=self.run_answer('vacuum under INR 500',rows)
        self.assertEqual([p['sku'] for p in result['products']],['OK']);self.assertTrue(result['products'][0]['demo'])

    def test_decimal_boundary_and_literal_reproduction(self):
        for question in ['Find a robot vacuum under INR 500','Find a robot vacuum under ₹500']:
            result=self.run_answer(question,[product('OK',500),product('OVER',10000)])
            self.assertEqual([p['sku'] for p in result['products']],['OK'])
        result=self.run_answer('vacuum under INR 1,000.50',[product('OK',1000.50),product('OVER',1000.51)])
        self.assertEqual([p['sku'] for p in result['products']],['OK'])
