# Automated Pre-Admission Audit

`memorixbench audit-private-draft` is a mechanical preparation gate for a
private real-repository design draft. It makes the review packet trustworthy
without pretending that an automated text scan is a substitute for independent
judgment.

The command takes a screening source candidate, its local Git cache, and an
external draft directory containing exactly these regular UTF-8 files:

- `ADMISSION-REVIEW-DRAFT.json`
- `PRIVATE-TRANSITION.md`
- `PRIVATE-TASK-BRIEF.md`
- `PUBLIC-HISTORY-COMPARISON.md`

It verifies the source ledger and its bound offline-preflight receipt, audits
the cache's origin, first-parent base, and license bytes, validates the
hash-only review template, recomputes all three private-file commitments, and
rejects links, reparse points, unexpected files, absolute host paths, and
credential-like text. The emitted receipt contains only immutable identifiers,
hashes, public source-audit fields, and remaining gates; it never contains the
private transition, task, comparison narrative, test, or reference repair.

Example:

```powershell
uv run memorixbench audit-private-draft cases/CANDIDATE-SOURCES.toml <candidate-id> `
  --draft-root <external-private-draft-root> `
  --repository-cache <pinned-local-source-cache> `
  --output <external-artifact-root>\pre-admission-audit.json
```

Every successful receipt says `audit_kind = automated-pre-review-only-v1` and
`admission_decision = not-issued`. It cannot establish that a task is novel,
not isomorphic to public history, genuinely predecessor-dependent, or suitable
for a benchmark. Two independent human reviewers still must make those
findings through `CASE-ADMISSION-REVIEW-CONTRACT.md`; later private-oracle,
trace, worker/vault, single-model, and controller-grading gates remain
separate.

The audit deliberately does not claim to infer semantic novelty from text or
code similarity. Such a heuristic can flag material for review, but cannot
prove that a private transition is or is not equivalent to a public solution.
The v3 admission receipt instead records each human reviewer's separate
attestation for every required finding and binds the hash of that reviewer's
private worksheet. The worksheet records rubric calibration, confidence, and
private rationale without exposing private task material in the public receipt.
