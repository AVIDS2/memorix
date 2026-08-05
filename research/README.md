# MemorixBench

MemorixBench is the research track for a simple but unsettled question:

> When does project memory help a fresh coding agent, and when does it add
> stale context or cost without improving the patch?

The answer cannot be inferred from retrieval accuracy alone. A capable agent
can often recover the needed state from the current checkout and focused tests.
Conversely, a later task can depend on a durable decision that current code no
longer explains. The study therefore treats memory as an intervention with
possible benefit, no effect, or harm.

## What this is and is not

This directory is a research artifact, not a product benchmark claim. It does
not claim that Memorix generally improves coding agents, outranks other memory
systems, or replaces normal code inspection.

The current production system is Memorix `1.4.1`. The committed public summaries
are an archived pilot from an earlier `1.2.1` build. They are retained because
they are honest, reproducible negative or inconclusive observations; they are
not evidence about `1.4.1` performance.

## Study design

Every matched trial gives the agent the same current repository, task, model
route, timeout, editable files, and ordinary inspection and verification tools.
Only predecessor evidence changes:

| Condition | What the fresh agent receives before work begins |
| --- | --- |
| `no-memory` | No predecessor evidence. It can still inspect and test the current checkout normally. |
| `raw-record` | One explicit read of a fixed, bounded record from the preceding session. |
| `memorix-native` | The normal bounded Memorix project-context brief plus one cited memory-detail expansion, without research-only MCP parameters. |

The primary question is not whether memory can repeat facts. It is whether the
agent produces a correct tested change with less error or useful extra work
when predecessor information truly matters. Model capability is a moderator:
a stronger model may need less memory on source-sufficient tasks, while still
benefiting from a durable decision that source cannot reconstruct cheaply.

## Evidence tiers

1. **Implementation checks** verify product behavior and the experiment runner.
   They do not establish an agent-performance effect.
2. **Archived public pilot** contains the earlier public-fixture observations
   under `public-summary/`. It is descriptive only and is deliberately not
   pooled with new results.
3. **Exploratory sealed-local trials** use a bounded local tool surface and an
   oracle outside the agent-visible checkout. They prove the experimental path
   works and can reveal failure modes, but remain exploratory.
4. **Confirmatory study** requires preregistered real-repository cases, frozen
   model routes, independently reviewed case admission, and a reviewable
   private oracle. Only this tier can support a general effect claim.

## Layout

- `PROTOCOL.md` defines the question, controls, outcomes, and claim boundaries.
- `CLAIMS.md` lists claims that are currently unproven and their required evidence.
- `EVIDENCE-STATUS.md` distinguishes observed evidence from design work.
- `CASE-ADMISSION.md` defines how a case is classified and admitted before
  outcomes are collected.
- `CASE-REVIEW-FORM.md` is the outcome-blind independent-review form used for
  P3 admission.
- `ANALYSIS-PLAN.md` fixes the P3/P4 matrix, budget, denominator, and claim
  boundary before new source-backed outcomes are inspected.
- `bench/` can audit review forms, freeze all approved inputs into an immutable
  cohort receipt, run only the resulting deterministic schedule, and aggregate
  only a complete receipt-verified cohort.
- `LITERATURE.md` maps the work to adjacent memory and software-agent research.
- `paper-icse-nier/` holds the anonymous NIER candidate source.
- `public-summary/` and `public-cohort-plans/` preserve the earlier public pilot
  without relabeling it as current-product evidence.

## Privacy and release boundary

Raw prompts, model responses, private transitions, hidden tests, credentials,
local paths, and one-off trial artifacts stay outside Git. The parent
repository's `ACTIVE_WORK.md` is the single active status document. This folder
contains stable protocol, code, and sanitized evidence only.

## Current next step

Nine external, permissively licensed candidate cases now cover the
source-sufficient, durable-decision, and stale-conflict hypotheses. Each has
passed a sealed Docker no-model audit where the baseline fails and a private
reference repair passes. None is admitted yet. The fixed post-client-fix
transport windows passed for glm-5.2 and deepseek-v4-pro. Kimi K2.7 Code
failed its whole fixed window and is excluded from this cohort; its earlier
passing and failed diagnostics remain in the artifact ledger. The two stable
routes passed current-runner Docker action calibrations with source edits and
agent-requested verification; freeze now verifies and binds one explicitly
labeled calibration receipt for each route.

Next, obtain two independent outcome-blind reviews under
CASE-REVIEW-FORM.md and audit their consensus. The current-runner action
calibrations for the two stable routes are already complete. Then freeze the
case list, routes, analysis plan, and budget before complete matched
exploratory rows run without discarding failures. Every resulting run remains
exploratory until the separate confirmatory gate is satisfied.
