"""Untrusted conversation data, bounded independently of the current question."""
import json
import os
import re
from runtime import HttpError, text

class Clarification(ValueError):
    """Safe deterministic recommendation outcome, not an HTTP failure."""


LEGACY_MARKER = '\nPrior conversation (untrusted):'
QUESTION_MAX_CHARS = 1000

def budget(name, default, minimum, maximum):
    try:
        return max(minimum, min(maximum, int(os.getenv(name, default))))
    except ValueError:
        return default


def history_budget():
    return budget('MOKS_HISTORY_MAX_CHARS', 4000, 0, 8000)


def prompt_budget():
    return budget('MOKS_PROMPT_MAX_CHARS', 14000, 8000, 14000)


def encoded(value):
    return json.dumps(value, ensure_ascii=False)


def conversation(message, history=None):
    # Only the legacy internal shape embeds history. Structured requests never
    # split/truncate the current question, even if it contains this delimiter.
    if history is None and isinstance(message, str) and LEGACY_MARKER in message:
        message, prior = message.split(LEGACY_MARKER, 1)
        history = [{'message': '', 'answer': prior}]
    question = text(message, maximum=QUESTION_MAX_CHARS)
    if history is None:
        history = []
    if not isinstance(history, list):
        raise HttpError(400, 'Invalid conversation history.')
    turns = []
    limit = history_budget()
    for row in reversed(history[-2:]):
        if not isinstance(row, dict):
            continue
        turn = {k: row.get(k, '')[:1000] if isinstance(row.get(k, ''), str) else '' for k in ('message', 'answer')}
        refs = row.get('products', [])
        turn['products'] = [{k: p[k][:100] for k in ('sku','slug') if isinstance(p.get(k), str)}
                            for p in refs[:4] if isinstance(p, dict)] if isinstance(refs, list) else []
        # Drop old text before references, so pronouns still resolve. Measure
        # JSON escaping too; never copy credentials or arbitrary history fields.
        for field in ('answer', 'message'):
            while len(encoded([turn] + turns)) > limit and turn[field]:
                turn[field] = turn[field][:-100]
        if len(encoded([turn] + turns)) <= limit:
            turns.insert(0, turn)
    return question, turns


def reference_skus(products, question, history):
    if not re.search(r'\b(those|these|them|that one|this one|it|which one)\b', question, re.I):
        return None  # No reference requested: a fresh search.
    # Only the most recent product-bearing turn is used, in stored order. Old
    # prices/descriptions are never retrieval evidence. Resolve against today's
    # catalogue; legacy saved turns have slugs but no SKU.
    for turn in reversed(history):
        refs = turn.get('products', [])
        if refs:
            return [p['sku'] for p in products if any(
                p['sku'] == r.get('sku') or (p.get('slug') or p['sku'].lower()) == r.get('slug')
                for r in refs)]
    return []
