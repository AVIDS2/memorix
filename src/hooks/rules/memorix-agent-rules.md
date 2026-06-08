# Memorix — Automatic Memory Rules

You have access to Memorix memory tools. Follow these rules to maintain persistent context across sessions.

## Use Memory When Useful

At the beginning of a conversation, use Memorix when prior project context would materially help the task. A session bind is not required for every conversation.

1. Call `memorix_search` with a query related to the user's first message or the current project
2. If results are found, use them to understand the current project state, recent decisions, and pending tasks
3. Call `memorix_session_start` only when explicit session semantics are useful: handoff, long-running work, team coordination, restoring prior session context, or HTTP project binding
4. Reference relevant memories naturally in your response — don't just list them

If `memorix_search` says this is a fresh project with no Memorix memories yet, treat that as a successful cold-start signal. Do not repeat `memorix_search` again in the same turn unless the user explicitly asks for history/context, or new memories were written during the turn.

This keeps memory useful without forcing every agent turn through a session ritual.

## During Session — Capture Important Context

Proactively call `memorix_store` when any of the following happen:

- **Architecture decision**: You or the user decide on a technology, pattern, or approach
- **Bug fix**: A bug is identified and resolved — store the root cause and fix
- **Gotcha/pitfall**: Something unexpected or tricky is discovered
- **Configuration change**: Environment, port, path, or tooling changes
- **Important learning**: A non-obvious insight about the codebase

Use appropriate types: `decision`, `problem-solution`, `gotcha`, `what-changed`, `discovery`.

## Session End — Store Summary

When the conversation is ending or the user says goodbye:

1. Call `memorix_store` with type `session-request` to record:
   - What was accomplished in this session
   - Current project state (version, branch, what's working)
   - Pending tasks or next steps
   - Any unresolved issues

This creates a "handoff note" for the next session.

## Guidelines

- **Don't store trivial information** (greetings, acknowledgments, simple file reads)
- **Do store anything you'd want to know if you lost all context**
- **Use concise titles** (5-10 words) and structured facts
- **Include file paths** in filesModified when relevant
- **Tag concepts** for better searchability
