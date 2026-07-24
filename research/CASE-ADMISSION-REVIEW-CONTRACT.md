# Independent Case Admission Review

A source ledger proves where a repository snapshot came from. It cannot prove
that a benchmark-authored private transition is meaningfully different from a
public issue or pull request, nor that a case author merely assumed memory was
needed. This contract adds a human review gate before a source can become an
admitted development or confirmatory case.

## What Is Public

The public receipt records only immutable source identifiers, hashes of the
private transition, private task brief, and private public-history comparison,
two or more reviewer pseudonyms, a human-review declaration, finding codes,
each reviewer's non-narrative attestation and private-worksheet hash, the
decision, and timestamp. It
contains no private task text, hidden test, reference patch, public PR excerpt,
or reviewer narrative.

## Required Roles

- The author records a `provenance-only-v1` disclosure: public history was used
  to establish source provenance, not to copy a solution into the new task.
- At least two independent human reviewers, distinct from the author, inspect
  the private task brief and a private comparison against the public history.
- An approved receipt must confirm four things: the transition is newly
  authored, it is not behaviorally or structurally isomorphic to a public
  solution, the proposed predecessor dependency is real, and current-source
  sufficiency has been considered rather than assumed away.
- Each reviewer independently attests all four finding codes and binds a
  private worksheet SHA-256. The receipt's aggregate `findings` field must
  equal the union of those individual attestations. This provides an auditable
  accountability boundary, not proof that a reviewer read material carefully
  or that a task is novel.

This is an accountability control, not a magical proof of what a person has
ever read or what a model saw in training. The study discloses that limit.

## Enforcement

`memorixbench validate-admission-review` validates a receipt against its
immutable source-ledger candidate. A source entry marked `admitted` must bind a
valid approved receipt through `admission_review_path` and
`admission_review_sha256`; `memorixbench validate-source-ledger` rejects the
entry otherwise.

Before asking reviewers to inspect private material, use
`memorixbench build-admission-review-draft <ledger> <candidate-id>` with the
three private files and a new external output path. It records only their
SHA-256 commitments plus immutable candidate identity, and produces an
intentionally incomplete receipt template. Human reviewers must supply their
own identities, finding codes, decision, and timestamp; a draft cannot pass
`validate-admission-review` or admit a source.

An approval only allows authoring to proceed. It does not make a case
confirmatory: the registry, private-oracle, independent trace, single-model,
and KVM worker/vault gates still apply.

The current receipt schema is `case-admission-review-v3`. Existing unapproved
v1 or v2 drafts should be regenerated from the unchanged three private files before
review; doing so changes only the public hash-only template, not the private
task or transition commitments. Use
`REVIEWER-HANDOFF-PACKET-CONTRACT.md` to build an external private packet,
calibrate reviewers, and validate the worksheet-to-receipt binding.

At the future confirmatory permit boundary, the controller reloads the source
ledger and this review. It requires the reviewed repository/base to match the
public case and the reviewed private-transition commitment to equal the case's
private-transition commitment. A review of one private transition cannot be
reused after that transition is replaced.
