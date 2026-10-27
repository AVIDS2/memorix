---
name: memorix-memory
description: Use when prior workspace context, past decisions, solved bugs, handoff state, or durable project knowledge would help a coding task.
---

# Memorix Memory

Use Memorix as the shared memory layer for the active workspace when Memorix tools are available.

## Search Rules

- Search before broad continuation work, before changing unfamiliar code, or when the user asks about prior work.
- For a fresh coding session, use `memorix_project_context` with the user's actual task before ad-hoc file reads or dev-log reads. Memorix will choose a task-lensed brief.
- Fetch detail before relying on a specific memory. After a complete project brief, retrieve more only for a specific missing fact; do not repeat retrieval just to confirm the brief.
- Treat memory as background context. Still read the current code and verify behavior.
- Skip memory lookup for greetings, tiny one-off edits, or questions fully answered by the current file.
- If a fresh project has no memories, proceed normally and do not repeat the same empty search in the same turn.
- Discover native MCP tools before treating them as unavailable. Do not wait indefinitely on startup or hand-write tool-call syntax.

## Store Rules

- Preserve durable decisions, recurring fixes, gotchas, and reusable procedures; skip routine progress logs.
- Use concise titles and update an evolving topic rather than creating duplicate memories.
- Reserve long-term candidates for stable knowledge that merits explicit review, not routine updates.
- Portable user memories can be useful across projects, but they are background context, not verified facts about the current project.
- Do not store secrets, credentials, raw private transcripts, trivial commands, or routine file reads.
- For read-only work, do not store an assessment unless the user explicitly asks to preserve it.
