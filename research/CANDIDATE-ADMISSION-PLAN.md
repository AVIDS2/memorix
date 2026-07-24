# Real-Repository Candidate Admission Plan

Status: screening plan. No source in this document is an executable benchmark
case, a confirmatory case, or evidence that Memorix improves an agent outcome.

## Selection Principle

The first real cases must not reward a model for recalling a public GitHub
answer. They must test a narrower and more useful question: after one agent has
discovered a durable engineering constraint, can a later agent use a bounded,
freshness-aware handoff when the project has evolved?

Every proposed case must allow a capable fresh agent to inspect current source
and tests normally. If current source is sufficient, that is a valid negative
control outcome, not a case-authoring failure.

## Ranked Source Leads

### 1. Zod: durable semantic-constraint transfer

The Zod source lead is the first authoring candidate because its pinned
TypeScript environment has an offline focused test path and its library surface
contains cross-module semantics rather than one visible CLI string. A future
private transition may ask a later agent to preserve an earlier, durable
invariant while adjacent code evolves.

It is rejected if the current source and public tests uniquely reveal the
constraint, if the new transition resembles the linked public solution in
behavior or implementation, or if two independently captured precursor traces
cannot show a real handoff need.

### 2. Click: compatibility-contract handoff

Click is the second authoring candidate because its pinned Python environment
has an offline targeted test path and a library can carry user-visible
compatibility contracts across several entry points. A future private transition
may require a later agent to honor a previously established compatibility rule
without exposing that rule as an answer in the public task.

It is rejected if the task collapses into a superficial formatting change, if
the predecessor note merely repeats a public test, or if a fresh agent can
recover the full contract directly from the transfer snapshot.

### 3. urfave/cli: negative-control candidate

The Go source lead has an offline full-suite path and provides language
coverage, but its narrow CLI behavior is likely to be current-source
sufficient. It is therefore useful only as a preregistered negative or
medium-dependency control, never as the first positive-evidence case.

## Role Separation

1. A source curator verifies origin, commit, license, offline preflight, and
   benchmark-family overlap without creating a task.
2. A case author with `provenance-only-v1` access authors a new private
   post-snapshot transition and private task brief. The author does not copy a
   public issue, patch, test, or discussion into either asset.
3. At least two independent human reviewers compare the private design against
   public history, assess current-source sufficiency and predecessor dependency,
   and issue the hash-only admission receipt.
4. Separate agents capture at least two precursor traces from the same frozen
   snapshot. A worker receives only the public case and the selected condition;
   it never sees the private task, transition, oracle, or review narrative.

## Current Private-Draft State

Three external, hash-committed design drafts now exist for human review: a Zod
metadata-identity lifecycle transfer, a Click default-map precedence control,
and an urfave/cli persistent-flag source-tracking control. The latter two are
deliberately no-memory-favorable. None has reviewer findings, a public case
card, a trace, a private oracle, or an admission decision. Their source-ledger
status remains `screening`; a draft commitment is not an admission.

## Admission Gates

Before a source can move from `screening` to `admitted`, all of these must be
true:

- source-ledger audit and offline preflight pass;
- benchmark overlap is reviewed rather than assumed;
- a private post-snapshot transition commitment exists;
- `validate-admission-review` accepts a two-reviewer human receipt;
- the receipt says the transition is independently authored, not isomorphic to
  public history, and has a reviewed predecessor dependency;
- the public card, trace bundle, and private overlay each pass their own
  leakage and authoring gates.

Admission only starts private authoring. It does not grant confirmatory status:
single-model telemetry, KVM worker/vault isolation, sealed-patch transfer, and
controller-only grading remain mandatory.

## Automated Pre-Review

Before assigning either human reviewer, run `memorixbench audit-private-draft`
against the immutable source ledger, the candidate's local source cache, and
the external four-file draft bundle. It validates the ledger's offline receipt,
the source cache origin/parent/license chain, draft-file boundary, hash
commitments, and obvious path or credential leakage. Its receipt is explicitly
`automated-pre-review-only-v1`: it never changes the source status, asserts
semantic novelty, evaluates predecessor dependence, or issues an admission.

## Author-Side Surface Triage

After the private commitments were frozen, a non-decision author screen compared
only public changed-file and function-header surfaces against each draft's
declared high-level scope. It is not a replacement for either reviewer and does
not establish behavioral independence.

- Zod's linked public transition is confined to parse helpers and codec tests,
  while the draft declares registry-ID and metadata lifecycle concerns. This is
  a different declared surface, not a proof of non-isomorphism.
- Click's linked public transition touches `src/click/core.py`, the same broad
  module family likely involved in default resolution. Keep it only as a
  no-memory-favorable control unless reviewers explicitly clear structural and
  behavioral overlap.
- urfave/cli's linked public transition is confined to completion code, while
  the draft declares persistent-flag source tracking. This is a different
  declared surface, not a proof of non-isomorphism.

No candidate status, overlap label, or admission gate changes as a result of
this screen. Human reviewers must inspect the actual public history and private
design before any decision.
