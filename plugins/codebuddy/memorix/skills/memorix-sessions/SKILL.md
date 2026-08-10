---
name: memorix-sessions
description: Use when resuming work, preparing handoff context, binding an HTTP control-plane project, or deciding whether session_start is useful.
---

# Memorix Sessions

`memorix_session_start` is optional. Use it when session semantics help; do not make memory-only work heavier than needed.

## Tool Router

| Situation | Prefer | CLI fallback |
|---|---|---|
| Resume a prior long-running task | `memorix_session_start` | `memorix session start --agent <name>` |
| HTTP control plane needs project binding | `memorix_session_start` with `projectRoot` | `memorix session start --projectRoot <absolute-path>` |
| Need recent handoff/session summaries | `memorix_session_context` | `memorix session context` |
| End a real working session | `memorix_session_end` | `memorix session end --sessionId <id> --summary "<summary>"` |
| Need explicit subagent coordination identity | `memorix_session_start` with `joinTeam: true` | `memorix session start --joinTeam --agentType <agent>` |

## Decision Rules

- For normal memory search/store, do not require session start.
- In HTTP mode, pass the absolute workspace path as `projectRoot` when available.
- `projectRoot` is a detection anchor; Git identity is the final project identity.
- Do not join coordination state unless the user is using tasks, messages, locks, handoff, or `memorix orchestrate`.
