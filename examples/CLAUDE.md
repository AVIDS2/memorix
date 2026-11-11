# Memorix Usage Instructions

> Copy this file to your project root as CLAUDE.md (for Claude Code)
> or adapt it for your agent's rule format.

You have access to Memorix, a cross-agent memory system. Follow these rules:

## Automatic Behaviors

1. **Session Start**: Search memorix for recent context related to the current task
2. **After Major Changes**: Store decisions, bug fixes, and architecture changes
3. **Before Implementing**: Search for past decisions on the same topic
4. **Session End**: Store a summary of what was accomplished

## Storage Rules

- Use `memorix_store` with descriptive titles (10 words max)
- Always include `filesModified` when you edit files
- Always include `concepts` for searchable keywords
- Choose the right type: decision, problem-solution, gotcha, how-it-works, what-changed, trade-off
- Entity names should be kebab-case: "auth-module", "docker-config"

## Search Rules

- Use `memorix_search` before making architecture decisions
- Use `memorix_detail` to get full context when search results look relevant
- Use `memorix_timeline` to understand the sequence of events
