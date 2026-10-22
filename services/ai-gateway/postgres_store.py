"""Transactional commerce ledger. Redis remains authoritative for editable carts.

Per-cart advisory gates span bounded Redis calls, but no SQL transaction or global
lock spans network I/O. Inventory row locks are ordered by SKU. Provider calls and
outbox delivery happen only after commit. The legacy Store supplies pure validation
and snapshot formatting on a private, transaction-local copy; it never writes JSON.
"""
import copy
import os
import re
import threading
import time
import uuid
from contextlib import contextmanager, nullcontext

from pg_tracing import TracingCursor
import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from runtime import business_operation, HttpError, iso
from store import Store, PENDING


class MemoryRules(Store):
    def __init__(self, state, inventory):
        self.state, self.inventory = state, inventory
        self.lock = threading.RLock()
        self.cart_revisions = {k: v.get('redisRevision') for k, v in state['sessions'].items()}
        self.cart_repository = None

    def save(self, state):
        self.state = state

    def available(self, p, payment_mode=None):
        row = self.inventory.get((p['sku'], payment_mode or os.getenv('PAYMENT_MODE', 'test')))
        return max(0, row['capacity'] - row['sold'] - row['reserved']) if row else p['instock']


class CatalogueGate:
    """Cross-process catalogue visibility gate; never a SQL transaction."""
    def __init__(self, store):
        self.store = store
        self.local = threading.local()
    def __enter__(self):
        scope = self.store.cart_lock("catalogue-visibility")
        scope.__enter__()
        stack = getattr(self.local, "stack", [])
        stack.append(scope)
        self.local.stack = stack
        return self
    def __exit__(self, *exc):
        return self.local.stack.pop().__exit__(*exc)


class PostgresStore:
    backend = 'postgres'

    def __init__(self, dsn, cart_repository):
        if not cart_repository:
            raise RuntimeError('PostgreSQL commerce requires the Redis cart service.')
        self.dsn, self.cart_repository = dsn, cart_repository
        # Compatibility scopes only; each operation owns its SQL transaction.
        self.lock = nullcontext()
        self.catalogue_lock = CatalogueGate(self)
        self.local = threading.local()
        self.closed = False
        self.check_writer()
        self.writer_lease=self.connect()
        self.writer_lease.autocommit=True
        self.writer_lease.execute("SELECT pg_advisory_lock_shared(hashtextextended('commerce-lifecycle',0))")

    def connect(self):
        if self.closed or (hasattr(self,'writer_lease') and self.writer_lease.closed):
            raise RuntimeError('Commerce writer lease is closed; restart after checking database connectivity.')
        return psycopg.connect(self.dsn, row_factory=dict_row, cursor_factory=TracingCursor, connect_timeout=3,
                               options='-c client_encoding=UTF8 -c statement_timeout=5000 -c lock_timeout=3000')

    def close(self):
        if hasattr(self,'writer_lease'):
            self.writer_lease.close()
        self.closed = True

    def check_writer(self):
        with self.connect() as c:
            if not c.execute('SELECT 1 FROM commerce_schema WHERE version=1').fetchone():
                raise RuntimeError('Apply the reviewed commerce schema before starting the gateway.')

    @contextmanager
    def cart_lock(self, id):
        # Session-level advisory lock: connection closes on crash. No DB transaction
        # is open while Redis is contacted. Reentrant only on the calling thread.
        key = 'cart:' + str(id)
        held = getattr(self.local, 'gates', {})
        if key in held:
            yield
            return
        with self.connect() as c:
            c.autocommit = True
            c.execute('SELECT pg_advisory_lock(hashtextextended(%s,0))', (key,))
            held[key] = c
            self.local.gates = held
            try:
                yield
            finally:
                del held[key]
                c.execute('SELECT pg_advisory_unlock(hashtextextended(%s,0))', (key,))

    def session_entry(self, id):
        with self.connect() as c:
            row = c.execute('SELECT data FROM commerce_sessions WHERE id=%s', (id,)).fetchone()
            return row['data'] if row else None

    def cart_version(self, id):
        entry = self.session_entry(id)
        if not entry:
            raise HttpError(404, 'Cart not found.')
        return entry.get('revision', 0)

    def session(self, id, user_id=None):
        # Stable account cart identity across replicas; no user data is migrated.
        with self.cart_lock(id), self.cart_lock('user:' + user_id if user_id else id):
            with self.connect() as c:
                if user_id:
                    row = c.execute('SELECT id,data FROM commerce_sessions WHERE user_id=%s FOR UPDATE', (user_id,)).fetchone()
                    if row:
                        entry = row['data']; entry['expires'] = time.time()*1000 + 7*86400000
                        self._save_session(c, row['id'], entry)
                        return row['id']
                old = c.execute('SELECT data FROM commerce_sessions WHERE id=%s', (id,)).fetchone()
                entry = old['data'] if old else None
                if entry and entry.get('userId') == user_id and entry['expires'] > time.time()*1000:
                    return id
                guest = (user_id and entry and not entry.get('userId') and entry['expires'] > time.time()*1000
                         and not c.execute('SELECT 1 FROM commerce_orders WHERE session_id=%s AND status=ANY(%s)',(id,list(PENDING))).fetchone())
                old_entry=copy.deepcopy(entry) if guest else None
                new_id = str(uuid.uuid4())
                entry = {'items': copy.deepcopy(old_entry['items']) if guest else {}, 'userId': user_id, 'expires': time.time()*1000+7*86400000, 'revision': 0}
                if guest:
                    if old_entry.get('shipping'): entry['shipping']=old_entry['shipping']
                    # Rotate the cart identifier at adoption. The old guest cookie
                    # must not grant access to the authenticated cart.
                    old_entry.update(items={},expires=0,transferredTo=new_id)
                    old_entry.pop('shipping',None)
                    self._save_session(c,id,old_entry)
                c.execute('INSERT INTO commerce_sessions(id,user_id,expires,data) VALUES(%s,%s,%s,%s)',
                          (new_id,user_id,entry['expires'],Jsonb(entry)))
                return new_id

    @staticmethod
    def _save_session(c, id, entry):
        c.execute('UPDATE commerce_sessions SET data=%s,revision=%s,expires=%s WHERE id=%s',
                  (Jsonb(entry),entry.get('revision',0),entry['expires'],id))

    @staticmethod
    def _recover(c):
        # Never replay provider creation. An expired creation ownership window means
        # ambiguous, not cancelled. Reservations remain held indefinitely.
        c.execute("""UPDATE commerce_orders SET status='payment_review',revision=revision+1,
            snapshot=jsonb_set(jsonb_set(snapshot,'{status}','\"payment_review\"'),'{revision}',to_jsonb(revision+1))
            WHERE status='creating' AND creation_deadline < now()""")

    def _engine(self, c, id, products=(), lock=False):
        row = c.execute('SELECT data FROM commerce_sessions WHERE id=%s' + (' FOR UPDATE' if lock else ''), (id,)).fetchone()
        if not row:
            raise HttpError(404, 'Cart not found.')
        orders = [r['snapshot'] for r in c.execute('SELECT snapshot FROM commerce_orders WHERE session_id=%s ORDER BY created_at,id', (id,))]
        inventory = {(r['sku'],r['mode']):r for r in c.execute('SELECT * FROM commerce_inventory WHERE sku=ANY(%s)', ([p['sku'] for p in products],))}
        return MemoryRules({'sessions': {id:row['data']}, 'orders':orders, 'sold':{}, 'testSold':{}},inventory)

    def pending(self, id):
        with self.connect() as c:
            self._recover(c)
            row = c.execute('SELECT snapshot FROM commerce_orders WHERE session_id=%s AND status=ANY(%s)', (id,list(PENDING))).fetchone()
            return row['snapshot'] if row else None

    def orders(self, mode=None):
        with self.connect() as c:
            return [r['snapshot'] for r in c.execute('SELECT snapshot FROM commerce_orders WHERE (%s::text IS NULL OR mode=%s) ORDER BY created_at,id', (mode,mode))]

    def find_payment(self, provider_id, mode, key_id):
        with self.connect() as c:
            row=c.execute('SELECT snapshot FROM commerce_orders WHERE provider_order_id=%s AND mode=%s AND payment_key_id=%s', (provider_id,mode,key_id)).fetchone()
            return row['snapshot'] if row else None

    def payment_order(self, id, session=None):
        with self.connect() as c:
            self._recover(c)
            row=c.execute('SELECT snapshot FROM commerce_orders WHERE id=%s AND (%s::text IS NULL OR session_id=%s)', (id,session,session)).fetchone()
            if not row:
                raise HttpError(404,'Order not found.')
            return row['snapshot']

    def existing_payment(self, id, key):
        if not isinstance(key,str) or not re.fullmatch('[a-zA-Z0-9-]{16,80}',key):
            raise HttpError(400,'A valid idempotency key is required.')
        with self.connect() as c:
            self._recover(c)
            row=c.execute('SELECT o.snapshot FROM commerce_checkout_keys k JOIN commerce_orders o ON o.id=k.order_id WHERE k.session_id=%s AND k.key=%s', (id,key)).fetchone()
            if not row:
                row=c.execute('SELECT snapshot FROM commerce_orders WHERE session_id=%s AND status=ANY(%s)',(id,list(PENDING))).fetchone()
                if row:
                    # Remember aliases too: a duplicate key used while pending must
                    # still resolve to this order after payment and a newer cart.
                    c.execute('INSERT INTO commerce_checkout_keys VALUES(%s,%s,%s) ON CONFLICT DO NOTHING',(id,key,row['snapshot']['id']))
                    row=c.execute('SELECT o.snapshot FROM commerce_checkout_keys k JOIN commerce_orders o ON o.id=k.order_id WHERE k.session_id=%s AND k.key=%s',(id,key)).fetchone()
            return row['snapshot'] if row else None

    def reserved(self, sku, payment_mode=None):
        with self.connect() as c:
            return c.execute('SELECT coalesce(sum(reserved),0) AS n FROM commerce_inventory WHERE sku=%s AND (%s::text IS NULL OR mode=%s)',(sku,payment_mode,payment_mode)).fetchone()['n']

    def sold(self, sku, mode):
        with self.connect() as c:
            row=c.execute('SELECT sold FROM commerce_inventory WHERE sku=%s AND mode=%s',(sku,mode)).fetchone()
            return row['sold'] if row else 0

    def available(self,p,payment_mode=None):
        with self.connect() as c:
            row=c.execute('SELECT capacity-sold-reserved AS n FROM commerce_inventory WHERE sku=%s AND mode=%s',(p['sku'],payment_mode or os.getenv('PAYMENT_MODE','test'))).fetchone()
            return row['n'] if row else p['instock']

    def sync_cart(self,id):
        with self.cart_lock(id):
            if self.pending(id):
                return
            # Payment clearing is idempotent in Redis. Block edits until this succeeds.
            with self.connect() as c:
                paid=[r['snapshot'] for r in c.execute("SELECT snapshot FROM commerce_orders WHERE session_id=%s AND status='paid' AND NOT coalesce((snapshot->>'cartCleared')::boolean,false)",(id,))]
            for order in paid:
                self.cart_repository.clear_paid(id,order['id'],order.get('redisRevision'),require_empty=order.get('redisRevision') is None)
                with self.connect() as c:
                    current=c.execute('SELECT snapshot FROM commerce_orders WHERE id=%s FOR UPDATE',(order['id'],)).fetchone()['snapshot']
                    entry=c.execute('SELECT data FROM commerce_sessions WHERE id=%s FOR UPDATE',(id,)).fetchone()['data']
                    current['cartCleared']=True
                    entry.update(items={},revision=entry.get('revision',0)+1)
                    entry.pop('shipping',None)
                    self._save_order(c,current)
                    self._save_session(c,id,entry)
            entry=self.session_entry(id)
            result=self.cart_repository.initialize(id,entry['items'])
            with self.connect() as c:
                rules=self._engine(c,id,lock=True)
                entry=rules.state['sessions'][id]
                if entry['items'] != result['items'] or entry.get('redisRevision') != result['revision']:
                    entry['revision']=entry.get('revision',0)+1
                    if entry['items'] != result['items']:
                        entry.pop('shipping',None)
                entry.update(items=result['items'],redisRevision=result['revision'])
                self._save_session(c,id,entry)

    def cart(self,id,products,payment_mode=None):
        with self.connect() as c:
            return self._engine(c,id,products).cart(id,products,payment_mode)

    @business_operation("cart.update")
    def update(self,id,sku,quantity,products):
        with self.cart_lock(id):
            self.sync_cart(id)
            with self.connect() as c:
                rules=self._engine(c,id,products)
                # Pure legacy validation and calculation, without Redis or file writes.
                rules.cart_lock=lambda unused: nullcontext()
                rules.update(id,sku,quantity,products)
                entry=rules.state['sessions'][id]
            result=self.cart_repository.replace(id,entry['items'],entry.get('redisRevision'))
            entry.update(redisRevision=result['revision'])
            entry.pop('shipping',None)
            with self.connect() as c:
                self._save_session(c,id,entry)
            return self.cart(id,products)

    def set_shipping(self,id,shipping,products):
        with self.cart_lock(id):
            self.sync_cart(id)
            with self.connect() as c:
                rules=self._engine(c,id,products,lock=True)
                rules.cart_lock=lambda unused:nullcontext()
                result=rules.set_shipping(id,shipping,products)
                self._save_session(c,id,rules.state['sessions'][id])
                return result

    @business_operation("checkout.reserve")
    def reserve_payment(self,id,key,products,payment_mode='test',key_id=None,expected_version=None,quote_token=None):
        if payment_mode not in ('test','live'):
            raise HttpError(409,'A known payment environment is required.')
        with self.cart_lock(id):
            previous=self.existing_payment(id,key)
            if previous:
                return previous,False
            self.sync_cart(id)
            items=self.session_entry(id)['items']
            with self.connect() as c:
                # Sorted inventory locking prevents opposite-SKU deadlocks.
                for p in sorted(products,key=lambda p:p['sku']):
                    if p['sku'] not in items:
                        continue
                    c.execute('INSERT INTO commerce_inventory(sku,mode,capacity) VALUES(%s,%s,%s) ON CONFLICT DO NOTHING',(p['sku'],payment_mode,p['instock']))
                    c.execute('SELECT sku FROM commerce_inventory WHERE sku=%s AND mode=%s FOR UPDATE',(p['sku'],payment_mode))
                rules=self._engine(c,id,products,lock=True)
                if expected_version is not None and rules.cart_version(id)!=expected_version:
                    raise HttpError(409,'Cart changed while preparing checkout. Refresh and retry.')
                order=rules._begin_payment(id,key,products,payment_mode,key_id,quote_token)
                self._insert_order(c,order)
                for item in order['items']:
                    result=c.execute('UPDATE commerce_inventory SET reserved=reserved+%s WHERE sku=%s AND mode=%s AND capacity-sold-reserved >= %s',(item['quantity'],item['sku'],payment_mode,item['quantity']))
                    if result.rowcount!=1:
                        raise HttpError(409,'Stock changed. Update your cart before checking out.')
                    c.execute("INSERT INTO commerce_reservations VALUES(%s,%s,%s,%s,'held')",(order['id'],item['sku'],payment_mode,item['quantity']))
                return order,True

    def begin_payment(self,*args,**kwargs):
        return self.reserve_payment(*args,**kwargs)[0]

    @staticmethod
    def _insert_order(c,o):
        c.execute('''INSERT INTO commerce_orders(id,session_id,status,revision,amount,currency,mode,payment_key_id,provider_order_id,payment_id,created_at,snapshot)
           VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)''',
           (o['id'],o['session'],o['status'],o.get('revision',0),o['amount'],o['currency'],o['paymentMode'],o.get('paymentKeyId'),o.get('razorpayOrderId'),o.get('paymentId'),o['createdAt'],Jsonb(o)))
        c.execute('INSERT INTO commerce_checkout_keys VALUES(%s,%s,%s)',(o['session'],o['key'],o['id']))
        for p in o['items']:
            c.execute('INSERT INTO commerce_order_items VALUES(%s,%s,%s,%s)',(o['id'],p['sku'],p['quantity'],Jsonb(p)))

    @staticmethod
    def _save_order(c,o):
        c.execute('UPDATE commerce_orders SET status=%s,revision=%s,provider_order_id=%s,payment_id=%s,snapshot=%s WHERE id=%s',
                  (o['status'],o.get('revision',0),o.get('razorpayOrderId'),o.get('paymentId'),Jsonb(o),o['id']))

    def _transition(self,id,change):
        with self.cart_lock(self.payment_order(id)['session']):
            return self._locked_transition(id,change)

    def _locked_transition(self,id,change):
        try:
            with self.connect() as c:
                row=c.execute('SELECT snapshot FROM commerce_orders WHERE id=%s FOR UPDATE',(id,)).fetchone()
                if not row:
                    raise HttpError(404,'Order not found.')
                o=row['snapshot']
                rules=MemoryRules({'sessions':{},'orders':[o],'sold':{},'testSold':{}},{})
                result=change(rules,o)
                updated=rules.state['orders'][0]
                self._save_order(c,updated)
                if o['status']!='paid' and updated['status']=='paid':
                    for p in sorted(updated['items'],key=lambda p:p['sku']):
                        changed=c.execute("UPDATE commerce_reservations SET state='consumed' WHERE order_id=%s AND sku=%s AND state='held' RETURNING quantity",(id,p['sku'])).fetchone()
                        if not changed:
                            raise RuntimeError('Missing held inventory reservation.')
                        c.execute('UPDATE commerce_inventory SET reserved=reserved-%s,sold=sold+%s WHERE sku=%s AND mode=%s',(p['quantity'],p['quantity'],p['sku'],updated['paymentMode']))
                    self._insert_outbox(c,updated)
                return copy.deepcopy(result if result is not None else updated)
        except psycopg.errors.UniqueViolation as error:
            raise HttpError(409,'Payment identity is already assigned to an order.') from error

    @staticmethod
    def _insert_outbox(c,o):
        rules=MemoryRules({'sessions':{},'orders':[copy.deepcopy(o)],'sold':{},'testSold':{}},{})
        for event in rules.pending_events():
            c.execute("INSERT INTO commerce_outbox(id,order_id,kind,payload) VALUES(%s,%s,'event',%s) ON CONFLICT DO NOTHING",(event['eventId'],o['id'],Jsonb(event)))
        if o.get('userId') and not o.get('customerSyncedAt'):
            c.execute("INSERT INTO commerce_outbox(id,order_id,kind,payload) VALUES(%s,%s,'purchase',%s) ON CONFLICT DO NOTHING",('purchase:'+o['id'],o['id'],Jsonb(o)))

    def attach_payment(self,id,provider,expected_revision=None):
        return self._transition(id,lambda rules,o:rules.attach_payment(id,provider,expected_revision))

    def review_payment(self,id,expected_revision=None):
        return self._transition(id,lambda rules,o:rules.review_payment(id,expected_revision))

    @business_operation("payment.capture")
    def mark_paid(self,id,payment,expected_revision=None):
        return self._transition(id,lambda rules,o:rules.mark_paid(id,payment,expected_revision))

    def audit_reconciliation(self,id,actor,reason,outcome):
        return self._transition(id,lambda rules,o:rules.audit_reconciliation(id,actor,reason,outcome))

    def claim_outbox(self,kind,limit=50):
        token=str(uuid.uuid4())
        with self.connect() as c:
            rows=c.execute('''WITH work AS (SELECT id FROM commerce_outbox WHERE kind=%s AND delivered_at IS NULL AND (lease_until IS NULL OR lease_until < now()) ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT %s)
                UPDATE commerce_outbox o SET lease_token=%s,lease_until=now()+interval '120 seconds',attempts=attempts+1 FROM work WHERE o.id=work.id RETURNING o.*''',(kind,limit,token)).fetchall()
            return [dict(r['payload'],_outboxId=r['id'],_leaseToken=token) for r in rows]

    def acknowledge(self,id,token):
        with self.connect() as c:
            row=c.execute('''UPDATE commerce_outbox SET delivered_at=now(),lease_until=NULL WHERE id=%s AND lease_token=%s AND delivered_at IS NULL RETURNING order_id,kind''',(id,token)).fetchone()
            if row:
                o=c.execute('SELECT snapshot FROM commerce_orders WHERE id=%s FOR UPDATE',(row['order_id'],)).fetchone()['snapshot']
                if row['kind']=='event': o['shipmentEvent']['publishedAt']=iso()
                else: o['customerSyncedAt']=iso()
                self._save_order(c,o)
            return bool(row)

    def pending_events(self):
        return self.claim_outbox('event',10)

    def event_published(self,id,token=None):
        if not token:
            raise ValueError('Outbox lease token required.')
        return self.acknowledge(id,token)

    def pending_purchases(self):
        return self.claim_outbox('purchase',5)

    def purchase_projected(self,order):
        return self.acknowledge(order['_outboxId'],order['_leaseToken'])

    def adjust_inventory(self,sku,mode,delta,key,actor,reason):
        if mode not in ('test','live') or type(delta) is not int or not key or not actor or len(reason.strip())<10:
            raise HttpError(400,'An adjustment needs mode, integer delta, unique key, actor and reason.')
        with self.connect() as c:
            c.execute('SELECT pg_advisory_xact_lock(hashtextextended(%s,0))',('adjust:'+key,))
            old=c.execute('SELECT * FROM commerce_adjustments WHERE id=%s',(key,)).fetchone()
            if old:
                if (old['sku'],old['mode'],old['delta'],old['actor'],old['reason']) != (sku,mode,delta,actor,reason):
                    raise HttpError(409,'Adjustment key already used with different parameters.')
                return False
            result=c.execute('UPDATE commerce_inventory SET capacity=capacity+%s WHERE sku=%s AND mode=%s AND capacity+%s>=sold+reserved',(delta,sku,mode,delta))
            if result.rowcount!=1:
                raise HttpError(409,'Unknown inventory or adjustment would consume reserved/sold stock.')
            c.execute('INSERT INTO commerce_adjustments(id,sku,mode,delta,actor,reason) VALUES(%s,%s,%s,%s,%s,%s)',(key,sku,mode,delta,actor,reason))
            return True
