import base64
import io
import os
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import mongomock
from PIL import Image

SERVICE = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(SERVICE), str(SERVICE / 'lib')]
from user_profile import read_profile, update_profile, update_photo
from runtime import HttpError, Request
from server import UserService

class ProfileTests(unittest.TestCase):
    def setUp(self):
        env = patch.dict(os.environ, {"USER_SERVICE_TOKEN": "u" * 64})
        env.start(); self.addCleanup(env.stop)
        self.db = mongomock.MongoClient(tz_aware=True).db
        self.db.users.insert_many([{'_id': key, 'name': key, 'email': key+'@example.com', 'role':'customer', 'passwordHash':'private'} for key in ['alice','bob']])
        self.data = dict(name='Alice Updated', phone='+91 12345 67890', company='Robotics', jobTitle='Engineer', bio='Build robots\nLearn automation', countryCode='IN', timezone='Asia/Kolkata')

    def test_profile_edits_are_scoped_and_identity_fields_are_protected(self):
        result = update_profile(self.db, 'alice', self.data)
        self.assertEqual(result['user']['name'], 'Alice Updated')
        self.assertEqual(self.db.users.find_one({'_id':'bob'})['name'], 'bob')
        self.assertNotIn('passwordHash', json.dumps(result))
        for key in ['role','email','disabled','userId','lastLoginIp']:
            with self.assertRaises(HttpError): update_profile(self.db, 'alice', {**self.data,key:'superadmin'})
        for change in [dict(name=''),dict(bio='x'*501),dict(phone='invalid'),dict(timezone='not/a/zone')]:
            with self.assertRaises(HttpError): update_profile(self.db, 'alice', {**self.data,**change})

    def test_photo_is_decoded_resized_and_can_be_removed(self):
        output=io.BytesIO();Image.new('RGB',(250,200),'red').save(output,format='PNG')
        photo='data:image/png;base64,'+base64.b64encode(output.getvalue()).decode()
        saved=update_photo(self.db,'alice',{'image':photo})['photo']
        self.assertTrue(saved.startswith('data:image/jpeg;base64,'))
        with Image.open(io.BytesIO(base64.b64decode(saved.split(',')[1]))) as image:
            self.assertEqual(image.size,(128,128));self.assertFalse(image.getexif())
        self.assertEqual(read_profile(self.db,'alice')['photo'],saved)
        self.assertEqual(read_profile(self.db,'bob')['photo'],'')
        self.assertEqual(update_photo(self.db,'alice',{'image':''})['photo'],'')
        for value in ['https://example.com/photo.jpg','data:image/svg+xml;base64,PHN2Zz4=', 'data:image/png;base64,YmFk', 'x'*12001]:
            with self.assertRaises(HttpError):update_photo(self.db,'alice',{'image':value})

    def test_gateway_requires_login_origin_and_address_ownership(self):
        with tempfile.TemporaryDirectory() as directory, patch('accounts.Auth.initialize',return_value=None):
            gateway=UserService(self.db)
            def request(path,method='GET',data=None,origin=None):
                raw=json.dumps(data or {}).encode()
                env={'PATH_INFO':path,'REQUEST_METHOD':method,'CONTENT_TYPE':'application/json','CONTENT_LENGTH':str(len(raw)),'wsgi.input':io.BytesIO(raw),'REMOTE_ADDR':'127.0.0.1'}
                env['HTTP_ORIGIN']=origin or gateway.origin
                return Request(env)
            gateway.auth.current=lambda token:None
            for path in ['/api/account/profile','/api/account/photo','/api/account/addresses']:
                with self.assertRaises(HttpError) as err:gateway.handle_public(request(path,'PUT',self.data))
                self.assertEqual(err.exception.status,401)
            gateway.auth.current=lambda token:{'id':'alice','role':'customer'}
            with self.assertRaises(HttpError) as err:gateway.handle_public(request('/api/account/profile','PUT',self.data,'https://evil.example'))
            self.assertEqual(err.exception.status,403)
            key='a'*64;self.db.customer_addresses.insert_one({'_id':key,'userId':'bob'})
            with self.assertRaises(HttpError) as err:gateway.handle_public(request('/api/account/addresses/'+key,'DELETE'))
            self.assertEqual(err.exception.status,404)
            self.assertIsNotNone(self.db.customer_addresses.find_one({'_id':key}))
            with patch('server.upstream',return_value={'address':{'recipient':'Alice','line1':'Main road','postalCode':'12345'},'city':{'id':1,'name':'City','country':'India'}}):
                result=gateway.handle_public(request('/api/account/addresses','POST',{'cityId':1,'recipient':'Alice','line1':'Main road','postalCode':'12345'}))
            self.assertEqual(len(result['addresses']),1)
            key=result['addresses'][0]['id']
            self.assertTrue(gateway.handle_public(request('/api/account/addresses/'+key,'DELETE'))['deleted'])

if __name__ == '__main__':unittest.main()
