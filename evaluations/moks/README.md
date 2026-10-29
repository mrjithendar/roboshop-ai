# Moks evaluation (`moks-eval-v1`)

An offline, versioned evaluation of the Moks shopping assistant. It runs the real agent,
retrieval, engine and widget code against a 16-product synthetic catalogue. The catalogue
includes reference, on-request, illustrative, archived, out-of-stock and demo listings, and
one listing whose description contains a prompt injection. It never calls a model or a
paid service.

```bash
python -m pip install -r services/moks/requirements.txt
python evaluations/moks/run.py                                   # 42 cases, prints a summary
python evaluations/moks/run.py --output evaluations/moks/results/final.json
python evaluations/moks/run.py --ask "robot vacuum under 10k INR" --ask "Which of those is cheaper?"
python -m unittest discover -s evaluations/moks -p 'test_*.py'  # gate: every case must pass
```

## What is scored, and how

| Group | Cases | Deterministic checks |
|---|---|---|
| Retrieval | 20 | Expected status; required, excluded or exact SKUs; empty results. Covers budget formats (`INR 5,000`, `₹5000`, `5000 rupees`, `10k INR`), currency conflicts and no conversion, explicit requirements, specifications, archived and out-of-stock listings, no-match, vague requests, generic words, on-request prices and "buy now". |
| Structured response | 4 (plus every case with cards) | Cards are known, non-archived SKUs with catalogue price and currency. Cards come from the evidence the model received, and equal the products the reply recommends. At most three. No raw `Products:` line is left in the reply. Price type and demo flags are preserved. |
| Conversation | 11 | Follow-ups such as "Which of those is cheaper?", "Compare the first two." and "Does that one support carpets?". Also: ambiguous "that one", "Forget those…" topic changes, budget-only refinement, stale prices in history, unresolved references, ordinals without history, and a long history that keeps the question intact. |
| Safety | 3 | A prompt-injected listing is not promoted. An injection in the request retrieves nothing. An order request performs no action. |
| Authorization | 4 | `/internal/chat` requires the service token. The engine rejects caller-supplied identity fields. The widget rejects browser-supplied history or user IDs. Extra history fields (user ID, session, cookie, old price) never reach the prompt. |

The provider is a **deterministic stand-in**. It recommends up to three products from the
evidence it received, in order, and ends with a `Products:` line. That isolates
retrieval, structured-response and conversation plumbing. **It says nothing about a real
model's prose.** Free text is scored by people with [HUMAN_RUBRIC.md](HUMAN_RUBRIC.md).

An LLM judge is not implemented, and none runs by default. Recorded production executions
can still be scored with `evaluations/agents/evaluate.py`.

## Baseline versus final

The same dataset and harness were run on the code before and after the change. The output
is kept in `results/baseline.json` and `results/final.json`.

| | Baseline | Final |
|---|---|---|
| Cases passed | 22 / 42 | 42 / 42 |
| Retrieval | 8 / 20 | 20 / 20 |
| Conversation | 5 / 11 | 11 / 11 |
| Structured | 3 / 4 | 4 / 4 |
| Safety | 2 / 3 | 3 / 3 |
| Authorization | 4 / 4 | 4 / 4 |
| Structured checks, excluding the new `Products:`-line check | 74 / 76 | 100 / 100 |

The baseline's raw structured score (74 / 94) also counts the new "no `Products:` line"
check, which old code could not pass. The comparable figure is 74 / 76.

Baseline failures, now fixed:
- **Word forms:** "educational" did not match "education", and "vacuums" did not match
  "vacuum". This also broke plain follow-ups.
- **Substrings:** "on" and "works" matched as substrings, so the carpet query returned
  four products, including the injected kit.
- **Budget keywords:** "underwater" was read as the budget keyword "under".
- **Budget formats:** "5000 rupees" and "10k" were not parsed.
- **Vague requests:** "Help me choose" and "something good for my home" either retrieved
  unrelated products or nothing, instead of asking one question.
- **Buy now:** "I can buy now" still returned an on-request reference listing.
- **Conversation:**
  - "Forget those…" was treated as a reference.
  - "Compare the first two" was not recognised.
  - A budget-only follow-up dropped the topic.
- **Injected requests:** an injection in the request retrieved the listing that contained
  the same words.

The dataset and the fixes were written by the same person, so the gate cannot rule out
overfitting by itself. As a check, natural queries were also run against the real
`products.json` and reference catalogues, which the dataset does not use. That surfaced
two further fixes: compound names ("lawn" → LawnPilot) and "coding" → education.
