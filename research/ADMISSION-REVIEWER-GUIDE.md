# Admission Reviewer Guide

This guide is for the two or more independent human reviewers who decide
whether a screened real-repository source may become a development case. It is
not an experiment instruction, a source-admission result, or evidence that
Memorix improves an agent outcome.

## What To Receive

The case curator supplies the immutable source identifiers, the three committed
private files, and the hash-only admission-review draft. Reviewers should use a
fresh local copy of the pinned repository. They must not rely on a public issue
answer, a public repair patch, an existing benchmark task, or the author for an
unstated solution detail.

## Review Independently

Before seeing another reviewer's decision, inspect the private transition,
private task brief, private public-history comparison, and the public-history
dossier. Decide all four questions separately:

1. **Newly authored:** is the private transition a new post-snapshot change,
   rather than a restatement of an issue, public test, release note, or patch?
2. **Not isomorphic:** does it avoid the same observable defect, intended
   behavior, patch strategy, and causal path as the linked public solution?
   A different filename alone is not enough.
3. **Real predecessor dependency:** if the precursor's discovered constraint is
   removed, would a capable later agent lose information that current source and
   public tests do not reveal? Faster search alone is not enough.
4. **Current-source sufficiency:** could a capable fresh agent recover the full
   answer from the current source and public tests alone? If yes, reject the
   proposed positive case or label it a future negative-control candidate.

The public-history dossier is a list of public context, not an automated
novelty verdict. Do not treat a path-overlap count, an embedding score, or an
AI critique as an answer to any of these questions.

## Private Worksheet

Complete a private worksheet before exchanging views with any other reviewer.
It contains three clear rubric-calibration cards and an affirmed or
not-affirmed verdict, confidence, and private rationale for each required
finding. The calibration cards establish that the reviewers use the same basic
meaning for source-sufficient, predecessor-dependent, and needs-redraft; they
do not prove that the real candidate is valid.

Keep the worksheet and its rationale with the review organizer. Do not paste
private task text, hidden tests, public-patch excerpts, or detailed reasoning
into a public receipt.

## Record The Receipt

For an approval, each reviewer independently lists all four required finding
codes and their private worksheet SHA-256 in their own
`reviewer_attestations` row. The top-level `findings` list must be exactly the
union of these rows. Use only reviewer pseudonyms, finding codes, and worksheet
hashes in the public receipt.

The current receipt schema is `case-admission-review-v3`. The organizer runs
the worksheet-binding validator before publishing a receipt. An approval
requires both worksheets to affirm all four findings at at least medium
confidence. Any disagreement, low-confidence finding, or source-sufficient
judgment means no approval; reject the candidate or start a new review after a
materially new private design is authored.

The validator checks receipt shape, reviewer/author separation, committed
source identity, worksheet bindings, and per-reviewer coverage. It cannot
verify that someone read carefully, prove semantic novelty, or replace human
judgment. A valid approval only permits further case authoring; it does not
admit a confirmatory experiment.
