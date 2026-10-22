"""Explicit purchase provenance repair; dry-run by default. No provider calls."""
import argparse
import copy
import json
import os
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path

FIELDS = ('demo', 'inventoryProvenance', 'productProvenance')
def repair(order, purchase):
    try:
        return _repair(order, purchase)
    except (KeyError, TypeError, ValueError, ArithmeticError):
        return {}, 'malformed authoritative order or purchase'

def _repair(order, purchase):
    if order.get('id') != purchase.get('_id'):
        return {}, 'identity mismatch'
    for key in ('userId', 'paymentMode', 'currency'):
        if not order.get(key) or order[key] != purchase.get(key):
            return {}, key + ' mismatch'
    if Decimal(str(order['total'])) != Decimal(str(purchase['total'])):
        return {}, 'amount mismatch'
    minor = Decimal(str(order['total'])) * 100
    if not minor.is_finite() or minor != minor.to_integral_value() or minor != purchase.get('totalMinor'):
        return {}, 'minor amount mismatch'
    for key in ('paymentCaptured', 'synthetic'):
        if type(order.get(key)) is not bool or type(purchase.get(key)) is not bool or order[key] != purchase[key]:
            return {}, key + ' missing or conflicting'
    if order.get('status') != 'paid' or purchase.get('status') != 'paid':
        return {}, 'not paid'
    if type(order.get('demo')) is not bool or order.get('inventoryProvenance') not in ('merchant', 'demo', 'unknown'):
        return {}, 'authoritative provenance missing'
    rows = order.get('productProvenance')
    if not isinstance(rows, list) or not rows or {p.get('sku') for p in rows} != {p.get('sku') for p in order['items']}:
        return {}, 'authoritative product provenance missing'
    if any(not isinstance(p, dict) or any(type(p.get(k)) is not bool for k in ('demo','synthetic'))
           or p.get('fulfilment') not in ('merchant','simulated','unknown') for p in rows):
        return {}, 'authoritative product provenance invalid'
    updates = {}
    for key in FIELDS:
        old, new = purchase.get(key), order[key]
        if type(old) is type(new) and old == new:
            continue
        if old is not None and not (key == 'inventoryProvenance' and old == 'unknown') and not (key == 'productProvenance' and old == []):
            return {}, key + ' conflict'
        updates[key] = copy.deepcopy(new)
    return updates, None

def apply_repair(collection, purchase, updates, actor):
    """Compare immutable identity and old provenance; update audit in the same write."""
    if not actor or not updates or set(updates) - set(FIELDS):
        raise ValueError('A repair and audit actor are required')
    match = {key: purchase[key] for key in ('_id', 'userId', 'paymentMode', 'currency', 'total', 'totalMinor', 'status')}
    for key in FIELDS:
        match[key] = purchase[key] if key in purchase else {'$exists': False}
    audit = {'at': datetime.now(timezone.utc), 'actor': actor,
             'operation': 'provenance-backfill', 'before': {k: purchase.get(k) for k in updates}, 'after': updates}
    result = collection.update_one(match, {'$set': updates, '$push': {'provenanceAudit': audit}})
    return 'repaired' if result.matched_count else 'concurrent-conflict'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument('--ledger', type=Path, help='Read-only authoritative JSON snapshot')
    source.add_argument('--postgres', action='store_true', help='Read snapshots using COMMERCE_DATABASE_URL')
    parser.add_argument('--database', required=True, help='User-service Mongo database')
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--actor', help='Operator identity recorded in repair audit')
    args = parser.parse_args()
    if args.apply and not args.actor:
        parser.error('--apply requires --actor')
    if args.ledger:
        orders = json.loads(args.ledger.read_text())['orders']
    else:
        import psycopg
        with psycopg.connect(os.environ['COMMERCE_DATABASE_URL']) as conn:
            conn.execute('SET TRANSACTION READ ONLY')
            orders = [row[0] for row in conn.execute('SELECT snapshot FROM commerce_orders')]
    from pymongo import MongoClient
    with MongoClient(os.environ['USER_MONGODB_URL'], serverSelectionTimeoutMS=5000) as client:
        collection = client[args.database].purchase_history
        for order in orders:
            purchase = collection.find_one({'_id': order['id']})
            if not purchase:
                continue
            updates, conflict = repair(order, purchase)
            status = 'conflict' if conflict else 'candidate' if updates else 'unchanged'
            if updates and args.apply:
                status = apply_repair(collection, purchase, updates, args.actor)
            print(json.dumps({'orderId': order['id'], 'status': status, 'fields': list(updates), 'reason': conflict}))
if __name__ == '__main__':
    main()
