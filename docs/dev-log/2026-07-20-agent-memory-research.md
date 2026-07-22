# Agent Memory Research Program

Started: 2026-07-20
Baseline: Memorix 1.2.1

## Goal

Build a reproducible study of freshness-aware multi-session project memory for
coding agents: a clean benchmark, fair memory baselines, ablations,
cross-project and cross-model experiments, statistical analysis, a public
artifact, and an English LaTeX paper.

## Governance correction

The first development corpus was independently red-teamed on 2026-07-22. Every
exercise exposed answer material through its public case tree, task wording,
transition, oracle, or precursor record. All early exercises and all associated
local agent runs were withdrawn before any confirmatory analysis. They are
maintainer quarantine material only and cannot appear in benchmark tables,
method selection, or the paper.

The public registry is therefore intentionally empty. This is a research
quality gate, not missing work: a benchmark has no value if the task package
already tells the agent the repair.

## What is now implemented

- A research harness for canonical and native memory tracks, bounded retrieval,
  trace-replay formation, provenance receipts, model-route classification,
  command audit, blinded action annotation, and result validation.
- Source-ledger and offline-preflight tooling for recruiting real repositories
  without treating a public issue or patch as an oracle.
- A sealed-task architecture: public case cards, a private transition and
  oracle overlay, a sealed worker patch, a fresh vault grade workspace, and
  redacted receipts.
- An explicit `development-authoring-v1` mode for deterministic maintainer
  checks. It cannot start an agent run or create an outcome row.
- KVM/worker/vault contracts and adversarial isolation preflight. The current
  workstation and VPS do not satisfy those gates, so no local result is called
  confirmatory.

## Current blockers

1. Acquire or provision a KVM-capable worker/vault runtime.
2. Build new cases with fresh ids, private transitions, safe public cards, and
   independently reviewed sanitized predecessor traces.
3. Use a provider route whose telemetry proves one actual model before running
   a comparative cohort.

## Next sequence

1. Red-team prospective cases before they receive a public id.
2. Run isolated, preregistered no-memory screening.
3. Freeze the validation/test corpus and execute the full baseline/ablation
   matrix.
4. Perform statistics, failure analysis, artifact review, and manuscript build.

The detailed protocol and evidence thresholds live in `research/PROTOCOL.md`.
