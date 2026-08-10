---
name: memorix-troubleshooting
description: Use when Memorix MCP, setup, project binding, HTTP control plane, hooks, skills, or agent integration is missing, stale, or failing.
---

# Memorix Troubleshooting

Prefer direct CLI diagnostics first. MCP is an integration surface, not the only way to operate Memorix.

## Diagnostic Router

| Symptom | Check | CLI fallback |
|---|---|---|
| MCP tools missing | host MCP config and restart | `memorix setup --agent <agent>` |
| Unsure project is bound | project status | `memorix status` and `git status` |
| HTTP MCP stale or unbound | background health and explicit session bind | `memorix background status`; then `memorix session start --projectRoot <path>` |
| Hooks not firing | hook status | `memorix hooks status` |
| Need to inspect generated files | preview | `memorix hooks preview --agent <agent>` |
| Setup looks incomplete | reinstall host integration | `memorix setup --agent <agent>` |
| Need dashboard/control plane | background service | `memorix background start` or `memorix serve-http --port 3211` |

## Mode Rules

- Use stdio MCP (`memorix serve`) for normal host-launched MCP integration.
- Use HTTP/background only for shared endpoint, dashboard, Docker, multiple clients, or foreground control-plane debugging.
- On Windows, prefer absolute native paths for `projectRoot` and remember that visually similar junction paths may bind different session histories.
- If MCP is unavailable but the CLI works, continue through CLI commands instead of blocking.
