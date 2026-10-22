"""Offline, explicit, all-or-nothing JSON -> PostgreSQL commerce import.

No user database, Redis or payment provider is contacted. Dry-run is the default.
Source bytes are backed up before validation; the JSON writer must be stopped.
"""
import argparse
import copy
from collections import Counter
from contextlib import contextmanager
from datetime import datetime
from decimal import Decimal
import fcntl
import hashlib
import json
import os
import re
import math
import uuid
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parent/'lib'))
import psycopg
from psycopg.types.json import Jsonb
from postgres_store import PostgresStore
from store import PENDING

TABLES=['commerce_sessions','commerce_inventory','commerce_orders','commerce_order_items','commerce_reservations','commerce_checkout_keys','commerce_adjustments','commerce_outbox']

def load_json(raw):
    def pairs(items):
        result={}
        for key,value in items:
            if key in result: raise ValueError('Duplicate JSON object key: '+key)
            result[key]=value
        return result
    return json.loads(raw,object_pairs_hook=pairs,parse_constant=lambda value: (_ for _ in ()).throw(ValueError('Non-finite JSON number')))

def minor(value):
    amount=Decimal(str(value))*100
    if not amount.is_finite() or amount != amount.to_integral_value() or amount<0:
        raise ValueError('Invalid two-decimal monetary value')
    return int(amount)

def timestamp(value):
    parsed=datetime.fromisoformat(value.replace('Z','+00:00'))
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise ValueError('Timestamp without timezone requires explicit reconciliation')
    return parsed


def validate(state,inventory):
    data=copy.deepcopy(state)
    report={'errors':[], 'warnings':[], 'orders':0, 'sessions':0, 'totalsByModeCurrency':{}, 'creatingToReview':[], 'missingOriginalCredentials':[], 'unprojectablePaidOrders':[], 'unversionedCartClears':[]}
    try:
        if not isinstance(data['sessions'],dict) or not isinstance(data['orders'],list): raise ValueError('Invalid ledger shape')
        if not isinstance(data['sold'],dict): raise ValueError('Missing sold counters')
        for id,s in data['sessions'].items():
            uuid.UUID(id)
            if not isinstance(s['items'],dict) or type(s['expires']) not in (int,float) or not math.isfinite(s['expires']): raise ValueError('Invalid session')
            if any(type(q) is not int or not 1<=q<=20 for q in s['items'].values()): raise ValueError('Invalid cart quantity')
        user_ids=[s['userId'] for s in data['sessions'].values() if s.get('userId')]
        if len(user_ids)!=len(set(user_ids)): raise ValueError('Multiple account carts require manual reconciliation')
        ids=set(); keys=set(); pending=set(); payments=set(); providers=set(); events=set(); paid=Counter(); held=Counter(); totals=Counter()
        for o in data['orders']:
            uuid.UUID(o['id'])
            if o['id'] in ids or (o['session'],o['key']) in keys: raise ValueError('Duplicate order or idempotency key')
            ids.add(o['id']); keys.add((o['session'],o['key']))
            if o['session'] not in data['sessions']: raise ValueError('Order references a missing session: '+o['id'])
            if o.get('paymentMode') not in ('test','live'): raise ValueError('Unknown payment mode: '+o['id'])
            if o['currency'] not in ('USD','EUR','INR'): raise ValueError('Currency requires explicit minor-unit review: '+o['id'])
            if o['status'] not in (*PENDING,'paid'): raise ValueError('Unsupported order state: '+o['id'])
            timestamp(o['createdAt'])
            amount=minor(o['total'])
            if 'amount' in o and (type(o['amount']) is not int or o['amount']!=amount): raise ValueError('Amount mismatch: '+o['id'])
            if 'amount' not in o: report['warnings'].append('Derived missing minor-unit amount for '+o['id'])
            o['amount']=amount; o.setdefault('revision',0)
            if type(o['revision']) is not int or o['revision']<0: raise ValueError('Invalid order revision')
            subtotal=0; skus=set()
            for p in o['items']:
                if p['sku'] in skus or type(p['quantity']) is not int or p['quantity']<=0: raise ValueError('Duplicate SKU or invalid order quantity')
                skus.add(p['sku'])
                if p.get('currency',o['currency'])!=o['currency']: raise ValueError('Mixed-currency order')
                if minor(p['lineTotal'])!=minor(p['price'])*p['quantity']: raise ValueError('Order line amount mismatch')
                subtotal+=minor(p['lineTotal'])
                (paid if o['status']=='paid' else held)[(p['sku'],o['paymentMode'])]+=p['quantity']
            if not skus or subtotal!=minor(o['subtotal']) or subtotal+minor((o.get('shipping') or {}).get('cost',0))!=amount: raise ValueError('Order total mismatch')
            if o['status'] in PENDING:
                if o['session'] in pending: raise ValueError('Multiple payable orders for one cart')
                pending.add(o['session'])
            if o['status']=='paid' and (o.get('paymentCaptured') is not True or not o.get('paymentId') or not o.get('razorpayOrderId') or not o.get('paidAt')): raise ValueError('Incomplete captured payment evidence')
            for field,seen in [('paymentId',payments),('razorpayOrderId',providers)]:
                if o.get(field):
                    identity=o[field] if field=='paymentId' else (o['paymentMode'],o.get('paymentKeyId'),o[field])
                    if identity in seen: raise ValueError('Replayed provider identity')
                    seen.add(identity)
            if not o.get('paymentKeyId'): report['missingOriginalCredentials'].append(o['id'])
            if o['status']=='creating':
                o['status']='payment_review';o['revision']+=1;report['creatingToReview'].append(o['id'])
            if o.get('paidAt'): timestamp(o['paidAt'])
            if o['status']=='paid' and not o.get('userId'): report['unprojectablePaidOrders'].append(o['id'])
            if o['status']=='paid' and not o.get('cartCleared') and o.get('redisRevision') is None: report['unversionedCartClears'].append(o['id'])
            if o['status']=='paid' and not o.get('shipmentEvent'):
                raise ValueError('Paid order missing durable event identity; review required: '+o['id'])
            if o.get('shipmentEvent'):
                event=o['shipmentEvent']
                if not event.get('eventId') or not event.get('occurredAt'): raise ValueError('Incomplete event identity')
                if event['eventId'] in events: raise ValueError('Duplicate event identity')
                events.add(event['eventId'])
                uuid.UUID(event['eventId'])
                timestamp(event['occurredAt'])
            totals[o['paymentMode']+':'+o['currency']]+=amount
        # Older ledgers combined test and live sold counters. Split only by explicit
        # paid-order modes, preserving the sum and reporting the transformation.
        if 'testSold' not in data:
            data['testSold']={sku:n for (sku,mode),n in paid.items() if mode=='test'}
            for sku,n in data['testSold'].items(): data['sold'][sku]=data['sold'].get(sku,0)-n
            report['warnings'].append('Split legacy combined sold counters using recorded paid test orders')
        capacities={}
        for row in inventory:
            key=(row['sku'],row['mode'])
            if key in capacities or row['mode'] not in ('test','live') or type(row['capacity']) is not int or row['capacity']<0: raise ValueError('Invalid inventory baseline')
            capacities[key]=row['capacity']
        sold={}
        for mode,bucket in [('test','testSold'),('live','sold')]:
            for sku,n in data[bucket].items():
                if type(n) is not int or n<0 or n<paid[(sku,mode)]: raise ValueError('Sold counters contradict paid orders')
                sold[(sku,mode)]=n
        for key,n in paid.items():
            if sold.get(key,0)<n: raise ValueError('Missing sold counter for paid order')
        for key in set(held)|set(sold):
            if key not in capacities or capacities[key]<held[key]+sold.get(key,0): raise ValueError('Inventory baseline absent or overcommitted: '+str(key))
        for session, aliases in data.get('checkoutKeys', {}).items():
            for key, order_id in aliases.items():
                match = next((o for o in data['orders'] if o['id'] == order_id and o['session'] == session), None)
                if not match or not re.fullmatch(r'[a-zA-Z0-9-]{16,80}', key):
                    raise ValueError('Invalid checkout alias')
                if any(o['session'] == session and o['key'] == key and o['id'] != order_id for o in data['orders']):
                    raise ValueError('Conflicting checkout alias')
        report.update(orders=len(data['orders']),sessions=len(data['sessions']),totalsByModeCurrency=dict(totals),heldUnits=sum(held.values()),soldUnits=sum(sold.values()),unattributedSoldUnits=sum(sold.values())-sum(paid.values()),statusCounts=dict(Counter(o['status'] for o in data['orders'])))
        return data,capacities,sold,held,report
    except (KeyError,TypeError,ValueError,ArithmeticError) as error:
        report['errors'].append(str(error))
        return None,None,None,None,report


def fingerprint(c):
    # Includes cart changes and outbox leases: rollback is allowed only before any
    # PostgreSQL work has occurred, not merely before the next successful payment.
    records={table:c.execute('SELECT coalesce(jsonb_agg(to_jsonb(t)),\'[]\'::jsonb) FROM '+table+' t').fetchone()[0] for table in TABLES}
    normalized={k:sorted(v,key=lambda row:json.dumps(row,sort_keys=True)) for k,v in records.items()}
    return hashlib.sha256(json.dumps(normalized,sort_keys=True,separators=(',',':')).encode()).hexdigest()


@contextmanager
def offline_source(source):
    with open(source.parent/'writer.lock','a+') as lock:
        try: fcntl.flock(lock.fileno(),fcntl.LOCK_EX|fcntl.LOCK_NB)
        except OSError as error: raise RuntimeError('Stop the JSON gateway writer before import.') from error
        yield source.read_bytes()


def migrate(source,baseline,backup_dir,dsn,apply=False):
    source,baseline,backup_dir=Path(source),Path(baseline),Path(backup_dir)
    backup_dir.mkdir(parents=True,exist_ok=True,mode=0o700)
    with offline_source(source) as raw:
        stock=baseline.read_bytes()
        checksum=hashlib.sha256(raw+b'\0'+stock).hexdigest()
        for suffix,content in [('ledger.json',raw),('inventory.json',stock)]:
            path=backup_dir/(checksum+'.'+suffix)
            if path.exists():
                if path.read_bytes()!=content: raise RuntimeError('Backup checksum collision or corruption')
            else:
                fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
                with os.fdopen(fd,'wb') as f: f.write(content);f.flush();os.fsync(f.fileno())
        directory_fd=os.open(backup_dir,os.O_RDONLY)
        try: os.fsync(directory_fd)
        finally: os.close(directory_fd)
        try:
            state,capacities,sold,held,report=validate(load_json(raw),load_json(stock))
        except (ValueError,TypeError) as error:
            return {'checksum':checksum,'applied':False,'errors':[str(error)]}
        report.update(checksum=checksum,applied=False)
        if report['errors'] or not apply:
            return report
        with psycopg.connect(dsn,connect_timeout=3) as c:
            if not c.execute("SELECT pg_try_advisory_xact_lock(hashtextextended('commerce-lifecycle',0))").fetchone()[0]:
                raise RuntimeError('Stop all PostgreSQL gateway writers before import.')
            prior=c.execute('SELECT report FROM commerce_imports WHERE checksum=%s',(checksum,)).fetchone()
            if prior: return prior[0] | {'alreadyImported':True}
            if any(c.execute('SELECT EXISTS(SELECT 1 FROM '+table+')').fetchone()[0] for table in TABLES):
                raise RuntimeError('Import target is not empty; no merge or dual-write is supported.')
            for id,s in state['sessions'].items():
                c.execute('INSERT INTO commerce_sessions VALUES(%s,%s,%s,%s,%s)',(id,s.get('userId'),s['expires'],Jsonb(s),s.get('revision',0)))
            for (sku,mode),capacity in sorted(capacities.items()):
                c.execute('INSERT INTO commerce_inventory VALUES(%s,%s,%s,%s,%s)',(sku,mode,capacity,sold.get((sku,mode),0),held[(sku,mode)]))
                c.execute('INSERT INTO commerce_adjustments(id,sku,mode,delta,actor,reason) VALUES(%s,%s,%s,%s,%s,%s)',('import:'+checksum+':'+mode+':'+sku,sku,mode,capacity,'json-import','Reviewed inventory baseline '+checksum))
            for o in state['orders']:
                PostgresStore._insert_order(c,o)
                for p in o['items']:
                    c.execute('INSERT INTO commerce_reservations VALUES(%s,%s,%s,%s,%s)',(o['id'],p['sku'],o['paymentMode'],p['quantity'],'consumed' if o['status']=='paid' else 'held'))
                if o['status']=='paid': PostgresStore._insert_outbox(c,o)
            for session, aliases in state.get('checkoutKeys', {}).items():
                for key, order_id in aliases.items():
                    c.execute('INSERT INTO commerce_checkout_keys(session_id,key,order_id) VALUES(%s,%s,%s) ON CONFLICT DO NOTHING', (session,key,order_id))
            report.update(applied=True,fingerprint=fingerprint(c))
            c.execute('INSERT INTO commerce_imports(checksum,source_name,report) VALUES(%s,%s,%s)',(checksum,source.name,Jsonb(report)))
        return report


def rollback_check(dsn,checksum):
    with psycopg.connect(dsn,connect_timeout=3) as c:
        if not c.execute("SELECT pg_try_advisory_xact_lock(hashtextextended('commerce-lifecycle',0))").fetchone()[0]:
            raise RuntimeError('Stop all PostgreSQL writers before rollback validation.')
        row=c.execute('SELECT report FROM commerce_imports WHERE checksum=%s',(checksum,)).fetchone()
        if not row or row[0]['fingerprint']!=fingerprint(c):
            raise RuntimeError('PostgreSQL changed after import. Restoring old JSON would lose commerce state; roll forward/reconcile instead.')
        return {'rollbackSafe':True,'checksum':checksum,'action':'Keep PostgreSQL intact. Restore the verified JSON backup only while all gateways/workers are stopped.'}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source');parser.add_argument('--inventory');parser.add_argument('--backup-dir');parser.add_argument('--apply',action='store_true');parser.add_argument('--init-schema',action='store_true');parser.add_argument('--rollback-check');parser.add_argument('--report',required=True)
    args=parser.parse_args();dsn=os.environ.get('COMMERCE_DATABASE_URL')
    if args.init_schema:
        if not dsn: parser.error('COMMERCE_DATABASE_URL is required')
        with psycopg.connect(dsn) as c:
            if not c.execute("SELECT pg_try_advisory_xact_lock(hashtextextended('commerce-lifecycle',0))").fetchone()[0]: raise RuntimeError('Stop gateway writers before schema changes.')
            c.execute((Path(__file__).parent/'sql/001-commerce.sql').read_text())
        result={'schemaVersion':1}
    elif args.rollback_check: result=rollback_check(dsn,args.rollback_check)
    else:
        if not all([args.source,args.inventory,args.backup_dir]): parser.error('source, inventory and backup-dir are required')
        result=migrate(args.source,args.inventory,args.backup_dir,dsn,args.apply)
    fd=os.open(args.report,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600)
    with os.fdopen(fd,'w') as f: json.dump(result,f,indent=2)
    print('Report written. '+('Validation failed.' if result.get('errors') else 'Completed.'))
    if result.get('errors'): sys.exit(1)

if __name__=='__main__': main()
