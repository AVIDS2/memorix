---
name: memorix-sessions
description: Use when resuming work, preparing handoff context, binding an HTTP control-plane project, or deciding whether session_start is useful.
---

# Memorix Sessions

`memorix_session_start` is optional. Use it when session semantics help; do not make memory-only work heavier than needed.

## Decision Rules

- For normal memory search/store, do not require session start.
- In HTTP mode, pass the absolute workspace path as `projectRoot` when available.
- `projectRoot` is a detection anchor; Git identity is the final project identity.
- Do not join coordination state unless the user is using tasks, messages, locks, handoff, or `memorix orchestrate`.
