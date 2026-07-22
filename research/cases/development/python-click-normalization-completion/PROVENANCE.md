# Source provenance

- Upstream repository: `https://github.com/pallets/click`
- Pinned base: `8c1a0a7abbc1c36f70d1f65f3604acc46c5ce6ab`
- License: BSD-3-Clause
- Environment preflight: `cases/preflight/click-help-parameter.json`

This is a benchmark-authored controlled migration on a real Click source
snapshot. It is not a replay of an upstream incident or pull request. The
historical Click source is used for its parser, Context, type, and shell
completion architecture only.

At the precursor snapshot, option token normalization is shared through
Context and is used by parsing and completion comparisons. The retained policy
is that a `token_normalize_func` receives the option name body, never the `-`
or `--` CLI prefix. Matching can normalize names, but completion results retain
the spelling declared by the command.

The benchmark-authored transition moves option splitting and normalization
primitives into `utils.py`, then incorrectly normalizes the entire prefixed
option. The hidden behavioral oracle supplies a prefix-sensitive normalizer;
the reference repair preserves the prefix before delegating the name body. The
source checks prevent restoring a local parser/core implementation instead of
finishing the intended utility ownership migration.

This development case is not confirmation evidence. Its comparison eligibility
is governed by `DEPENDENCY-ADMISSION.md` and remains pending until matched
no-memory screening and trace-leakage review are complete.
