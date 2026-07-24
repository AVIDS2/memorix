# Public Cross-Model Replication Contract

Status: frozen before any `deepseek/deepseek-v4-flash` cohort outcome is read.
This is a post-result independent-model replication of the first public Qwen
cohort, not a hidden addition to that cohort's original primary family.

## Purpose

The first public result is limited to one Qwen model. This replication asks a
narrower question: on the same frozen public cases and controlled tool surface,
does the direction and boundary of canonical Memorix versus no memory look
materially different for one independently selected provider-reported model?

The route was selected before this plan was written by a one-case no-memory
preflight that recorded exactly `deepseek/deepseek-v4-flash` in provider
telemetry. That preflight is a route/readiness receipt only and is excluded
from this matrix and all aggregate outcomes.

## Frozen Matrix

- 12 existing `public-reproducible` cases from the same registry;
- `no-memory` and `memorix-1.2.1-canonical-local` only;
- three fixed `(repetition, seed)` pairs: `(1, 101)`, `(2, 202)`, and `(3, 303)`;
- exact model `deepseek/deepseek-v4-flash` reported by the provider for every
  accepted row;
- the same bounded OpenRouter tool policy, writable roots, timeout, cost ceiling,
  registry hash, and case/oracle hashes as the original public cohort.

This creates 72 planned rows. Mem0 and AgentMemory are not rerun in this
replication because its purpose is model robustness of the already declared
canonical Memorix/no-memory contrast, not a new multi-baseline leader board.

## Analysis Boundary

The plan freezes its own primary contrast and analysis procedure before its
outcomes. It uses the same case-clustered pairing and descriptive bootstrap/
sign-flip summaries as the initial public study. It is reported as a separate
model cohort and is never pooled with Qwen rows to manufacture a larger sample.

Its result, whether favorable, null, or unfavorable, cannot establish
confirmatory efficacy, pretraining novelty, or generalization across models.
It only strengthens or weakens the limited claim that a result did not depend
entirely on one exact provider-reported model under this public fixture setup.
