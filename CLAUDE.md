# Memorix — Agent Instructions for Claude Code

You have access to Memorix, a cross-agent memory system. Use it to persist and recall project knowledge across sessions.

## When to SEARCH memory (memorix_search)

- **Session start**: Always search for recent context at the beginning of a conversation
- **Before making decisions**: Search for past decisions on the same topic
- **When the user asks "remember"/"what did we"/"last time"**: Search for relevant history
- **Before implementing features**: Check if similar work was done before
- **When encountering errors**: Search for known gotchas and past solutions

## When to STORE memory (memorix_store)

- **Architecture decisions**: Why you chose X over Y (type: `decision`)
- **Bug fixes**: Root cause and solution (type: `problem-solution`)
- **Gotchas/pitfalls**: Things that tripped you up (type: `gotcha`)
- **How things work**: Non-obvious system behavior (type: `how-it-works`)
- **Changes made**: Significant code changes (type: `what-changed`)
- **Trade-offs**: Compromises and their reasoning (type: `trade-off`)
- **Session goals**: What the user asked for at session start (type: `session-request`)

## When to check RETENTION (memorix_retention)

- Periodically check which memories are stale or candidates for archiving
- Review top-relevant memories to avoid duplicating past work

## Best Practices

1. **Be specific in titles**: "Fixed Docker timeout from 30s to 60s" not "Fixed bug"
2. **Include facts**: Structured data like "Default port: 3001", "Retry count: 3"
3. **Tag files**: Always include filesModified when you edit files
4. **Use concepts**: Add searchable keywords for future retrieval
5. **Don't over-store**: Only store knowledge that would be useful in a future session
6. **Entity naming**: Use kebab-case descriptive names like "auth-module", "docker-config"

## Tool Quick Reference

| Tool | When | Example |
|------|------|---------|
| `memorix_search` | Find past knowledge | `query: "authentication"` |
| `memorix_store` | Save new knowledge | `type: "decision", title: "Use JWT for auth"` |
| `memorix_detail` | Get full observation | `ids: [42, 43]` |
| `memorix_timeline` | See what happened around an event | `anchorId: 42` |
| `memorix_resolve` | Mark task done / bug fixed | `ids: [42]` |
| `memorix_session_start` | Load context at session start | (no params needed) |
| `memorix_session_end` | Save session summary | `summary: "## Goal\n..."` |
| `memorix_promote` | Make observation permanent | `action: "promote", observationIds: [42]` |
| `memorix_retention` | Check memory health | `action: "report"` |
| `memorix_transfer` | Export/import memories | `action: "export"` |
| `memorix_rules_sync` | Sync agent rules | `action: "status"` |
| `memorix_workspace_sync` | Migrate workspace configs | `action: "scan"` |
| `team_manage` | Register agent | `action: "join", name: "claude-backend"` |
| `team_file_lock` | Lock file before editing | `action: "lock", file: "src/auth.ts"` |
| `team_task` | Create/claim tasks | `action: "create", description: "Fix auth bug"` |
| `team_message` | Send message to other agent | `action: "send", to: "agent-id"` |
