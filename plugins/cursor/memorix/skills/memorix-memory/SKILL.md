---
name: memorix-memory
description: Use when prior workspace context, past decisions, solved bugs, handoff state, or durable project knowledge would help a coding task.
---

# Memorix Memory

Use Memorix as the shared memory layer for the active workspace when Memorix tools are available.

## Tool Router

| Situation | Prefer | CLI fallback |
|---|---|---|
| Broad continuation, memory overview, or "what do we know?" | `memorix_graph_context` | `memorix memory graph-context --query "<topic>"` |
| Specific past decision, bug, file, or change | `memorix_search` | `memorix memory search --query "<topic>"` |
| Need the full source for a search hit | `memorix_detail` | `memorix memory detail --id <id>` |
| Need the sequence around one memory | `memorix_timeline` | `memorix memory timeline --id <id>` |
| Learned reusable project knowledge | `memorix_store` | `memorix memory store --type <type> --entity <name> --title "<title>" "<text>"` |
| Task or bug is complete/outdated | `memorix_resolve` | `memorix memory resolve --ids <ids>` |

## Search Rules

- Search before broad continuation work, before changing unfamiliar code, or when the user asks about prior work.
- Fetch detail before relying on a specific memory.
- Treat memory as background context. Still read the current code and verify behavior.
- Skip memory lookup for greetings, tiny one-off edits, or questions fully answered by the current file.
- If a fresh project has no memories, proceed normally and do not repeat the same empty search in the same turn.

## Store Rules

| What to store | Type |
|---|---|
| Architecture or product decision | `decision` |
| Bug and fix that may recur | `problem-solution` |
| Non-obvious pitfall | `gotcha` |
| How a subsystem works | `how-it-works` |
| Important implementation change | `what-changed` |
| Accepted compromise | `trade-off` |

- Use concise titles, stable entity names, relevant `filesModified`, and `topicKey` for evolving topics.
- Do not store secrets, credentials, raw private transcripts, trivial commands, or routine file reads.
