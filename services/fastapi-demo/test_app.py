import unittest
from fastapi.testclient import TestClient
from app import app, get_products


class DemoTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.addCleanup(self.client.close)
        self.addCleanup(app.dependency_overrides.clear)

    def test_docs_and_schema(self):
        self.assertEqual(self.client.get('/docs').status_code, 200)
        schema = self.client.get('/openapi.json').json()
        self.assertIn('/estimates', schema['paths'])
        self.assertIn('EstimateRequest', schema['components']['schemas'])

    def test_health_and_filter(self):
        self.assertEqual(self.client.get('/ready').status_code, 200)
        rows = self.client.get('/products?q=ROVER').json()
        self.assertEqual(len(rows), 1)
        self.assertTrue(rows[0]['sample'])
        self.assertEqual(self.client.get('/products/missing').status_code, 404)

    def test_estimate(self):
        result = self.client.post('/estimates', json={'sku':'SAMPLE-ROVER','quantity':2})
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.json()['subtotal_minor'], 99800)
        self.assertTrue(result.json()['sample'])

    def test_validation(self):
        for quantity in [0, 21, 1.5, True, '2']:
            with self.subTest(quantity=quantity):
                self.assertEqual(self.client.post('/estimates', json={'sku':'SAMPLE-ROVER','quantity':quantity}).status_code,422)
        self.assertEqual(self.client.post('/estimates',json={'sku':'SAMPLE-ROVER','quantity':1,'price_minor':1}).status_code,422)
        self.assertEqual(self.client.post('/estimates',json={'sku':'missing','quantity':1}).status_code,404)

    def test_dependency_override(self):
        app.dependency_overrides[get_products] = lambda: ()
        self.assertEqual(self.client.get('/products').json(), [])

if __name__ == '__main__':
    unittest.main()
