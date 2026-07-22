Read only these source areas: `src/click/core.py` around Context token
normalization, `src/click/parser.py` around option normalization,
`src/click/types.py` around Choice completion, and
`tests/test_normalization.py`.

Do not inspect other files. Do not edit code. Return exactly three bullets,
under 80 words total, with no code or repair steps:

- the durable normalizer boundary;
- why parsing and completion must agree;
- one stale implementation location that should not become the policy.
