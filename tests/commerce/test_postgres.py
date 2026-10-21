"""Opt-in integration tests. Only loopback databases ending in _test are allowed."""
import copy
import importlib.util
import json
import multiprocessing
import os
from pathlib import Path
import sys
import tempfile
import threading
import time
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from urllib.parse import urlparse

ROOT=Path(__file__).resolve().parents[2]
sys.path[:0]=[str(ROOT/'services/ai-gateway/lib'),str(ROOT/'services/ai-gateway')]
import psycopg
import redis
import mongomock
from runtime import HttpError,iso
from postgres_store import PostgresStore
from store import Store
from server import Gateway
from commerce_migrate import migrate,rollback_check,validate,TABLES
from purchase_sync import PurchaseSync

spec=importlib.util.spec_from_file_location('commerce_test_cart_service',ROOT/'services/cart-service/server.py')
cart_module=importlib.util.module_from_spec(spec);spec.loader.exec_module(cart_module)
TOKEN='test-only-cart-token-'*3
DSN=os.getenv('COMMERCE_TEST_DSN','')
REDIS_URL=os.getenv('COMMERCE_TEST_REDIS','redis://127.0.0.1:56389/15')
P={'sku':'LIMITED','name':'Merchant robot','description':'Inventory test','price':10,'currency':'INR','priceType':'sale','instock':2,'categories':['robot'],'fulfilment':'merchant','demo':False}
SHIPPING={'cost':1,'currency':'INR','quotedAt':iso(),'address':{'recipient':'Test'},'city':{'name':'Test','country':'IN'}}

class RedisRepo:
    def __init__(self):
        self.redis=redis.Redis.from_url(REDIS_URL,decode_responses=True)
        self.service=cart_module.CartService(self.redis,TOKEN)
    def call(self,id,body,suffix=''):
        return self.service.handle(SimpleNamespace(path='/internal/carts/'+id+suffix,method='POST',headers={'authorization':'Bearer '+TOKEN},body=lambda:body))
    def initialize(self,id,items): return self.call(id,{'initialize':True,'items':items})
    def replace(self,id,items,revision): return self.call(id,{'items':items,'revision':revision})
    def clear_paid(self,id,order,revision=None,require_empty=False):
        if revision is not None or require_empty:
            return self.call(id,{'orderId':order,'expectedRevision':revision if revision is not None else -1,'requireEmpty':require_empty},'/clear-checked')
        return self.call(id,{'orderId':order},'/clear')

def process_reserve(dsn,session,barrier,queue):
    store=PostgresStore(dsn,RedisRepo())
    try:
        barrier.wait(timeout=15)
        order,created=store.reserve_payment(session,'process-checkout-key',[P],'test','rzp_test_mock')
        queue.put(('ok',order['id'],created))
    except HttpError as e: queue.put(('rejected',e.status))
    finally: store.close()

def process_crash_after_reservation(dsn,session,pipe):
    store=PostgresStore(dsn,RedisRepo())
    order,_=store.reserve_payment(session,'crash-after-commit-key',[P],'test','rzp_test_mock')
    pipe.send(order['id'])
    os._exit(0)  # Deliberately skip cleanup as a killed gateway would.

@unittest.skipUnless(DSN,'Set COMMERCE_TEST_DSN for isolated PostgreSQL tests')
class CommerceTests(unittest.TestCase):
    def setUp(self):
        parsed=urlparse(DSN)
        if parsed.hostname not in ('localhost','127.0.0.1') or not parsed.path.endswith('_test'):
            raise RuntimeError('Refusing a non-isolated test database')
        if urlparse(REDIS_URL).hostname not in ('localhost','127.0.0.1') or not REDIS_URL.endswith('/15'):
            raise RuntimeError('Use isolated loopback Redis database 15')
        with psycopg.connect(DSN) as c:
            c.execute((ROOT/'services/ai-gateway/sql/001-commerce.sql').read_text())
            c.execute('TRUNCATE '+','.join(TABLES+['commerce_imports'])+' CASCADE')
        self.repo=RedisRepo(); self.repo.redis.flushdb()
        self.stores=[]
        self.store=self.new_store()
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.addCleanup(lambda:[s.close() for s in self.stores])

    def new_store(self):
        s=PostgresStore(DSN,RedisRepo());self.stores.append(s);return s

    def cart(self,user,product=P):
        id=self.store.session(None,user)
        self.store.sync_cart(id);self.store.update(id,product['sku'],1,[product]);self.store.set_shipping(id,SHIPPING,[product])
        return id

    def reserve(self,id,product=P,key='checkout-key-123456'):
        return self.store.reserve_payment(id,key,[product],'test','rzp_test_mock')[0]

    def paid(self,id,product=P):
        o=self.reserve(id,product)
        o=self.store.attach_payment(o['id'],{'orderId':'provider-'+o['id'],'amount':o['amount'],'currency':o['currency'],'mode':'test','keyId':'rzp_test_mock'},o['revision'])
        payment={'verified':True,'orderId':o['razorpayOrderId'],'paymentId':'payment-'+o['id'],'amount':o['amount'],'currency':o['currency'],'mode':'test','keyId':'rzp_test_mock'}
        return self.store.mark_paid(o['id'],payment,o['revision']),payment

    def test_multiple_processes_cannot_oversell_limited_stock(self):
        ids=[self.cart('u'+str(i)) for i in range(4)]
        ctx=multiprocessing.get_context('spawn');barrier=ctx.Barrier(4);queue=ctx.Queue()
        processes=[ctx.Process(target=process_reserve,args=(DSN,id,barrier,queue)) for id in ids]
        for p in processes:p.start()
        results=[queue.get(timeout=25) for _ in processes]
        for p in processes:p.join(10);self.assertEqual(p.exitcode,0)
        self.assertEqual(sum(r[0]=='ok' for r in results),2)
        self.assertEqual(sum(r==('rejected',409) for r in results),2)
        self.assertEqual(self.store.available(P),0)
        with psycopg.connect(DSN) as c:
            self.assertEqual(c.execute('SELECT reserved FROM commerce_inventory').fetchone()[0],2)

    def test_duplicates_and_cart_mutations_are_fenced_across_replicas(self):
        id=self.cart('alice');other=self.new_store();barrier=threading.Barrier(2);results=[]
        def reserve(s,key):
            barrier.wait();results.append(s.reserve_payment(id,key,[P],'test','rzp_test_mock'))
        threads=[threading.Thread(target=reserve,args=(s,k)) for s,k in [(self.store,'idempotency-key-first'),(other,'idempotency-key-second')]]
        for t in threads:t.start()
        for t in threads:t.join(10);self.assertFalse(t.is_alive())
        self.assertEqual(len(results),2);self.assertEqual(sum(created for _,created in results),1)
        self.assertEqual(results[0][0]['id'],results[1][0]['id'])
        with self.assertRaises(HttpError):other.update(id,P['sku'],0,[P])
        with self.assertRaises(HttpError):other.set_shipping(id,SHIPPING,[P])
        self.assertEqual(self.store.reserved(P['sku']),1)

    def test_atomic_capture_replay_and_retry_safe_outbox_projection(self):
        id=self.cart('alice');o,payment=self.paid(id)
        other=self.new_store()
        self.assertEqual(other.mark_paid(o['id'],payment,0)['id'],o['id'])
        with self.assertRaises(HttpError):other.mark_paid(o['id'],dict(payment,amount=99999))
        with psycopg.connect(DSN) as c:
            self.assertEqual(c.execute('SELECT sold,reserved FROM commerce_inventory').fetchone(),(1,0))
            self.assertEqual(c.execute('SELECT count(*) FROM commerce_outbox').fetchone()[0],2)
        batch=self.store.pending_events();self.assertEqual(len(batch),1)
        self.assertEqual(other.pending_events(),[])
        # A worker crashes after publish but before ack; lease expiry permits retry.
        with psycopg.connect(DSN) as c:c.execute("UPDATE commerce_outbox SET lease_until=now()-interval '1 second' WHERE kind='event'")
        retry=other.pending_events()[0];self.assertEqual(retry['eventId'],batch[0]['eventId'])
        self.assertFalse(self.store.event_published(batch[0]['eventId'],batch[0]['_leaseToken']))
        self.assertTrue(other.event_published(retry['eventId'],retry['_leaseToken']))
        self.assertEqual(self.store.pending_events(),[])
        projected={}
        client=SimpleNamespace(project=lambda order:projected.setdefault(order['id'],order) is not None)
        PurchaseSync(client,self.store).sync();PurchaseSync(client,other).sync()
        self.assertEqual(list(projected),[o['id']]);self.assertEqual(other.pending_purchases(),[])

    def test_capture_rollback_leaves_reservation_and_no_outbox(self):
        id=self.cart('alice');o=self.reserve(id)
        o=self.store.attach_payment(o['id'],{'orderId':'provider-one','amount':o['amount'],'currency':'INR','keyId':'rzp_test_mock'},o['revision'])
        payment={'verified':True,'orderId':'provider-one','paymentId':'paid-one','amount':o['amount'],'currency':'INR'}
        with patch.object(self.store,'_insert_outbox',side_effect=RuntimeError('crash before commit')):
            with self.assertRaises(RuntimeError):self.store.mark_paid(o['id'],payment,o['revision'])
        self.assertEqual(self.store.payment_order(o['id'])['status'],'payment_pending')
        self.assertEqual(self.store.reserved(P['sku']),1)
        with psycopg.connect(DSN) as c:self.assertEqual(c.execute('SELECT count(*) FROM commerce_outbox').fetchone()[0],0)
        self.assertEqual(self.store.mark_paid(o['id'],payment,o['revision'])['status'],'paid')

    def test_redis_success_before_sql_failure_recovers_and_revision_rejects_stale_checkout(self):
        id=self.cart('alice');version=self.store.cart_version(id)
        original=self.store._save_session
        # Redis mutation succeeds, but the SQL cart cache is not committed.
        def interrupted(c,id,entry):
            if entry['items'].get(P['sku']) == 2: raise RuntimeError('crash after Redis')
            return original(c,id,entry)
        with patch.object(self.store,'_save_session',side_effect=interrupted):
            with self.assertRaises(RuntimeError):self.store.update(id,P['sku'],2,[P])
        self.store.sync_cart(id)
        self.assertEqual(self.store.cart(id,[P])['items'][0]['quantity'],2)
        with self.assertRaises(HttpError):self.store.reserve_payment(id,'stale-revision-key',[P],'test','rzp_test_mock',version)
        self.assertEqual(self.store.orders(),[])

    def test_paid_clear_retry_does_not_resurrect_expired_cart(self):
        id=self.cart('alice');o,_=self.paid(id)
        self.repo.redis.delete('roboshop:cart:'+id)
        self.store.sync_cart(id)
        self.assertEqual(self.store.cart(id,[P])['items'],[])
        self.store.update(id,P['sku'],1,[P])
        self.store.sync_cart(id)
        self.assertEqual(self.store.cart(id,[P])['items'][0]['quantity'],1)
        self.assertTrue(self.store.payment_order(o['id'])['cartCleared'])

    def test_slow_provider_does_not_block_unrelated_cart_and_timeout_is_ambiguous(self):
        first=self.cart('alice');second=self.cart('bob')
        with patch.dict(os.environ,{'USER_SERVICE_TOKEN':'u'*64}):gateway=Gateway(mongomock.MongoClient().db,self.store)
        gateway.catalogue=lambda:[P]
        started=threading.Event();release=threading.Event();calls=[];failures=[]
        def payment(path,data=None):
            calls.append(path)
            if path=='config':return {'enabled':True,'mode':'test','keyId':'rzp_test_mock'}
            if path=='orders':started.set();release.wait(10);raise TimeoutError('ambiguous provider timeout')
            if path=='recover':return {'found':False}
            raise AssertionError(path)
        gateway.payment=payment
        def checkout():
            try:gateway.checkout(first,'slow-provider-checkout')
            except TimeoutError:failures.append(True)
        thread=threading.Thread(target=checkout);thread.start();self.assertTrue(started.wait(5))
        start=time.monotonic();self.new_store().update(second,P['sku'],0,[P]);self.assertLess(time.monotonic()-start,2)
        release.set();thread.join(10);self.assertEqual(failures,[True])
        order=self.store.pending(first);self.assertEqual(order['status'],'payment_review')
        with self.assertRaises(HttpError):gateway.checkout(first,'slow-provider-checkout')
        self.assertEqual(calls.count('orders'),1);self.assertEqual(self.store.reserved(P['sku']),1)
        # A late provider response can attach; it never creates another order.
        attached=self.store.attach_payment(order['id'],{'orderId':'late','amount':order['amount'],'currency':'INR','keyId':'rzp_test_mock'},order['revision'])
        self.assertEqual(attached['status'],'payment_pending')

    def test_adjustments_are_audited_idempotent_and_cannot_steal_reservations(self):
        id=self.cart('alice');self.reserve(id)
        self.assertTrue(self.store.adjust_inventory(P['sku'],'test',2,'adjust-1','operator','Reviewed delivery of two units'))
        self.assertFalse(self.store.adjust_inventory(P['sku'],'test',2,'adjust-1','operator','Reviewed delivery of two units'))
        with self.assertRaises(HttpError):self.store.adjust_inventory(P['sku'],'test',3,'adjust-1','operator','Reviewed delivery of two units')
        with self.assertRaises(HttpError):self.store.adjust_inventory(P['sku'],'test',-4,'adjust-2','operator','Cannot consume reserved stock')
        self.assertEqual(self.store.available(P),3)

    def fixture(self):
        directory=Path(self.temp.name)/'legacy';legacy=Store(directory)
        id=legacy.session(None,'original-user');legacy.update(id,P['sku'],1,[P]);legacy.set_shipping(id,SHIPPING,[P])
        o=legacy.begin_payment(id,'original-key-12345',[P],'test')
        o=legacy.attach_payment(o['id'],{'orderId':'legacy-provider','amount':o['amount'],'currency':'INR'})
        legacy.mark_paid(o['id'],{'verified':True,'orderId':'legacy-provider','paymentId':'legacy-payment','amount':o['amount'],'currency':'INR'})
        raw=legacy.file.read_bytes();legacy.close()
        baseline=Path(self.temp.name)/'inventory.json';baseline.write_text(json.dumps([{'sku':P['sku'],'mode':'test','capacity':2}]))
        return directory/'store.json',baseline,raw

    def test_restartable_import_preserves_snapshots_backup_and_rollback_guard(self):
        for s in self.stores:s.close()
        source,baseline,raw=self.fixture();backup=Path(self.temp.name)/'backup'
        dry=migrate(source,baseline,backup,DSN);self.assertFalse(dry['applied']);self.assertFalse(dry['errors'])
        report=migrate(source,baseline,backup,DSN,True);self.assertTrue(report['applied'])
        self.assertEqual((backup/(report['checksum']+'.ledger.json')).read_bytes(),raw)
        self.assertEqual(source.read_bytes(),raw)
        self.assertTrue(migrate(source,baseline,backup,DSN,True)['alreadyImported'])
        self.assertTrue(rollback_check(DSN,report['checksum'])['rollbackSafe'])
        restored=self.new_store();old=json.loads(raw)['orders'][0];self.assertEqual(restored.payment_order(old['id']),old)
        self.assertEqual(restored.reserved(P['sku']),0);self.assertEqual(restored.sold(P['sku'],'test'),1)
        restored.pending_events();restored.close()
        with self.assertRaises(RuntimeError):rollback_check(DSN,report['checksum'])

    def test_import_crash_is_atomic_and_invalid_money_never_imports(self):
        for s in self.stores:s.close()
        source,baseline,raw=self.fixture();backup=Path(self.temp.name)/'backup'
        with patch.object(PostgresStore,'_insert_outbox',side_effect=RuntimeError('import crash')):
            with self.assertRaises(RuntimeError):migrate(source,baseline,backup,DSN,True)
        with psycopg.connect(DSN) as c:self.assertEqual(c.execute('SELECT count(*) FROM commerce_orders').fetchone()[0],0)
        data=json.loads(raw);data['orders'][0]['amount']+=1;source.write_text(json.dumps(data))
        bad=migrate(source,baseline,backup,DSN,True);self.assertTrue(bad['errors']);self.assertFalse(bad['applied'])
        source.write_bytes(raw);self.assertTrue(migrate(source,baseline,backup,DSN,True)['applied'])

    def test_abandoned_creation_recovers_without_releasing_stock(self):
        id=self.cart('alice');o=self.reserve(id)
        # Reopening a replica must not demote another live request's creation.
        other=self.new_store();self.assertEqual(other.pending(id)['status'],'creating')
        with psycopg.connect(DSN) as c:
            c.execute("UPDATE commerce_orders SET creation_deadline=now()-interval '1 second' WHERE id=%s",(o['id'],))
        recovered=other.pending(id)
        self.assertEqual(recovered['status'],'payment_review');self.assertEqual(recovered['revision'],o['revision']+1)
        self.assertEqual(other.reserved(P['sku']),1)
        self.assertFalse(other.reserve_payment(id,'new-idempotency-key',[P],'test','rzp_test_mock')[1])
        self.assertEqual(other.payment_order(o['id'])['createdAt'],o['createdAt'])

    def test_database_constraints_and_immutable_snapshot(self):
        first=self.cart('alice');second=self.cart('bob');o,payment=self.paid(first)
        other=self.reserve(second)
        other=self.store.attach_payment(other['id'],{'orderId':'different-provider','amount':other['amount'],'currency':'INR','keyId':'rzp_test_mock'})
        with self.assertRaises(HttpError):
            self.store.mark_paid(other['id'],dict(payment,orderId='different-provider'))
        self.assertEqual(self.store.payment_order(other['id'])['status'],'payment_pending')
        for sql,args in [
            ('UPDATE commerce_inventory SET reserved=100',()),
            ('UPDATE commerce_orders SET amount=amount+1 WHERE id=%s',(o['id'],)),
            ("UPDATE commerce_orders SET snapshot=jsonb_set(snapshot,'{currency}','\"USD\"') WHERE id=%s",(o['id'],)),
        ]:
            with self.subTest(sql=sql),self.assertRaises(psycopg.Error):
                with psycopg.connect(DSN) as c:c.execute(sql,args)

    def test_purchase_projection_crash_after_user_write_retries_same_order(self):
        sys.path.append(str(ROOT/'services/user-service'))
        from customers import Customers
        db=mongomock.MongoClient(tz_aware=True).db
        projector=Customers(db)
        # Address storage is independently tested; use the real immutable history upsert.
        projector.save_address=lambda *args:None
        id=self.cart('alice');order,_=self.paid(id)
        worker=PurchaseSync(projector,self.store)
        with patch.object(self.store,'purchase_projected',side_effect=RuntimeError('crash after Mongo commit')):
            with self.assertRaises(RuntimeError):worker.sync()
        self.assertEqual(db.purchase_history.count_documents({}),1)
        with psycopg.connect(DSN) as c:c.execute("UPDATE commerce_outbox SET lease_until=now()-interval '1 second' WHERE kind='purchase'")
        PurchaseSync(projector,self.new_store()).sync()
        self.assertEqual(db.purchase_history.count_documents({}),1)
        self.assertEqual(db.purchase_history.find_one()['_id'],order['id'])
        self.assertEqual(self.store.pending_purchases(),[])

    def test_migration_pending_recovery_and_mode_currency_preservation(self):
        for s in self.stores:s.close()
        source,baseline,raw=self.fixture()
        # Add an uncompleted live USD checkout using the legacy API, never a provider.
        legacy=Store(source.parent)
        product=dict(P,currency='USD',price=12.34)
        id=legacy.session(None,'live-user');legacy.update(id,P['sku'],1,[product])
        legacy.set_shipping(id,dict(SHIPPING,currency='USD'),[product])
        o=legacy.begin_payment(id,'live-pending-key-123',[product],'live')
        original=copy.deepcopy(o);legacy.close()
        baseline.write_text(json.dumps([{'sku':P['sku'],'mode':mode,'capacity':2} for mode in ('test','live')]))
        report=migrate(source,baseline,Path(self.temp.name)/'backup',DSN,True)
        self.assertEqual(report['creatingToReview'],[o['id']])
        pg=self.new_store();imported=pg.payment_order(o['id'])
        for field in ('id','items','amount','currency','paymentMode','createdAt','key','cartRevision','redisRevision'):
            self.assertEqual(imported.get(field),original.get(field),field)
        self.assertEqual(imported['status'],'payment_review');self.assertEqual(pg.reserved(P['sku'],'live'),1)
        self.assertEqual(pg.sold(P['sku'],'test'),1)

    def test_process_crash_after_reservation_is_recoverable(self):
        id=self.cart('alice');ctx=multiprocessing.get_context('spawn');parent,child=ctx.Pipe()
        worker=ctx.Process(target=process_crash_after_reservation,args=(DSN,id,child));worker.start()
        self.assertTrue(parent.poll(15));order_id=parent.recv();worker.join(10);self.assertEqual(worker.exitcode,0)
        with psycopg.connect(DSN) as c:c.execute("UPDATE commerce_orders SET creation_deadline=now()-interval '1 second' WHERE id=%s",(order_id,))
        self.assertEqual(self.store.pending(id)['status'],'payment_review')
        self.assertEqual(self.store.reserved(P['sku']),1)
        order,created=self.store.reserve_payment(id,'crash-after-commit-key',[P],'test','rzp_test_mock')
        self.assertFalse(created);self.assertEqual(order['id'],order_id)

    def test_duplicate_alias_remains_bound_after_capture_and_new_cart(self):
        id=self.cart('alice');original=self.reserve(id)
        self.assertEqual(self.store.existing_payment(id,'another-retry-key-123')['id'],original['id'])
        paid,_=self.paid(id)
        self.store.sync_cart(id);self.store.update(id,P['sku'],1,[P]);self.store.set_shipping(id,SHIPPING,[P])
        o,created=self.new_store().reserve_payment(id,'another-retry-key-123',[P],'test','rzp_test_mock')
        self.assertFalse(created);self.assertEqual(o['id'],paid['id']);self.assertEqual(self.store.reserved(P['sku']),0)

    def test_webhook_replay_preserves_one_capture_and_event(self):
        id=self.cart('alice');o=self.reserve(id)
        self.store.review_payment(o['id'],o['revision'])
        with patch.dict(os.environ,{'USER_SERVICE_TOKEN':'u'*64}):gateway=Gateway(mongomock.MongoClient().db,self.new_store())
        def payment(path,data=None):
            if path=='webhook-check':return {'orderId':'webhook-provider','mode':'test','keyId':'rzp_test_mock'}
            if path=='lookup':return {'orderId':'webhook-provider','receipt':o['id'],'amount':o['amount'],'currency':'INR','mode':'test','keyId':'rzp_test_mock'}
            if path=='reconcile':return {'verified':True,'orderId':'webhook-provider','paymentId':'webhook-payment','amount':o['amount'],'currency':'INR','mode':'test','keyId':'rzp_test_mock'}
            raise AssertionError(path)
        gateway.payment=payment
        request=SimpleNamespace(path='/api/payments/webhook',method='POST',headers={'x-razorpay-signature':'mock-verified'},raw=lambda limit:b'{}')
        self.assertEqual(gateway.handle(request),{'received':True})
        self.assertEqual(gateway.handle(request),{'received':True})
        self.assertEqual(self.store.payment_order(o['id'])['status'],'paid')
        with psycopg.connect(DSN) as c:
            self.assertEqual(c.execute('SELECT count(*) FROM commerce_outbox').fetchone()[0],2)
            self.assertEqual(c.execute('SELECT sold,reserved FROM commerce_inventory').fetchone(),(1,0))

    def test_guest_adoption_rotates_identifier_and_preserves_cart(self):
        guest=self.store.session(None,None);self.store.sync_cart(guest)
        self.store.update(guest,P['sku'],1,[P])
        account=self.store.session(guest,'new-account');self.store.sync_cart(account)
        self.assertNotEqual(guest,account)
        self.assertEqual(self.store.cart(account,[P])['items'][0]['quantity'],1)
        self.assertEqual(self.store.session_entry(account)['userId'],'new-account')
        fresh=self.new_store().session(guest,None);self.assertNotEqual(fresh,account)
        self.assertEqual(self.store.cart(fresh,[P])['items'],[])
        self.assertEqual(self.new_store().session(None,'new-account'),account)

    def test_rabbitmq_publisher_confirm_retry_uses_original_event_id(self):
        from events import OrderPublisher
        id=self.cart('alice');self.paid(id);payloads=[]
        def run(fail):
            publisher=OrderPublisher(self.store,'amqp://guest:guest@localhost/')
            class Channel:
                def exchange_declare(self,**kwargs):pass
                def queue_declare(self,**kwargs):pass
                def queue_bind(self,**kwargs):pass
                def confirm_delivery(self):pass
                def basic_publish(self,**kwargs):
                    payloads.append(json.loads(kwargs['body']))
                    publisher.stopped.set()
                    if fail:raise RuntimeError('lost publisher confirmation')
            class Connection:
                is_open=True
                def channel(self):return Channel()
                def close(self):self.is_open=False
            with patch('events.pika.BlockingConnection',return_value=Connection()):publisher.run()
        run(True)
        self.assertFalse(any(k.startswith('_') for k in payloads[0]))
        with psycopg.connect(DSN) as c:c.execute("UPDATE commerce_outbox SET lease_until=now()-interval '1 second' WHERE kind='event'")
        run(False)
        self.assertEqual(payloads[0]['eventId'],payloads[1]['eventId'])
        self.assertEqual(self.store.pending_events(),[])

    def test_import_preserves_completed_delivery_markers(self):
        for s in self.stores:s.close()
        source,baseline,raw=self.fixture();legacy=Store(source.parent)
        order=legacy.state['orders'][0]
        legacy.event_published(order['shipmentEvent']['eventId'])
        legacy.purchase_projected(legacy.state['orders'][0])
        expected=copy.deepcopy(legacy.state['orders'][0]);legacy.close()
        report=migrate(source,baseline,Path(self.temp.name)/'backup',DSN,True)
        self.assertTrue(report['applied'])
        pg=self.new_store();self.assertEqual(pg.payment_order(expected['id']),expected)
        self.assertEqual(pg.pending_events(),[]);self.assertEqual(pg.pending_purchases(),[])

    def test_paid_clear_never_erases_a_newer_redis_revision(self):
        id=self.cart('alice');order,_=self.paid(id)
        current=self.repo.initialize(id,{})
        self.repo.replace(id,{P['sku']:2},current['revision'])
        with self.assertRaises(HttpError):self.store.sync_cart(id)
        self.assertEqual(self.repo.initialize(id,{})['items'],{P['sku']:2})
        self.assertFalse(self.store.payment_order(order['id']).get('cartCleared',False))



    def test_converted_quote_is_atomic_durable_and_rejects_stale_cart(self):
        import currency_quote as fx
        from datetime import datetime, timezone
        id=self.cart('fx-customer')
        with patch.dict(os.environ,PAYMENT_SERVICE_TOKEN='fx-test-only-token'), patch.object(fx,'request',return_value={'asOf':datetime.now(timezone.utc).date().isoformat(),'stale':False,'rates':{'INR':100,'USD':1.2}}):
            quote=fx.issue(id,self.store.cart(id,[P]),self.store.cart_version(id),'USD')
            self.store.update(id,P['sku'],2,[P])
            self.store.set_shipping(id,SHIPPING,[P])
            with self.assertRaises(HttpError):self.store.reserve_payment(id,'stale-currency-quote',[P],'test','rzp_test_mock',quote_token=quote['quoteToken'])
            self.assertEqual(self.store.reserved(P['sku']),0)
            quote=fx.issue(id,self.store.cart(id,[P]),self.store.cart_version(id),'USD')
            order,_=self.store.reserve_payment(id,'fresh-currency-quote',[P],'test','rzp_test_mock',quote_token=quote['quoteToken'])
            other=self.new_store()
            persisted=other.payment_order(order['id'])
            self.assertEqual((persisted['currency'],persisted['amount']),('USD',25))
            self.assertEqual(persisted['sourceCart']['currency'],'INR')
            self.assertEqual(persisted['currencyQuote'],order['currencyQuote'])
            duplicate,created=other.reserve_payment(id,'fresh-currency-quote',[P],'test','rzp_test_mock',quote_token='ignored-on-resume')
            self.assertFalse(created)
            self.assertEqual(duplicate['id'],order['id'])

if __name__=='__main__':unittest.main()
