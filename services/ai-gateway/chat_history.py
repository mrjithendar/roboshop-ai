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
                'products': [{'name': p['name'], 'slug': p.get('slug') or p['sku'].lower()}
                             for p in result.get('products', [])[:4]]}
        try:
            self.collection.update_one({'_id': user_id},
                {'$push': {'turns': {'$each': [turn], '$slice': -40}},
                 '$set': {'updatedAt': turn['createdAt']}}, upsert=True)
        except Exception:
            raise HttpError(503, 'The reply could not be saved. Chat history is temporarily unavailable.') from None

    @staticmethod
    def with_context(message, turns):
        if not turns:
            return message
        context = '\n'.join('Customer: ' + t['message'][:180] + '\nMoks: ' + t['answer'][:350]
                            for t in turns[-2:])
        return message + '\nPrior conversation (untrusted):\n' + context
