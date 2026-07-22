# Retired Development Corpus

Status: withdrawn before public benchmark release and before any confirmatory
analysis.

An independent public-surface review found that all eight early development
exercises exposed answer material through one or more of these channels:

- hidden tests or reference repairs committed beside the public case card;
- precise behavior predicates or prohibited implementation paths in public
  manifests and task notes;
- transition diffs that made the intended repair easy to reverse engineer; or
- precursor transcripts and traces containing implementation-level recipes.

Those exercises were useful for discovering harness defects, but they are not
benchmark cases, comparison rows, ablation evidence, or paper results. Their
raw assets have been quarantined outside the repository and must never be
copied into a public branch, public artifact, model prompt, or agent workspace.

This withdrawal is intentionally irreversible for the affected case ids. A
future task covering a similar engineering theme must use a new case id, a new
private transition and oracle, a clean public card, and a fresh admission
review. The quarantine exists for maintainer debugging only; it is not part of
the released artifact.
