# MemorixBench P3 Analysis Plan

**Protocol:** 2.0-draft
**Status:** draft. It becomes frozen only after the P3 admission and route gates
listed below are satisfied. No source-backed model outcome has been collected
under this plan.

This document is a stable analysis contract, not a second status log. Current
progress and any later frozen decision belong in the repository-level
ACTIVE_WORK.md.

## Why This Exists

The study is not trying to prove that agents always need memory. A capable
agent can often recover the answer from current code. The question is narrower:
when a fresh coding agent faces a later task, does predecessor evidence help,
add no value, or steer it toward a stale decision?

The rules below are written before the candidate outcome matrix exists. They
prevent changing the question, denominator, or budget after seeing a favorable
result.

## P3 Freeze Gates

The P4 matrix may begin only when every item is recorded in the ignored
research artifact boundary:

1. Two independent, non-owner, outcome-blind reviewers have completed one
   valid form per candidate case using CASE-REVIEW-FORM.md. A disagreement
   requires a third review or case exclusion. If exclusion breaks the planned
   class balance, a replacement case is admitted before the cohort freezes.
2. Every admitted case has a current sealed-input audit: baseline fails, private
   reference repair passes, public provenance/license/source scope validates,
   and no private oracle material is agent visible.
3. Every route has a fixed three-probe direct non-task transport window after
   the final client code is in place. Every probe must report the route-file
   actual model ID and usage fields; one failure excludes the route from this
   cohort. Earlier transient failed qualifications remain in the artifact
   ledger and are not erased.
4. Every route has a separate action calibration using the same Docker worker,
   ordinary tool surface, repair-loop contract, and route parameters. These
   calibrations are non-cohort and are never pooled with the P4 outcomes.
5. The case-card hashes, oracle-asset hashes, reviewer-form hashes, route-file
   hashes, Docker image ID, runner source-tree hash, matrix parameters, and
   condition-order seed are placed in one immutable cohort receipt before the
   first P4 result is inspected.

## Proposed Core Matrix

This is the complete first exploratory matrix, not a cherry-picked sample:

| Dimension | Frozen candidate value |
| --- | --- |
| Cases | Nine admitted external source-backed cases: three source-sufficient controls, three durable-decision dependencies, three stale-conflict cases. |
| Routes | OpenCode Go glm-5.2 and deepseek-v4-pro. Kimi K2.7 Code is excluded from this cohort after failing its fixed P3 route window. |
| Conditions | no-memory, raw-record, memorix-native. |
| Repetitions | Three independent service calls for every case, route, and condition. |
| Primary surface | canonical-information with fixed-index evidence delivery. |
| Agent loop | 24 maximum turns; every route uses temperature zero, automatic tool choice, a 60-second provider timeout, and the common repair-loop contract. |
| Per-row output cap | 1,024 tokens per model response. |
| Per-row aggregate cap | 160,000 input-plus-output tokens across all model turns. |
| Planned rows | 9 cases x 2 routes x 3 conditions x 3 repetitions = 162 rows. |
| Maximum token ceiling | 25,920,000 aggregate tokens for the entire planned matrix. This is a safety ceiling, not an expected spend. |

The real native-product surface is deliberately outside this primary matrix. It
is a later end-to-end product-experience cohort. It must never be mixed with
the canonical-information result as though the two exposed identical tools or
text.

The post-client-fix fixed windows passed 3/3 for glm-5.2 and deepseek-v4-pro.
Kimi produced five historical retained HTTP 400 non-task qualification failures,
then failed all three probes in its fixed window. It is excluded from this
cohort rather than selecting a favorable individual receipt. Any historical
action calibration remains in the artifact ledger, but cohort freeze accepts
only one explicitly labeled Docker action-calibration receipt per retained route
whose runner-source hash matches the final frozen runner.

## Execution Order And Stops

The unit that is scheduled together is one matched triad: one route, one case,
one repetition, and all three conditions. Condition order is precomputed after
freeze by sorting the SHA-256 values of this string:

    cohort_id | route_id | case_id | repetition | condition

That makes the order deterministic and prevents manually running all
no-memory rows first or retrying a treatment that looked weak. A row runs once.
An invalid row, timeout, provider failure, or task failure is retained. It is
not rerun under the same frozen cohort.

The controller pauses the cohort only for an infrastructure incident, such as
an unavailable Docker worker, a provider-wide outage, missing usage, route
substitution, or more than 20 percent invalid rows for a route. The pause
creates a documented new cohort version after diagnosis; it does not silently
replace the earlier rows.

## Outcomes And Denominators

The primary outcome is deterministic private-oracle pass after the agent
finishes. A valid row has a complete receipt, matching route/model identity,
valid usage fields, no cap violation, matching source/oracle hashes, and equal
tool-policy conditions.

For each route and case class, the primary descriptive contrast is:

    mean_success(memorix-native) - mean_success(no-memory)

where mean_success is first averaged across the three repetitions for each
case. This keeps three service calls from being misrepresented as three
independent repositories. Raw-record versus memorix-native is a planned
secondary contrast. All three classes are shown separately; there is no single
headline average that hides a benefit on one class and harm on another.

Secondary measures are reported beside correctness, never folded into it:

- total input and output tokens;
- elapsed time and ordinary/evidence tool-call counts;
- provider request-price telemetry, clearly labeled non-invoice for Go;
- agent-requested verification behavior and termination reason;
- first verified useful action only when its private rubric was fixed before
  collection; and
- stale-action rate only for cases whose stale action label was fixed in the
  private oracle material before collection.

Rows with infrastructure or protocol invalidity are excluded from the
effectiveness denominator but reported in a complete invalidity table by route,
case, condition, and reason. A matched triad with any invalid member is not
used for a paired contrast. A case whose rows all make no edit is retained as a
non-discriminative action calibration and is not used to claim a memory effect.

## Analysis Method

The nine-case corpus is intentionally small. The first paper reports
case-stratified descriptive effects and complete uncertainty, not a sweeping
claim of statistical proof.

For every route and class, analysis will report:

1. all raw row counts, valid/invalid counts, and private-oracle pass counts;
2. case-level repetition means for each condition;
3. paired case-level differences for the two planned contrasts;
4. medians and full ranges for token, time, and tool-use measures; and
5. a cluster bootstrap interval that resamples cases, with repetitions kept
   inside a selected case cluster.

The bootstrap is an uncertainty description, not a license to call a
three-case stratum statistically conclusive. No post-hoc route pooling,
case-class merging, outcome-based row removal, or significance-driven model
labeling is permitted. Any exploratory regression or route-by-class interaction
is explicitly labeled hypothesis-generating.

## Claim Limit

Even if the planned matrix is complete, it may support only wording such as:

> Within this sealed nine-case exploratory cohort, under the recorded routes
> and bounded tool surface, Memorix predecessor context was associated with
> these correctness, cost, and stale-action patterns.

It may not claim general superiority over AgentMemory, Mem0, Cognee, Claude
Code, Codex, any vendor model, or no memory in general. A broader claim requires
a later held-out corpus, stronger independent review, and a separately frozen
confirmatory plan.

## Privacy And Artifact Boundary

Route files, reviewer forms, private oracle assets, receipts, evidence
sidecars, and execution logs are stored below research/artifacts and ignored by
Git. The supplement will be materialized later from an explicit allowlist.
Raw model prose, credentials, reviewer names, local paths, and private oracle
code do not enter this repository or the anonymous paper.
