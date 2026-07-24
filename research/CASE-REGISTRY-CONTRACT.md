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

Before a real-repository source lead can enter authoring, it must also pass the
independent human review in `CASE-ADMISSION-REVIEW-CONTRACT.md`. That review
checks that the private transition is not a relabelled public solution and that
current-source sufficiency was genuinely considered. The receipt is an
accountability record, not a claim that public history or model pretraining can
be erased.

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

`public-reproducible` is a third, explicitly weaker enrollment class for the
public local-fixture cohort. It requires the `public-evaluation` split, a
preregistered dependency card, public oracle assets, explicit agent-writable
source roots, and a frozen public transition. It can support a locally
reproducible comparison under its declared model and tool surface, but never a
private-oracle or pretraining-contamination claim.

The current registry contains twelve `public-reproducible` entries in the
first frozen cohort. The original eight development exercises were withdrawn
after leakage review and are outside the public artifact. Registry admission is
not a quality label: every result must still satisfy the frozen cohort plan and
the result validator before it is analyzed.
