import sys,unittest,threading
from pathlib import Path
from types import SimpleNamespace
import mongomock
SERVICE=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(SERVICE),str(SERVICE/'lib')]
from admin import routes
from runtime import HttpError
class ImageTests(unittest.TestCase):
    def setUp(self):
        self.db=mongomock.MongoClient().db
        self.store=SimpleNamespace(catalogue_lock=threading.RLock(),lock=threading.RLock(),reserved=lambda *a:0,sold=lambda *a:0)
        self.body={'sku':'TEST','name':'Test','description':'Test','price':99,'instock':4,'categories':['robot'],'archived':False,'image':'/product-media/test.webp'}
    def request(self,method,body):
        return routes(SimpleNamespace(user={'id':'admin','role':'admin'},path='/api/admin/products'+('/TEST' if method=='PUT' else ''),method=method,body=lambda:body),self.db,None,self.store)
    def test_create_update_preserve_and_revision(self):
        self.request('POST',self.body)
        self.assertEqual(self.db.products.find_one({})['image'],self.body['image'])
        doc=self.db.products.find_one({})
        data={**self.body,'revision':doc['revision'],'image':'/images/new.png'}
        self.request('PUT',data)
        self.assertEqual(self.db.products.find_one({})['image'],'/images/new.png')
        with self.assertRaises(HttpError): self.request('PUT',data)
        data.pop('image');data['revision']=self.db.products.find_one({})['revision']
        self.request('PUT',data)
        self.assertEqual(self.db.products.find_one({})['image'],'/images/new.png')
    def test_invalid_sources_rejected(self):
        for image in ['https://example.com/x.png','javascript:alert(1)','/images/../x.png','//evil/x.png','/images/file.svg']:
            with self.assertRaises(HttpError): self.request('POST',{**self.body,'image':image})
        self.assertEqual(self.db.products.count_documents({}),0)
if __name__=='__main__': unittest.main()
