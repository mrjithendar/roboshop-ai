"""Indexed reviews; demo activity is never evidence of a genuine purchase."""
import re
import uuid
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError
from runtime import HttpError, now, database_operation
from auth import require_role

NOTICE = 'Demo reviews and purchase activity are synthetic.'


def indexes(db):
    db.reviews.create_index([('productId', 1), ('authorId', 1)], unique=True)
    db.reviews.create_index([('productId', 1), ('status', 1), ('synthetic', 1), ('_id', 1)])
    db.reviews.create_index([('status', 1), ('_id', 1)])
    db.reviews.create_index([('synthetic', 1), ('datasetId', 1)])
    db.purchase_history.create_index([('userId', 1), ('items.sku', 1), ('status', 1)])


def content(data):
    if set(data) != {'rating', 'title', 'body'} or type(data['rating']) is not int or not 1 <= data['rating'] <= 5:
        raise HttpError(400, 'Supply rating (integer 1–5), title and body only.')
    for key, low, high in [('title', 3, 100), ('body', 10, 2000)]:
        value = data[key]
        if not isinstance(value, str) or not low <= len(value.strip()) <= high or re.search(r'[<>\x00-\x08\x0b-\x1f\x7f]', value):
            raise HttpError(400, f'{key} must be plain text, {low}–{high} characters, without markup or control characters.')
    return {k: v.strip() if isinstance(v, str) else v for k, v in data.items()}


class Reviews:
    def __init__(self, db):
        self.db = db
        indexes(db)

    def verified(self, row):
        if row.get('synthetic'):
            return False
        return bool(self.db.purchase_history.find_one({
            'userId': row['authorId'], 'items.sku': row['productId'], 'status': 'paid',
            'synthetic': {'$ne': True}, 'paymentCaptured': True, 'paymentMode': 'live',
            'paidAt': {'$lte': row['createdAt']},
        }, {'_id': 1}))

    def public(self, row):
        return {k: row[k] for k in ('productId', 'rating', 'title', 'body', 'createdAt', 'updatedAt', 'synthetic', 'status')} | {
            'id': row['_id'], 'author': 'Synthetic demo customer' if row['synthetic'] else 'Customer',
            'verifiedPurchase': self.verified(row),
        }

    @database_operation('reviews.list')
    def listing(self, product, query, admin=False):
        cursor = query.get('after', '')
        if not isinstance(cursor, str) or len(cursor) > 160 or (cursor and not re.fullmatch(r'[A-Za-z0-9:_-]+', cursor)):
            raise HttpError(400, 'Invalid review cursor.')
        kind = query.get('kind', 'real')
        if kind not in ('real', 'demo'):
            raise HttpError(400, 'Choose real or demo reviews.')
        match = {'synthetic': kind == 'demo'}
        if product:
            match['productId'] = product
        if not admin:
            match['status'] = 'published'
        rows = list(self.db.reviews.find(match | ({'_id': {'$gt': cursor}} if cursor else {})).sort('_id', 1).limit(21))
        aggregate = list(self.db.reviews.aggregate([
            {'$match': match | {'status': 'published'}},
            {'$group': {'_id': None, 'count': {'$sum': 1}, 'average': {'$avg': '$rating'}}},
        ], maxTimeMS=3000))
        return {'reviews': [self.public(r) for r in rows[:20]], 'next': rows[19]['_id'] if len(rows) > 20 else None,
                'summary': {k: aggregate[0][k] for k in ('count', 'average')} if aggregate else {'count': 0, 'average': None}, 'kind': kind, 'notice': NOTICE}

    @database_operation('reviews.write')
    def write(self, product, user, method, data=None):
        require_role(user)
        key = {'productId': product, 'authorId': user['id'], 'synthetic': False}
        if method == 'DELETE':
            self.db.reviews.delete_one(key)
            return {'deleted': True}
        value = content(data)
        if method == 'POST':
            try:
                self.db.reviews.insert_one(key | value | {'_id': str(uuid.uuid4()), 'status': 'pending', 'createdAt': now(), 'updatedAt': now()})
            except DuplicateKeyError:
                raise HttpError(409, 'You already reviewed this product. Edit your existing review.')
        else:
            result = self.db.reviews.update_one(key, {'$set': value | {'status': 'pending', 'updatedAt': now()}})
            if not result.matched_count:
                raise HttpError(404, 'Your review was not found.')
        return {'saved': True, 'message': 'Your review is awaiting moderation.'}

    def moderate(self, id, user, data):
        require_role(user, ('admin', 'superadmin'))
        if set(data) != {'status'} or data['status'] not in ('published', 'hidden', 'pending'):
            raise HttpError(400, 'Choose published, hidden or pending.')
        row = self.db.reviews.find_one_and_update({'_id': id}, {'$set': {**data, 'moderatedBy': user['id'], 'moderatedAt': now()}}, return_document=ReturnDocument.AFTER)
        if not row:
            raise HttpError(404, 'Review not found.')
        return self.public(row)
