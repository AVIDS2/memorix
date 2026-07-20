# Case Candidate Ledger

This ledger records evaluated case ideas that are not part of the executable
MemorixBench corpus. A candidate may not be used in an agent comparison or a
paper result until it passes the same provenance, dependency, isolation, and
four-gate authoring requirements as an admitted case.

## Deferred: p-limit runtime concurrency contract

- Upstream: `https://github.com/sindresorhus/p-limit`
- Base revision: `42599ebbbb1228a5bdab381fcf8f4ac20eb8d551`
- License: MIT
- Historically grounded policy commits:
  `3e4fdd16df0461e56e58cc32686d3011f5e2b461` (runtime concurrency setter),
  `ae0dfeccd7b2c1e403297f741cd0b5636b098924` (`Infinity` is valid), and
  `4ab2813001fae4345d02e7fee394222cffd371d9` (invalid values fail).

The candidate would use a benchmark-authored helper extraction that mutates the
runtime concurrency state before validating it. Its hidden oracle would require
invalid updates to fail without changing the previous value while preserving
the valid `Infinity` case.

**Status: deferred, not an executable case.** The upstream snapshot has no
reproducible lockfile. On the current Node 22 toolchain its full `npm test`
path is broken by XO/TypeScript dependency drift even though the focused AVA
logic tests and `tsd` checks pass. The current source also exposes the relevant
validator clearly enough that the estimated precursor dependency is low to
medium. Admission requires a pinned historical dependency environment or an
auditable container image, a fresh four-gate run, and a reassessed dependency
classification.
