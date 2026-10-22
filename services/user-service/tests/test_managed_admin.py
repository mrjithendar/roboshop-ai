import sys,unittest
from pathlib import Path
import mongomock
SERVICE=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(SERVICE),str(SERVICE/'lib')]
from accounts import Auth,verify
from runtime import HttpError

class ManagedAdminTests(unittest.TestCase):
    def setUp(self):
        self.db=mongomock.MongoClient().db
        self.auth=Auth(self.db)
        self.auth.initialize()
        self.email='team@jithendar.com'
        self.password='Strong-test-password-12345'
    def test_create_and_repeat_preserves_hash_and_session(self):
        user=self.auth.ensure_superadmin(self.email,self.password)
        before=self.db.users.find_one({'_id':user['id']})
        self.db.auth_sessions.insert_one({'userId':user['id']})
        self.auth.ensure_superadmin(self.email,self.password)
        self.assertEqual(before,self.db.users.find_one({'_id':user['id']}))
        self.assertEqual(self.db.auth_sessions.count_documents({}),1)
    def test_password_change_invalidates_sessions(self):
        user=self.auth.ensure_superadmin(self.email,self.password)
        self.db.auth_sessions.insert_one({'userId':user['id']})
        self.auth.ensure_superadmin(self.email,self.password+'new')
        self.assertTrue(verify(self.password+'new',self.db.users.find_one({})['passwordHash']))
        self.assertEqual(self.db.auth_sessions.count_documents({}),0)
    def test_other_admin_blocks(self):
        self.auth.bootstrap('other@example.com',self.password)
        with self.assertRaises(HttpError): self.auth.ensure_superadmin(self.email,self.password)
        self.assertEqual(self.db.users.count_documents({}),1)
    def test_existing_customer_promoted(self):
        self.db.users.insert_one({'_id':'existing','email':self.email,'name':'Team','version':1,'role':'customer','disabled':False,'passwordHash':'invalid'})
        user=self.auth.ensure_superadmin(self.email,self.password)
        self.assertEqual(user['id'],'existing')
        self.assertEqual(user['role'],'superadmin')

if __name__=='__main__': unittest.main()
