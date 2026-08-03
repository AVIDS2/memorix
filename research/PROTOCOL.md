# MemorixBench Protocol

**Protocol version:** 1.0-draft

**Target system:** Memorix 1.4.1
**Status:** exploratory protocol; deterministic contracts and matched synthetic
engineering matrices under both evidence-surface profiles have passed, but no
confirmatory outcome has been collected

## Research question

For cross-session code-evolution tasks, how do task dependency, memory
freshness, and model capability change the benefit or harm of project memory?

The study starts from a deliberately strong control. A fresh `no-memory` agent
receives the same evolved source tree, ordinary repository tools, test budget,
and model route as a memory-enabled agent. It may solve the task by reading
current code. That is a valid outcome, not a failure of the control.

## Unit of study

A case has three stages:

1. A precursor session establishes a durable decision, observation, or
   workflow fact.
2. The repository advances to a transfer snapshot.
3. A fresh agent implements a later task in that transfer snapshot.

Cases are classified before runs as one of:

- **source-sufficient control:** current code and tests should be enough;
- **durable-decision dependency:** a prior decision should materially reduce
  ambiguity; or
- **stale-conflict case:** older information conflicts with current source or
  a later decision.

The classification is a hypothesis about task structure, not an outcome label.

## Matched conditions

Each case/model/repetition uses the same source snapshot, task prompt, writable
paths, bounded tools, timeout, verification command, and maximum spend.

| ID | Intervention |
| --- | --- |
| `no-memory` | Task plus current checkout only. |
| `raw-record` | One explicit read of a fixed predecessor record. |
| `memorix-native` | A normal read-only Memorix project-context call plus one cited memory-detail expansion. |

Every memory-providing condition uses the same case-defined evidence-size cap.
This controls maximum rendered evidence, while provider-reported input tokens
remain a separate recorded outcome because routes can tokenize the same text
differently. `raw-record` and `memorix-native` both require an explicit tool
call; the latter is progressive disclosure, where one bounded brief can name a
memory and the agent may expand one cited detail. It must not expose
research-only product switches. Any internal ablation belongs in a research-side
renderer and must be reported as an exploratory mechanism probe, never as
product behavior.

Two evidence-surface profiles answer different questions:

- **native-product:** expose the real condition-specific tool surface and
  measure total product experience, including the cost of tool definitions;
- **canonical-information:** give every condition the same neutral predecessor
  index/detail tools, with no evidence, a raw record, or the real Memorix
  backend respectively. This profile isolates predecessor information from
  tool-schema availability.

Neither profile may be substituted for the other in analysis. Three synthetic
cases have completed all three conditions under each profile. In the matched
`canonical-information` matrix, even the synthetic durable-decision case was
solved by the no-memory condition through additional ordinary exploration. That
is an expected warning that a runner smoke is not a causal result. Future causal
claims require the `canonical-information` profile on admitted source-backed
cases as well.

## Model capability as a moderator

Models are grouped into frozen capability tiers only after route verification.
No result pools different actual provider-reported model IDs. The analysis asks
whether condition effects differ by tier and case class; it does not assert
that a model is globally "strong" or "weak" from a vendor label alone.

The expected boundary is conditional:

- source-sufficient controls may show no benefit and reveal context cost;
- durable-decision cases may benefit from compact, relevant predecessor evidence;
- stale-conflict cases may reveal whether evidence selection causes harmful
  actions or is ignored in favor of current code.

These are hypotheses, not expected results.

## Outcomes

The primary outcome is a deterministic private-oracle pass after the agent
finishes. Secondary outcomes stay separate from correctness:

- elapsed time, input/output tokens, provider cost, and tool-call count;
- first verified useful action, when an action rubric can be independently
  labeled; and
- stale-action rate, only when the case has a predeclared private label.

An adapter error, leaked workspace, mixed model route, missing receipt, or
unequal tool policy invalidates a matched row. It is never converted into a
task failure for one condition.

## Exploratory sealed-local execution

The first operational tier uses a local controller with these boundaries:

- the agent sees only the transfer checkout through list, read, write, and
  trusted-test tools;
- it has no shell, host filesystem, network, process, or oracle-file tool;
- private tests and expected behavior remain outside the checkout;
- each condition starts from a new materialized tree and fresh memory store;
- routes, prompts, supplied predecessor evidence, edits, tool calls, and test
  results are written into an external ignored artifact directory; and
- all rows are marked `exploratory-sealed-local`, including failures.

This is a useful engineering and methodology gate, not an independent sandbox
or a confirmatory result tier. Matched synthetic all-condition matrices have
exercised both evidence-surface profiles; they are not entered into an efficacy
comparison. The tier cannot establish a general Memorix effect.

## Confirmatory gate

A result may be upgraded only after all of the following are true:

1. Cases come from permissively licensed sources or newly authored transitions
   with documented provenance.
2. Case admission and dependency classification are independently reviewed
   before outcome collection.
3. The oracle is private and separately auditable from the agent worker.
4. Model routes, analysis plan, case list, and sample target are frozen before
   reading outcome labels.
5. All valid, invalid, timed-out, and failed rows are retained and reported.

Until then, paper wording must say "exploratory" or "descriptive" and must not
claim a broad performance advantage.
