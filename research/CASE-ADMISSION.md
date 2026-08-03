# Case Admission Rubric

This rubric is used before an outcome is collected. It separates an interesting
story about memory from a case that can support a later comparison.

## Required Case Card

Every admitted case records, outside the agent-visible checkout:

1. provenance and license of the source snapshot, or that the transition was
   newly authored;
2. the precursor fact, the repository evolution, and the transfer task;
3. the case class selected before runs;
4. why the current snapshot does or does not reveal the decisive behavior;
5. the private oracle's pass criteria and a reference repair; and
6. the case-defined evidence-size cap and writable-path policy; and
7. the precursor observation type, relevant source-relative files, and
   concepts used to form the native-memory record.

The committed public case card may describe the seed and task, but never the
private oracle, reference repair, raw session transcript, or local artifact
path.

## Class Rubric

### Source-Sufficient Control

Admit only when the current source, visible documentation, and ordinary focused
verification contain enough information for the transfer task. The predecessor
record may be irrelevant or redundant, but must not be the sole source of a
hidden requirement. This class tests whether memory adds cost without a needed
information gap.

### Durable-Decision Dependency

Admit only when a concrete predecessor decision resolves a genuine ambiguity
that the current snapshot does not settle cheaply. The record must state the
decision, but it must not paste the entire reference patch or private test.
At least one plausible source-only implementation must differ from the
predecessor decision, otherwise the case is source-sufficient instead.

### Stale-Conflict

Admit only when predecessor information would have been correct before an
intervening change but now conflicts with an authoritative current source
signal. The current snapshot must provide a recoverable reason to reject the
old advice. The private oracle checks behavior, not merely whether an agent
mentions that the record was stale.

## Review And Decision

Two reviewers independently apply the rubric before outcomes are read. Each
marks `admit`, `revise`, or `reject` and records a one-paragraph rationale.
Disagreement is resolved by a third reviewer or by excluding the case. For the
confirmatory tier, reviewers must not see condition outcomes and must sign the
frozen case manifest before any run begins.

## Exclusion Rules

Reject a case when any of the following holds:

- the transfer task can be solved from an exposed private test, oracle path, or
  reference patch;
- a condition has different current-code, writable-path, or verification
  capability;
- the task prompt names the expected implementation rather than the engineering
  goal;
- source provenance or license is unclear;
- the predecessor record is merely a copy of the final repair; or
- the declared precursor metadata cannot be validated against the transfer
  source tree; or
- the expected behavior cannot be checked deterministically.

## Evidence Tiers

`synthetic-engineering-smoke` cases verify the runner but do not establish an
effect. `exploratory-source-backed` cases can reveal failure modes after the
rubric is applied. Only a frozen, independently reviewed, private-oracle corpus
may be called confirmatory.
