# Reviewer Handoff Packet Contract

This contract defines a private packet for independent human review of a
screened real-repository source. It is not a benchmark case, an experiment
result, or a claim that Memorix improves a coding agent.

## Why A Packet Exists

The public source ledger can prove repository provenance and the public receipt
can prove that two reviewer pseudonyms made specific assertions. Neither proves
that the reviewers saw the same private design, applied the same rubric, or
left any reasoning behind a set of checkboxes.

The packet makes those inputs explicit without publishing private task material.
It is built only after the hash-only private-draft audit passes and must live
outside the research checkout, source cache, and private draft directory.

## Packet Contents

- `PRIVATE-REVIEW-BUNDLE/`: the four committed private files, copied without
  modification;
- `PRE-ADMISSION-AUDIT.json`: the mechanical provenance, hash, and safety
  receipt;
- `PUBLIC-HISTORY-DOSSIER.json`: public source URLs and a bounded list of paths
  changed by the linked public transition;
- the reviewer guide, calibration cards, organizer checklist, and a private
  worksheet template; and
- `PACKET-MANIFEST.json`: hashes of every packet file.

The dossier is deliberately **non-decisional**. It does not score semantic
similarity, declare a task novel, or decide whether a predecessor dependency is
real. It only gives reviewers a reproducible starting point for manually
comparing the private design with public history.

## Build

Build one packet per candidate in an external private location:

```powershell
uv run memorixbench build-reviewer-handoff-packet `
  cases/CANDIDATE-SOURCES.toml click-help-parameter `
  --draft-root <private-draft-root> `
  --repository-cache <pinned-source-cache> `
  --reviewer-guide ADMISSION-REVIEWER-GUIDE.md `
  --packet-id click-admission-review-v1 `
  --output <external-private-packet>
```

The command refuses an existing output and refuses output nested inside the
research tree, the source checkout, or the private draft tree. This prevents a
packet from quietly becoming a Git candidate or contaminating the source cache.

Before distributing or accepting a packet, verify the exact file tree and every
manifest hash:

```powershell
uv run memorixbench audit-reviewer-handoff-packet <external-private-packet>
```

## Independent Review

Each reviewer receives a separate packet copy and completes a private
worksheet before seeing any other reviewer response. The worksheet records:

1. rubric calibration on three deliberately clear teaching cases;
2. an affirmed or not-affirmed verdict, confidence, and private rationale for
   each required admission finding; and
3. the immutable admission-draft hash and reviewer pseudonym.

The organizer validates each worksheet locally, records each worksheet SHA-256
in the corresponding `reviewer_attestations` row of a
`case-admission-review-v3` receipt, then validates the complete link:

```powershell
uv run memorixbench validate-admission-review-worksheets <public-receipt> `
  --draft <private-draft>/ADMISSION-REVIEW-DRAFT.json `
  --worksheet <reviewer-one-private-worksheet> `
  --worksheet <reviewer-two-private-worksheet> `
  --ledger cases/CANDIDATE-SOURCES.toml `
  --candidate-id click-help-parameter
```

For an approval, both worksheets must affirm all four findings and record at
least medium confidence. A disagreement, low-confidence judgment, or
current-source-sufficient conclusion is not an approval. The organizer may
reject the candidate or begin a new independent review after a materially new
private design is authored; it must not edit the old receipt into agreement.

Only the hash-only public receipt may enter the source ledger. Worksheets,
private rationales, private task material, and the packet itself remain with
the review organizer and must not be uploaded to the public artifact.

## Boundary

The packet improves accountability and review ergonomics. It cannot prove that
a reviewer read carefully, determine semantic novelty by itself, establish what
a model saw in pretraining, or turn an AI critique into an independent human
review. Approval permits later case authoring only; all private-oracle,
independent-trace, relay, worker, and analysis-freeze gates remain in force.
