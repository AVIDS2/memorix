---
name: memorix-mini-skills
description: Use when durable project knowledge, gotchas, workflows, or repeated fixes should become reusable agent guidance instead of ordinary memory.
---

# Memorix Mini-Skills

Promote memories into mini-skills only when they are reusable instructions, not just historical notes.

## Tool Router

| Situation | Prefer | CLI fallback |
|---|---|---|
| Preview/discover existing project skills | `memorix_skills` action `list` | `memorix skills list` |
| Generate skills from memory patterns | `memorix_skills` action `generate` | `memorix skills generate` |
| Write generated skills to an agent | `memorix_skills` action `generate`, `write: true` | `memorix skills generate --write --target codex` |
| Promote selected memories permanently | `memorix_promote` action `promote` | `memorix memory promote --ids 42,43` |
| List/delete promoted mini-skills | `memorix_promote` | `memorix memory promote --action list|delete` |

## Promote When

- The knowledge has been proven by repeated observations or a high-value fix.
- It changes how future agents should act.
- It is specific enough to be actionable and general enough to reuse.

## Do Not Promote

- Command logs, probes, stale memories, one-off status notes, or unverified guesses.
- Anything that should expire after the current task.
