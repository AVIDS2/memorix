# Confirmatory Analysis Freeze

Status: implementation and review template only. No real-repository case is
admitted, no power receipt is frozen, and no confirmatory result exists.

This document prevents a common failure mode in agent evaluation: rigorous
execution controls paired with flexible analysis after the outcomes are known.
It describes what must be fixed before a confirmatory worker sees any outcome
labels.

## What Must Be Frozen

For one agent and one provider-reported actual-model cohort, the organizers and
independent reviewers freeze all of the following together:

1. the admitted case-registry SHA-256 and exact planned
   `case x agent x model x repetition x seed` rows;
2. the primary comparison family, condition order, alpha, and Holm adjustment;
3. one conservative power receipt per primary comparison, including the
   smallest effect size that would be practically worth claiming, the
   discordance envelope, target power, and required cluster count;
4. the inclusion rule: confirmatory tier, preregistered dependency
   classification, Track C execution, and medium or high dependency only;
5. the missing-row rule, invalid-run rule, and secondary-outcome annotation
   rule; and
6. the exact version hashes of the controller, case artifacts, condition
   adapters, and model-route policy.

`memorixbench plan-conservative-power` creates a planning-only power receipt.
`memorixbench validate-analysis-plan` validates the immutable execution
manifest. The manifest refuses mixed agent/model cohorts, duplicate rows,
unplanned rows, missing rows, and invalid infrastructure rows.

## Primary And Secondary Claims

The first primary family compares canonical bounded Memorix retrieval with the
declared no-memory control and, when the frozen registry supports it, a bounded
raw-replay control. Mem0 and AgentMemory are secondary canonical baseline
comparisons, not a product ranking. A native product-surface analysis is a
separate cohort and is never pooled into the canonical primary result.

Each primary comparison reports the cluster-level absolute task-success
difference, clustered bootstrap interval, paired cluster sign-flip reference
p value, and Holm-adjusted family decision. Repetitions describe stability but
do not multiply the effective number of engineering tasks.

The practical threshold is chosen before results are read. It must not be
selected from the public Qwen pilot's +2.8-point estimate, the DeepSeek ceiling
outcome, or a favorable private run.

## Missing And Invalid Data

The initial policy is `fail-closed-v1`:

- a missing, duplicate, invalid, or unplanned primary result row invalidates
  the frozen analysis rather than becoming a success, failure, or imputed zero;
- a pending or unrateable secondary action label remains missing and is excluded
  from that secondary metric, never silently recoded; and
- after an infrastructure repair, the organizers document the repair and seek
  a new review/freeze decision before re-running the affected cohort.

This is intentionally conservative. It trades a smaller-looking result table
for an auditable rule that cannot be changed after seeing which condition won.

## Interpreting Every Sign

The study commits to release the cohort-level result regardless of sign, subject
to private-task and credential safety. For the frozen cohort only:

- a **supported benefit** requires the predeclared primary decision and an
  estimate compatible with the predeclared practical threshold;
- a **supported harm** uses the same logic in the opposite direction;
- an **inconclusive** result includes both meaningful benefit and meaningful
  harm in its uncertainty interval; and
- a **ceiling or floor** outcome is reported as non-separating for that task
  set, not converted into a general claim that memory works or fails.

No category licenses a cross-model or cross-agent claim by itself. A different
agent or actual model is an independent replication with its own frozen cohort.

## Human And Independent-System Gates

Two independent human reviewers must approve the cases and this analysis freeze
before outcome labels are read. A KVM-backed worker, trusted single-model relay,
separate runtime attestation signer, and sealed private oracle remain required
for execution. Local Claude Code, Pi, Codex, and model critiques are useful
engineering diagnostics only; they do not satisfy either gate.
