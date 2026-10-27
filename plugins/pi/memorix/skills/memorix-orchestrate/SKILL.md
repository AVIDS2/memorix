---
name: memorix-orchestrate
description: Use when a main agent needs Memorix to coordinate explicit subagent work through tasks, handoffs, messages, file locks, or the orchestrate CLI.
---

# Memorix Orchestrate

Use Memorix coordination for explicit subagent workflows with joined identities, tasks, handoffs, messages, file locks, and orchestrated workers.

The default `lite` profile does not expose coordination tools; they require `team` or `full`. Do not probe unavailable tools in a loop.

## Boundaries

- For ordinary memory, do not join coordination state.
- For explicitly requested managed execution, use `memorix orchestrate --goal "<goal>" --agents <agents>` so the main process owns planning, dispatch, retries, and verification gates.
- In worker prompts, use the worker agent ID returned by session start or team join; never use the coordinator ID as the worker identity.
