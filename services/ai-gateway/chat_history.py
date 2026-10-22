"""Bounded, account-owned conversations. No session tokens or provider secrets stored."""
from datetime import datetime, timezone
from runtime import HttpError

class ChatHistory:
    def __init__(self, db):
        self.collection = db.chat_history

    def read(self, user_id):
        try:
            row = self.collection.find_one({'_id': user_id})
            return (row or {}).get('turns', [])
        except Exception:
            raise HttpError(503, 'Chat history is temporarily unavailable.') from None

    def save(self, user_id, message, result):
        turn = {'message': message, 'answer': str(result.get('answer', ''))[:12000],
                'createdAt': datetime.now(timezone.utc).isoformat(),
                'products': [{'sku': p['sku'], 'name': p['name'], 'slug': p.get('slug') or p['sku'].lower()}
                             for p in result.get('products', [])[:4]]}
        try:
            self.collection.update_one({'_id': user_id},
                {'$push': {'turns': {'$each': [turn], '$slice': -40}},
                 '$set': {'updatedAt': turn['createdAt']}}, upsert=True)
        except Exception:
            raise HttpError(503, 'The reply could not be saved. Chat history is temporarily unavailable.') from None

    @staticmethod
    def context(turns):
        """Only recent account-owned text and references cross the service boundary."""
        return [{
            'message': str(t.get('message', ''))[:1000],
            'answer': str(t.get('answer', ''))[:1000],
            'products': [{k: p[k][:100] for k in ('sku', 'slug') if isinstance(p.get(k), str)}
                         for p in t.get('products', [])[:4] if isinstance(p, dict)],
        } for t in turns[-2:] if isinstance(t, dict)]
