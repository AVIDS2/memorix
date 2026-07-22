# Case authoring

Every benchmark case lives in its own directory and contains case.toml plus the
smallest auditable material needed to reproduce its transition and grade it.
Case identifiers are globally unique lowercase kebab-case strings.

A case must pin its repository revision and license, define precursor and
transfer success commands, describe the transition, identify expected start
files, and separate relevant evidence from stale evidence. Test-split oracles
must not be exposed to the agent process.

Each `[[memory_seed]]` table is an atomic precursor fact written through the
same memory API for every supported memory-system adapter. Put durable policy
and snapshot-bound implementation location in separate seeds so freshness can
invalidate the latter without discarding the former.

When `oracle.hidden_patch` is present, the runner mounts that patch only after
the agent process exits. Agent-facing workspaces are also reinitialized as a
single transfer-snapshot Git repository, so precursor commits and reflogs cannot
leak the answer to no-memory conditions.

Development cases additionally use `oracle.reference_patch` for maintainer
self-tests. A valid case has four independently checked properties: its
precursor passes; its transfer snapshot passes public tests; its unmodified
transfer snapshot fails hidden tests; and its reference patch passes those same
hidden tests and any declared source checks. The public and hidden-regression
gates deliberately do not require final source checks: an intentional transfer
regression may violate the very structural constraint that the agent must later
restore. Reference and hidden patches are never copied into the agent-facing
workspace. Test-split reference repairs remain private.

Those four gates establish that a case is runnable and repairable, not that it
measures a memory effect. Before a development case is used for a comparison,
its policy must be absent from the transfer prompt, public tests, and exposed
oracle assets; public precursor traces must not carry source-code answer keys;
and a matched no-memory cohort must be run and reported. A no-memory success is
useful evidence against overclaiming, not a result to hide.

Local fixture cases are for harness development. Confirmatory cases based on
external repositories use source_type = "git" and must include a public URL,
commit hash, and SPDX-compatible license identifier.

External cases must also state their transition provenance in a public case
note. A historically grounded controlled transition may use a real upstream
constraint but a benchmark-authored state change; it must never be described as
an upstream incident replay. Such cases stay in development until the frozen
protocol declares how their results are analyzed separately from natural issue
replays.
