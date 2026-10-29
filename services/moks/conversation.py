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


REFERENCE = re.compile(r'\b(those|these|them|that one|this one|it|which one|which of|both|the (?:first|second|third|last)(?: (?:one|two|three))?|first (?:one|two|three)|top (?:two|three))\b', re.I)
SINGULAR = re.compile(r'\b(that one|this one|it|the (?:first|second|third|last)(?: one)?)\b', re.I)
# An explicit topic change starts a fresh search even if it mentions earlier products.
TOPIC_CHANGE = re.compile(r'\b(forget|ignore|never ?mind|instead|start over|something else|new search)\b', re.I)
POSITIONS = {'first': 0, 'second': 1, 'third': 2, 'last': -1}
COUNTS = {'one': 1, 'two': 2, 'three': 3}


def reference_skus(products, question, history):
    """SKUs the question refers to, in the order they were shown; None for a fresh search."""
    if TOPIC_CHANGE.search(question) or not REFERENCE.search(question):
        return None
    # Only the most recent product-bearing turn is used, in stored order. Old
    # prices/descriptions are never retrieval evidence. Resolve against today's
    # catalogue; legacy saved turns have slugs but no SKU.
    refs = next((turn.get('products') for turn in reversed(history) if turn.get('products')), [])
    def resolve(ref):
        return next((p['sku'] for p in products
                     if p['sku'] == ref.get('sku') or (p.get('slug') or p['sku'].lower()) == ref.get('slug')), None)
    shown = [resolve(ref) for ref in refs]  # Positions follow what the customer saw.
    current = list(dict.fromkeys(sku for sku in shown if sku))
    ordinal = re.search(r'\b(?:the )?(first|second|third|last|top)(?: (one|two|three))?\b', question, re.I)
    if ordinal:
        word, count = ordinal[1].lower(), COUNTS.get((ordinal[2] or 'one').lower(), 1)
        start = 0 if word == 'top' else POSITIONS[word]
        chosen = shown[-1:] if start < 0 else shown[start:start + count]
        if len(chosen) < count or not all(chosen):
            return []  # Points past what was shown, or at a product that is gone: clarify.
        return chosen
    if SINGULAR.search(question) and len(current) > 1:
        names = [p['name'] for sku in current for p in products if p['sku'] == sku]
        raise Clarification('Which one do you mean: ' + ', '.join(names[:-1]) + ' or ' + names[-1] + '?')
    return current
