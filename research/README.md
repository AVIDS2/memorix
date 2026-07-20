# MemorixBench-Transfer

MemorixBench-Transfer is the reproducible research artifact for evaluating
freshness-aware, multi-session project memory in coding agents. It extends the
deterministic Workset tests in the main Memorix repository with downstream
engineering outcomes: whether a fresh agent starts in the right place, avoids
obsolete guidance, and completes a dependent task after project state changes.

This directory is a research program, not a benchmark claim. Results remain
unproven until the preregistered confirmatory run is complete and independently
audited.

## Research tracks

1. Deterministic retrieval checks reuse the existing Workset fixture corpus.
2. Seeded retrieval compares memory systems with the same approved evidence.
3. End-to-end formation gives every system the same precursor sessions and
   evaluates a fresh agent on a dependent transfer task.
4. Stale-memory stress cases change code, dependencies, configuration, or
   project policy between the precursor and transfer phases.
5. Real engineering cases grade patches with isolated tests rather than an LLM
   judge.

## Layout

- PROTOCOL.md: preregistration draft and statistical analysis plan.
- BASELINE_PROTOCOL.md: fair canonical and native memory-baseline contract.
- CLAIMS.md: every intended paper claim and the evidence required to unlock it.
- LITERATURE.md: comparison boundaries for adjacent memory systems and benchmarks.
- RESULTS-PILOT.md: excluded diagnostics and non-confirmatory smoke evidence.
- cases/: public case manifests and case-authoring rules.
- src/memorixbench/: manifest validation and analysis tooling.
- tests/: deterministic tests for the research tooling.
- artifacts/: checksums and public artifact metadata; large local artifacts are ignored.
- results/: final aggregate tables; raw traces and model logs are ignored.
- paper/: the English LaTeX manuscript once verified sources and results exist.

## Local setup

From this directory:

    uv sync --extra dev --extra analysis
    uv run pytest
    uv run memorixbench validate-cases cases

Raw worktrees, transcripts, patches, model events, and caches must be written to
an external artifact root. Set MEMORIXBENCH_ARTIFACT_ROOT to a drive with enough
space. Do not point experiments at the user's normal Memorix data directory.
Every condition receives an isolated data directory and repository checkout.

Development cases also carry a maintainer-only `oracle.reference_patch`. Run
`memorixbench grade ... --phase transfer --reference --allow-case-commands` in
a fresh materialized workspace to verify that the known-good repair passes the
same hidden tests used for agents. The reference patch is never mounted during
an agent run. A case may also declare scoped source checks for refactoring
boundaries that behavior tests cannot observe directly. Those checks run after
the agent exits but before hidden tests are mounted, are included with source
hashes in `grade` output and trial artifacts, and are part of task success
rather than advisory prose. For a semantic ownership constraint, use a hidden
language-specific validator rather than relying on string matching alone.

Before a case is eligible for an agent run, execute all four authoring gates in
one fresh artifact root:

    uv run memorixbench verify-case cases/development/<case>/case.toml \
      --target-root F:/memorix-research-artifacts/case-authoring/<case> \
      --allow-case-commands

The command proves precursor-public success, transfer-public success, hidden
regression failure, and reference-repair success. It intentionally preserves
the four materialized workspaces as audit evidence.

## Reproducibility contract

A publishable run must record the case manifest hash, repository revision,
transition hash, condition, agent and model identifiers, seed, command line,
environment lock, container digest when used, token and time accounting, patch
hash, test evidence, and raw event-log checksum. Aggregate tables without that
provenance are exploratory only.

The requested model label is not sufficient provenance. Runs record the
provider-reported per-model token and cost breakdown plus a `single`, `mixed`,
or `unreported` execution profile. A run that uses a helper model is reported
as a mixed client stack rather than as a pure single-model result.

Baseline adapters must additionally pass their pinned local preflight before an
agent run. See `BASELINE_PROTOCOL.md` for the equal-evidence/equal-budget
retrieval contract and the distinction between canonical and native product
tracks.
