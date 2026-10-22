# Recorded-execution evaluations

`evaluate.py` scores recorded synthetic executions only; it never calls a model.
Use `python -m unittest discover -s evaluations/agents -p 'test_*.py'` for offline tests.

A required-claims case scores `supported_structured_claims = 0` for absent or empty
claims. Every claim must have a string SKU, a string catalogue specification field,
and an explicit value matching that specification. Unknown products/fields,
malformed claims and incorrect values fail.

For optional claims, omission produces no claims score. An empty array scores 1
only in the narrow sense that no supplied assertion contradicts the catalogue;
it is **not evidence of factual coverage**. Use `claimsRequired` to require evidence.
Free-text assertions are not automatically judged by this metric.

Score IDs remain deterministic and each score retains the recorded execution's
trace and observation IDs. Publishing requires the explicit `--publish` option.
