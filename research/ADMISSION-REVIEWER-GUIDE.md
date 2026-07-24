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
private task brief, and private public-history comparison. Decide all four
questions separately:

1. Is the proposed transition newly authored rather than a restatement of a
   public solution?
2. Is it not structurally or behaviorally isomorphic to the public solution?
3. Does the later task genuinely depend on information a precursor could have
   learned?
4. Could a capable fresh agent recover the full answer from the current source
   and public tests alone?

The last question may legitimately reject a proposed positive case. A
current-source-sufficient task is useful only when explicitly designed as a
negative control.

## Record The Receipt

For an approval, each reviewer independently lists all four required finding
codes in their own `reviewer_attestations` row. The top-level `findings` list
must be exactly the union of these rows. Use only reviewer pseudonyms and
finding codes in the public receipt; keep any detailed private rationale with
the review organizer rather than the repository.

The validator checks receipt shape, reviewer/author separation, committed
source identity, and the per-reviewer attestation coverage. It cannot verify
that someone read carefully, prove semantic novelty, or replace human
judgment. A valid approval only permits further case authoring; it does not
admit a confirmatory experiment.
