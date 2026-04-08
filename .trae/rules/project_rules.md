# Memorix - Automatic Memory Rules

You have access to Memorix memory tools. Follow these rules to maintain persistent context across sessions.

## RULE 1: Session Start - Bind Project, Then Load Context

At the **beginning of every conversation**, BEFORE responding to the user:

1. Call `memorix_session_start` to get the previous session summary and key memories.
2. In HTTP control-plane mode (`memorix serve-http`), if you know the current workspace path, pass:
   - `agent`
   - `projectRoot` = the **absolute path of the current workspace or repo root**
3. In stdio / Quick Mode, if Memorix is already project-bound, calling `memorix_session_start` without `projectRoot` is acceptable.
4. If session start reports that the project could not be resolved, retry with the correct absolute workspace path before using project-scoped memory tools.
5. Then call `memorix_search` with a query related to the user's first message for additional context.
6. If search results are found, use `memorix_detail` to fetch the most relevant ones.
7. Reference relevant memories naturally - the user should feel you "remember" them.

Important:

- `projectRoot` is a detection anchor only; Git remains the source of truth for project identity.
- In HTTP control-plane mode, explicit `projectRoot` binding is the safest path and avoids cross-project drift.

## RULE 2: Store Important Context

**Proactively** call `memorix_store` when any of the following happen:

### What MUST be recorded:
- Architecture/design decisions -> type: `decision`
- Bug identified and fixed -> type: `problem-solution`
- Unexpected behavior or gotcha -> type: `gotcha`
- Config changed (env vars, ports, deps) -> type: `what-changed`
- Feature completed or milestone -> type: `what-changed`
- Trade-off discussed with conclusion -> type: `trade-off`

### What should NOT be recorded:
- Simple file reads, greetings, trivial commands (`ls`, `pwd`, `git status`)

### Use topicKey for evolving topics:
For decisions, architecture docs, or any topic that evolves over time, ALWAYS use `topicKey`.
This ensures the memory is UPDATED instead of creating duplicates.
Use `memorix_suggest_topic_key` to generate a stable key.

### Track progress with the progress parameter:
When working on features or tasks, include the `progress` parameter.

## RULE 3: Resolve Completed Memories

When a task is completed, a bug is fixed, or information becomes outdated:

1. Call `memorix_resolve` with the observation IDs to mark them as resolved.
2. Resolved memories are hidden from default search, preventing context pollution.

## RULE 4: Session End - Store Decision Chain Summary

When the conversation is ending, create a **decision chain summary**:

1. Call `memorix_store` with type `session-request` and `topicKey: "session/latest-summary"`:
   - goal
   - key decisions and reasoning
   - what changed
   - current state
   - next steps
2. Call `memorix_resolve` on any memories for tasks completed in this session.

## RULE 5: Compact Awareness

Memorix automatically compacts memories on store:
- With LLM API configured: smart deduplication and fact extraction
- Without LLM: heuristic deduplication
- Store naturally; use `memorix_deduplicate` only for batch cleanup when needed

## Guidelines

- **Use concise titles** and structured facts
- **Include file paths** in `filesModified` when relevant
- **Include related concepts** for better searchability
- **Always use topicKey** for recurring topics to prevent duplicates
- **Always resolve** completed tasks and fixed bugs
- **Always include reasoning** when it matters
- Search defaults to `status="active"` - use `status="all"` to include resolved memories
