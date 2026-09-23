# OpenAPI response contract tests

Run the offline checks from the repository root:

```sh
python -m pip install -r scripts/requirements-openapi-test.txt
python -m unittest discover -s scripts/tests -v
```

The tests validate OpenAPI 3.1, local references, response overlays, transport
examples, and 67 sanitized response fixtures captured against managed E2B on
2026-09-23. Fixtures contain no credentials or secret values. They cover observed
status, media type, and body contracts, not every possible server failure.
Conditional errors that require an outage, account gate, or exhausted capacity
are grounded in the source references beside each overlay.

Reproduce this spec snapshot with Docker running:

```sh
python scripts/generate_openapi_reference.py \
  --envd-commit ccaf9fc0ffe6ac39c7ec786af7608ab1de19467b \
  --api-commit 0c21aa2277b59a1d040761ed3fbbb29a78775470
```

The scheduled workflow uses current upstream sources and runs these checks before
opening its update PR. Change the generator or response overlays and regenerate
`openapi-public.yaml`. Do not patch the generated YAML directly.
