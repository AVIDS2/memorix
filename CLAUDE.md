# Memorix - Agent Instructions for Claude Code

You have access to Memorix, a local-first memory platform for coding agents. Use it to persist and recall project knowledge across sessions, preserve reasoning, and retrieve Git-backed engineering truth when relevant.

## Rule 1: Start with context

At the beginning of every conversation:

1. Call `memorix_session_start` to load the previous session summary and recent high-value context.
2. Then call `memorix_search` with a query related to the user's first message or the current project.
3. If results matter, use `memorix_detail` to inspect the most relevant memories.
4. If the user is asking about "what changed", prioritize Git-backed memories when relevant.

## Rule 2: Store meaningful knowledge, not noise

Use `memorix_store` when you learn something a future agent should not have to rediscover.

Store:

- architecture or design decisions -> `decision`
- bug root cause + fix -> `problem-solution`
- non-obvious pitfalls -> `gotcha`
- implementation explanations -> `how-it-works`
- significant code or config changes -> `what-changed`
- trade-offs and rationale -> `trade-off`
- session handoff summaries -> `session-request`

Do not store:

- greetings
- simple file reads
- trivial shell commands
- redundant status chatter

## Rule 3: Preserve reasoning

When the important value is **why**, use `memorix_store_reasoning`:

- alternatives considered
- rationale
- constraints
- expected outcome
- risks

Reasoning memories are especially useful for future "why did we choose this?" questions.

## Rule 4: Resolve completed work

When a task is done or a bug is fixed, call `memorix_resolve`.

This keeps default search focused on active memory instead of resurfacing already-finished work forever.

## Rule 5: Respect project boundaries

- Default search is current-project scoped.
- Use global search only when the task is explicitly cross-project.
- If a global result comes from another project, open it with project-aware refs when needed.

## Rule 6: Favor structured, reusable memory

Best practices:

1. Use specific titles.
2. Include structured facts.
3. Include `filesModified` when you touched code.
4. Include concepts for searchability.
5. Prefer concise reusable summaries over raw transcripts.
6. Store milestones such as releases, published versions, and important merges.

## Tool Guide

### Core retrieval

- `memorix_session_start` - load session context
- `memorix_search` - search current or global memory
- `memorix_detail` - read full memory details
- `memorix_timeline` - inspect chronological context

### Core storage

- `memorix_store` - store reusable project knowledge
- `memorix_store_reasoning` - store design reasoning and trade-offs
- `memorix_resolve` - mark completed memories resolved

### Quality and operations

- `memorix_retention` - inspect decay/archive state
- `memorix_promote` - turn important observations into mini-skills
- `memorix_skills` - generate or inspect project skills
- `memorix_transfer` - export/import project memory

### Collaboration and platform

- `memorix_rules_sync` - inspect or sync rules across agents
- `memorix_workspace_sync` - inspect or migrate workspace integrations
- `team_manage`, `team_file_lock`, `team_task`, `team_message` - HTTP collaboration layer
