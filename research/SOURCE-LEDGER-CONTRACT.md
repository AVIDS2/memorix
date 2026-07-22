# Source Ledger Contract

`cases/CANDIDATE-SOURCES.toml` is an auditable recruiting ledger, not a task
dataset. It records why a real repository was considered without republishing
an issue thread, PR discussion, patch, hidden test, or reference repair.

Every entry pins an immutable base commit, the license path and SHA-256 observed
at that commit, canonical source URLs, causal-chain type, environment status,
benchmark-overlap review status, public-solution disclosure, and a rationale.
`memorixbench validate-source-ledger` rejects malformed provenance and refuses
to mark a source `admitted` unless it has an allowlisted license, an offline
environment, completed overlap review, and a private post-snapshot transition
plan.

`standalone-pr` is intentionally a weaker causal-chain label than `issue-pr`,
`review-revision`, or `pr-chain`; it is useful for screening but should not be
used to satisfy a preregistered source-diversity quota on its own.

## What a public PR can and cannot provide

A public issue or pull request can establish that an engineering problem had a
real upstream cause. It cannot supply an unobserved oracle: its discussion,
patch, and tests are already public and may have appeared in training data.
MemorixBench therefore treats public history as a source lead only. The actual
Track C transfer case must be rebuilt from a pinned base with a new private
post-snapshot transition, newly captured precursor sessions, and a controller-
only oracle.

This makes the claim deliberately narrower and more defensible: under the same
code prior, does a declared memory intervention improve cross-session transfer?
It does not claim to prove novel-code synthesis or absence from model training.

## v1 exclusions

- Licenses outside Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, or MIT.
- Repositories requiring credentials, hosted services, arbitrary downloads, or
  an unpinned networked dependency build.
- Direct reuse of public issue text, public solution patches, or public hidden
  test content as an evaluation oracle.
- Security-sensitive reports, user data, or unresolved vulnerabilities.
- Sources from a repository, task family, or trace family already assigned to a
  different corpus split.

SWE-bench and Defects4J are useful calibration and recruiting references, but
not a drop-in confirmatory corpus: SWE-bench explicitly uses real GitHub issues
and a containerized evaluation harness, while their tasks and solutions are
widely public. See the [SWE-bench README](https://github.com/SWE-bench/SWE-bench/blob/main/README.md)
and [Defects4J](https://github.com/rjust/defects4j). Source descriptions in
the public artifact must be independently written; GitHub issue/PR text is not
copied wholesale.
