---
name: memorix-git-memory
description: Use when the task depends on commit history, what changed, when a fix shipped, or linking engineering evidence to reasoning memory.
---

# Memorix Git Memory

Use Git Memory for repository evidence. Use reasoning memory for intent.

## Retrieval Rules

- Prefer Git Memory for "what changed", "when did this ship", "which files were touched", and "which commit introduced this".
- Prefer reasoning memory for "why did we choose this", "what alternatives existed", and "what risk did we accept".
- Cross-link important decisions with `relatedCommits` when storing reasoning.
- Manual commit ingestion and history backfill are CLI-only workflows: `memorix ingest commit --ref <ref>` and `memorix ingest log --count 20`.
- Do not force-ingest noisy commits unless the skipped commit is genuinely important evidence.
