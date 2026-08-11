---
name: memorix-git-memory
description: Use when the task depends on commit history, what changed, when a fix shipped, or linking engineering evidence to reasoning memory.
---

# Memorix Git Memory

Use Git Memory for repository evidence. Use reasoning memory for intent.

## Tool Router

| Situation | Prefer | CLI fallback |
|---|---|---|
| Search what changed | `memorix_search` with a change-focused query | `memorix memory search --query "what changed <topic>"` |
| Inspect a git-backed memory | `memorix_detail` | `memorix memory detail --id <id>` |
| Ingest current commit manually | CLI | `memorix ingest commit` |
| Ingest a specific commit | CLI | `memorix ingest commit --ref <ref>` |
| Backfill recent history | CLI | `memorix ingest log --count 20` |
| Install post-commit ingestion | CLI | `memorix git-hook --force` |

## Retrieval Rules

- Prefer Git Memory for "what changed", "when did this ship", "which files were touched", and "which commit introduced this".
- Prefer reasoning memory for "why did we choose this", "what alternatives existed", and "what risk did we accept".
- Cross-link important decisions with `relatedCommits` when storing reasoning.
- Do not force-ingest noisy commits unless the skipped commit is genuinely important evidence.
