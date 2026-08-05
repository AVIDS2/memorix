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
   concepts used to form the native-memory record; and
8. for source-backed cases, the immutable transfer commit, source archive
   digest, archive top-level directory, archive-to-tree integrity check,
   source-tree digest, and the private oracle manifest's executable asset
   digests.

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

### Current Exploratory Admission Record

On 2026-08-04, the project owner reported that two non-owner, outcome-blind
reviewers examined the three source-backed candidates and found no admission
blocker. An external, anonymous ledger records only the count, date, scope, and
case-level exploratory decisions; it contains no personal information, private
oracle material, or model outcome. Individual signed forms and rationales were
not retained. This permits an explicitly labeled exploratory cohort only. A
confirmatory corpus still requires independently retained forms, the full
rubric, and a frozen manifest signed before any outcome is collected.

On 2026-08-05, two non-owner, outcome-blind human reviewers completed retained
structured forms for the nine P3 packets. Their answers were transcribed into
the fixed JSON schema as clerical formatting only; the transcription aid was
not a reviewer, and the original free-form transcriptions remain outside Git.
Seven packets reached consensus admission. The reviewers identified task
wording in two durable-decision candidates that disclosed policy-level
information which should instead come from the predecessor record. Before any
model outcome was accessed, those two tasks were replaced in a versioned packet
set; the unchanged packets and forms are byte-identical. The two replacement
packets require a fresh independent review from both reviewers before the
complete nine-case set can be audited or frozen.

### Outcome-Blind Review Packet

The classification reviewers receive the candidate ID, source provenance and
license, transfer-base commit, task, predecessor record, proposed class, and
the relevant current-source files. They do **not** receive model receipts,
aggregate outcomes, private-oracle code or paths, baseline/reference pass
results, or a reference repair. Their form records:

1. the proposed class and an independently selected class;
2. whether the current source provides a recoverable reason to accept, ignore,
   or reject the predecessor record;
3. whether the task or supplied record leaks a patch-shaped answer;
4. whether provenance, license, source boundary, and writable scope are
   adequate; and
5. `admit`, `revise`, or `reject`, with a short rationale.

An oracle auditor may separately inspect the private verifier and reference
repair for determinism and leakage, but must not disclose their contents to
classification reviewers or the model worker. The owner records only the
admission decision and sanitized rationale in a shareable ledger; review forms,
private oracles, and raw outcome artifacts remain external.

Before a condition-effect cohort, run a separate non-comparative action
calibration with the same model route, ordinary tool surface, and repair-loop
contract. It must show that the worker can request a permitted source edit and
that agent-requested verification is distinguishable from the controller's
final oracle check. If this calibration fails, retain it as a runner/contract
finding and do not collect a matched memory comparison yet.

Before any live source-backed cohort, independently verify the frozen route
manifest against the provider. The manifest must pin requested and expected
actual model IDs, provider timeout, output cap, aggregate cost cap, temperature
zero, and automatic tool choice. A model substitution, missing provider usage,
or route-budget breach invalidates a row rather than becoming an outcome.

## Exclusion Rules

Reject a case when any of the following holds:

- the transfer task can be solved from an exposed private test, oracle path, or
  reference patch;
- a condition has different current-code, writable-path, or verification
  capability;
- the task prompt names the expected implementation rather than the engineering
  goal;
- source provenance or license is unclear;
- the declared source commit, archive digest, archive-to-tree integrity,
  source-tree digest, or private oracle executable-asset digest cannot be
  revalidated;
- the predecessor record is merely a copy of the final repair; or
- the declared precursor metadata cannot be validated against the transfer
  source tree; or
- the expected behavior cannot be checked deterministically.

## Evidence Tiers

`synthetic-engineering-smoke` cases verify the runner but do not establish an
effect. `exploratory-source-backed` cases can reveal failure modes after the
rubric is applied. Only a frozen, independently reviewed, private-oracle corpus
may be called confirmatory.
