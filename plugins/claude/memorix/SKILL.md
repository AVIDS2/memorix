---
name: memorix
description: Use when Claude Code needs Memorix shared memory, reasoning, Git Memory, mini-skills, session handoff, orchestration coordination, or integration troubleshooting.
---

# Memorix

Memorix is a shared memory layer for the active workspace when Memorix tools are available. Use this root skill as a router, then prefer the focused skill for the task.

## Skill Router

| Task | Use |
|---|---|
| Recall/store durable workspace context | `memorix-memory` |
| Record or recover why a decision was made | `memorix-reasoning` |
| Resume sessions, bind HTTP projects, or prepare handoff | `memorix-sessions` |
| Use commit history as evidence | `memorix-git-memory` |
| Promote repeated knowledge into reusable guidance | `memorix-mini-skills` |
| Coordinate explicit subagent work | `memorix-orchestrate` |
| Diagnose MCP/setup/hooks/control-plane issues | `memorix-troubleshooting` |

## Default Loop

1. Search only when prior context would materially help.
2. Fetch detail before relying on a specific memory.
3. Store decisions, fixes, gotchas, and handoff context that future sessions should not rediscover.
4. Use CLI fallbacks when MCP tools are unavailable.

Do not store secrets, credentials, raw private transcripts, or trivial one-off actions. Treat memory as context, not as a substitute for reading code and verifying behavior.
