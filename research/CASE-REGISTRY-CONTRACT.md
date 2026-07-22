# Case Registry Contract

`cases/REGISTRY.toml` is the frozen public inventory for MemorixBench. It is
not a leaderboard input and does not turn a case into evidence by itself. Its
job is to make case inclusion and case drift auditable before any aggregate
comparison is calculated.

Each entry binds an id, relative `case.toml` path, enrollment class, corpus
split, repository/task/trace family ids, authoring batch, source and
contamination disclosure, dependency card, captured-trace count, and SHA-256 of
the complete public case-definition tree. `memorixbench validate-registry`
rejects a missing case, an unregistered case, a duplicate, a path escape, an id
mismatch, a changed public definition, or a shared repository/task/trace family
across corpus splits.

The dependency card has four deliberately separate statements: why predecessor
knowledge is needed, the smallest useful evidence, a tempting but obsolete
distractor, and what a no-memory agent should reasonably be able to infer. It
is a preregistration aid, not an oracle answer. Before a development case can
contribute to an effect comparison, it also needs dependency admission: the
policy must not be directly encoded in the transfer prompt, public tests, or
agent-visible oracle material; public traces must omit answer-key material; and
a matched no-memory cohort must be reported rather than assumed weak. The case
workspace never mounts this registry for a worker.

`contamination_risk` is a disclosure, not a magical proof that a public
repository was absent from model training. A confirmatory public-repository
case must use a privately authored post-snapshot transition, record the risk,
and be analyzed as an intervention on shared code priors rather than a test of
novel code synthesis.

## Enrollment classes

`development-pilot` is reserved for a clean, private-overlay authoring cohort. It requires a
`development` split and `retrospective-development` dependency classification.
Seeded Track B pilots must declare zero captured traces. Track C pilots must
bind a `trace-replay` multi-capture bundle and declare its exact capture count;
the loader verifies every trace/receipt commitment and their shared snapshot.
Both kinds are useful for authoring gates, adapter smoke, runtime variance, and
failure-mode discovery. They are never included in a confirmatory table.

`confirmatory` is deliberately unavailable to a merely polished development
case. It requires a `validation` or `test` split, preregistered dependency
classification, private oracle, Track C trace replay,
`captured-session-v1` provenance, a public repository, a privately authored
post-snapshot transition, and at least two independently captured precursor
traces. The separate private overlay and KVM controller admission gates still
apply after registry validation. The runner will not use a confirmatory entry
until its trace-selection and external black-box gates also pass.

The current registry intentionally has zero entries. The original eight
development exercises were withdrawn after leakage review and are outside the
public artifact. An empty registry is a valid state: it prevents an unsafe case
from becoming a benchmark merely because the harness can execute it. New cases
must enter through fresh ids and the full sealed-task admission path.
