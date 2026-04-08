# Memorix - Cross-Agent Memory Rules

Memorix is an open-source cross-agent memory layer for coding agents via MCP. These rules help Gemini-family agents share project-aware memory with the rest of the Memorix ecosystem.

You have access to Memorix memory tools. Follow these rules to maintain persistent, project-aware context across sessions.

## Session Start - Bind Project, Then Load Context

At the **beginning of every conversation**, before responding to the user:

1. Call `memorix_session_start`.
2. If you are connected to the HTTP control-plane mode (normally started with `memorix background start`; `memorix serve-http` is the foreground variant) and you know the current workspace path, pass:
   - `agent`
   - `projectRoot` = the **absolute path of the current workspace or repo root**
3. If you are using stdio / Quick Mode and Memorix is already project-bound, calling `memorix_session_start` without `projectRoot` is acceptable.
4. If session start reports that the project could not be resolved, retry with the correct absolute workspace path before using project-scoped memory tools.
5. Then call `memorix_search` with a query related to the user's first message or the current project.
6. If results matter, use `memorix_detail` to fetch the most relevant memories.
7. Reference relevant memories naturally so the user feels continuity.

Important:

- `projectRoot` is a detection anchor only; Git remains the source of truth for project identity.
- In HTTP control-plane mode, explicit `projectRoot` binding is the safest way to avoid cross-project drift.

## During Session - Capture Important Context

**Proactively** call `memorix_store` whenever any of the following happen:

### Architecture & Decisions
- Technology choice, framework selection, or design pattern adopted
- Trade-off discussion with a clear conclusion
- API design, database schema, or project structure decisions

### Bug Fixes & Problem Solving
- A bug is identified and resolved - store root cause + fix
- Workaround applied for a known issue
- Performance issue diagnosed and optimized

### Gotchas & Pitfalls
- Something unexpected or tricky is discovered
- A common mistake is identified and corrected
- Platform-specific behavior that caused issues

### Configuration & Environment
- Environment variables, port numbers, paths changed
- Docker, nginx, Caddy, or reverse proxy config modified
- Package dependencies added, removed, or version-pinned

### Deployment & Operations
- Server deployment steps (Docker, VPS, cloud)
- DNS, SSL/TLS certificate, domain configuration
- CI/CD pipeline setup or changes
- Database migration or data transfer procedures
- Server topology (ports, services, reverse proxy chain)
- SSH keys, access credentials setup (store pattern, NOT secrets)

### Project Milestones
- Feature completed or shipped
- Version released or published to npm/PyPI/etc.
- Repository made public, README updated, PR submitted

Use appropriate types: `decision`, `problem-solution`, `gotcha`, `what-changed`, `discovery`, `how-it-works`.

## Session End - Store Summary

When the conversation is ending or the user says goodbye:

1. Call `memorix_store` with type `session-request` to record:
   - What was accomplished in this session
   - Current project state and any blockers
   - Pending tasks or next steps
   - Key files modified

This creates a "handoff note" for the next session (or for another AI agent).

## Guidelines

- **Don't store trivial information** (greetings, acknowledgments, simple file reads, ls/dir output)
- **Do store anything you'd want to know if you lost all context**
- **Do store anything a different AI agent would need to continue this work**
- **Use concise titles** (~5-10 words) and structured facts
- **Include file paths** in `filesModified` when relevant
- **Include related concepts** for better searchability
- **Prefer storing too much over too little** - the retention system will auto-decay stale memories
