Show HN: Memorix – Cross-agent memory layer for coding agents via MCP

Repository: https://github.com/AVIDS2/memorix

Memorix is an open-source MCP server that gives multiple AI coding agents (Cursor, Claude Code, Windsurf, Copilot, Codex, etc.) a shared, persistent project memory layer.

The core problem: every coding agent forgets between sessions, and each agent's memory is siloed. Memorix fixes this by providing a local memory layer that all connected agents can read from and write to through the standard MCP protocol.

Three memory layers:
- Observation Memory: what changed, how something works, gotchas, problem-solution notes
- Reasoning Memory: why a decision was made, alternatives, trade-offs, risks
- Git Memory: immutable engineering facts derived from commit history with noise filtering (skips lockfile bumps, merge commits, typo fixes)

Quick start:
  npm install -g memorix
  memorix init
  memorix serve

Under the hood: SQLite as single source of truth, Orama for full-text/semantic search, memory formation pipeline (dedup, compaction, retention, source-aware retrieval), and an HTTP control plane with dashboard for multi-agent coordination.

Supports 10 clients: Claude Code, Cursor, Windsurf (core), GitHub Copilot, Kiro, Codex (extended), Gemini CLI, OpenCode, Antigravity, Trae (community).

Apache 2.0 licensed. Would love feedback from anyone using multiple coding agents.
