---
name: memorix-orchestrate
description: Use when a main agent needs Memorix to coordinate explicit subagent work through tasks, handoffs, messages, file locks, or the orchestrate CLI.
---

# Memorix Orchestrate

Use Memorix coordination for explicit subagent workflows with joined identities, tasks, handoffs, messages, file locks, and orchestrated workers.

## Tool Router

| Situation | Prefer | CLI fallback |
|---|---|---|
| Run managed subagent execution | CLI | `memorix orchestrate --goal "<goal>" --agents claude:1,codex:1` |
| Register coordination identity | `team_manage` action `join` | `memorix team join --agentType <agent>` |
| Create or inspect tasks | `team_task` | `memorix task create|list|claim|complete` |
| Send or read coordination messages | `team_message` | `memorix message send|broadcast|inbox` |
| Share structured handoff | `memorix_handoff` | `memorix handoff send` |
| Avoid file conflicts | `team_file_lock` | `memorix lock lock|unlock|status` |
| Poll joined coordination state | `memorix_poll` | `memorix poll` |

## Boundaries

- For ordinary memory, do not join coordination state.
- For production multi-agent execution, prefer `memorix orchestrate` so the main process owns planning, dispatch, retries, and verification gates.
- In worker prompts, use the worker agent ID returned by session start or team join; never use the coordinator ID as the worker identity.
