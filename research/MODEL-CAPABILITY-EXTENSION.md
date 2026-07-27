# Model Capability Extension

Status: proposed future preregistered study. This document is a research
decision and design boundary, not a result, a current product claim, or a
revision of the MemorixBench-Transfer primary analysis.

## Decision

The current MemorixBench-Transfer paper remains a protocol and reproducibility
study of freshness-aware project memory under code evolution. Within a frozen
cohort, it asks when bounded project memory helps or harms a fresh coding agent
relative to matched current-code access.

Model capability is important, but the current public cohorts cannot estimate
it: their model-agent configurations, task matrices, and evidence tiers differ,
and the protocol deliberately reports them as independent replications. This
extension reserves model capability as a separate, preregistered moderation
question rather than retrofitting an explanation after results are observed.

## Plain-Language Question

Different students may use the same study notes differently. A capable student
may reconstruct a small current project from source and tests alone. Another
student may benefit more from reliable notes, while also being more likely to
trust a note that has become obsolete. This study asks when that difference is
observable in coding agents without depriving any condition of ordinary access
to the current repository.

It does not ask whether a model is inherently "smart" or "weak," and it does
not assume that more memory is better. It asks whether a pre-measured
model-agent configuration changes the effect of a particular memory delivery
condition on a particular class of task.

## Research Question

Under preregistered repository evolution and task strata, does calibrated
current-source recovery capability moderate the effect of bounded,
freshness-aware project memory on task success, observable stale-conflict
actions, time to first correct action, and context cost?

The target claim is conditional: within the frozen configurations, task
distribution, and budgets, capability may be associated with a different memory
effect. It is not a universal claim that low-capability models need memory,
high-capability models do not need memory, or freshness is sufficient to remove
harm.

## Capability Calibration

Capability is a property of a pinned model-agent configuration, not a vendor
name, parameter count, or benchmark marketing label. Before target outcomes are
read, each configuration must run a separate held-out calibration set with:

- no predecessor memory;
- the same agent client, system instructions, tool permissions, timeout, and
  token budget intended for the target study;
- repositories and task families that do not overlap with the target set; and
- hidden correctness oracles.

The frozen calibration receipt records task success, time to first correct
action, and exploration efficiency with uncertainty. It provides a declared
capability score or stratum for analysis; it does not convert a model into a
single timeless intelligence rank.

## Minimum Experimental Design

The smallest informative design is a paired factorial study:

| Factor | Minimum levels | Purpose |
| --- | --- | --- |
| Memory condition | `no-memory`, canonical bounded Memorix | Estimate the core memory effect |
| Model-agent configuration | `K` independently calibrated configurations | Estimate moderation without relying on marketing labels |
| Task stratum | current-source-sufficient, medium/high-dependency stale transfer | Separate tasks where history should not matter from tasks where it may |

Every `case x configuration` pair receives both core memory conditions with the
same current repository, task prompt, ordinary source/test tools, timeout, and
budget. The stale-conflict subset also needs a preregistered
freshness-withheld comparison; otherwise a failure cannot be attributed to
obsolete guidance rather than ordinary task difficulty.

`K` and the case count must come from a frozen power plan. Three configurations
can establish feasibility, but cannot support a general capability curve. More
repetitions estimate run stability; they do not create independent capability
levels.

## Analysis Boundary

Report the paired memory effect for each configuration first. Only then fit the
preregistered interaction model, with case and repository structure retained.
The analysis must distinguish:

- supported benefit;
- supported harm;
- a non-separating ceiling or floor outcome; and
- an inconclusive interval that admits both meaningful benefit and harm.

No result may be pooled across different configurations as though their runs are
additional independent repositories. Any model-route, tool-policy, client, or
prompt difference is part of the configuration and must be archived.

## What This Study Does Not Explain

A black-box coding-agent study can measure behavior and outcome differences. It
cannot establish why a proprietary model trusted a memory, prove an attention
mechanism, or rule out opaque provider state.

Claims about Transformer attention, KV cache behavior, or internal mechanism
require a separate white-box study on accessible-weight models with fixed
decoding and causal interventions such as token replacement or activation
patching. Attention visualizations alone are not mechanism evidence. That work
is intentionally outside this extension and the current MemorixBench paper.

## Entry Criteria

This extension may move from proposal to execution only after:

1. the calibration and target registries are independently reviewed and frozen;
2. the capability score, interaction model, power envelope, and missing-data
   policy are fixed before target outcomes are read;
3. each condition has matched current-code permissions and a clean isolated
   workspace; and
4. results are released regardless of whether memory helps, harms, or does not
   separate from no memory.

## Relationship to Existing Documents

- `PROTOCOL.md` remains the authority for the current paper's primary claims.
- `CLAIMS.md` prevents this proposal from being presented as current evidence.
- `EVIDENCE-STATUS.md` remains the public description of what existing cohorts
  do and do not establish.
