# Product Hunt Launch Prep

## Tagline (60 chars max)
Cross-agent memory layer for AI coding agents

## One-liner description
Give Cursor, Claude Code, Windsurf, and 7 other AI coding agents shared, persistent project memory via MCP — with Git truth and reasoning built in.

## Categories
Developer Tools, Open Source, AI

## Key features (for gallery)

1. **Shared Memory Across Agents** — Cursor, Claude Code, Windsurf, Copilot all read/write the same local memory base
2. **Git as Ground Truth** — Commit history becomes searchable engineering memory with noise filtering
3. **Reasoning Memory** — Stores "why" decisions were made, not just "what" changed
4. **Memory Quality Pipeline** — Auto dedup, compaction, retention, source-aware retrieval
5. **10 Agent Clients** — Core: Claude Code, Cursor, Windsurf. Extended: Copilot, Kiro, Codex. Community: Gemini CLI, OpenCode, Antigravity, Trae
6. **Local & Private** — SQLite + Orama, no cloud dependency, everything stays on your machine
7. **One Command Setup** — `npm install -g memorix && memorix init && memorix serve`

## First comment (maker comment)

Hey everyone! 👋 I built Memorix because I kept running into the same problem: every AI coding agent forgets between sessions, and each agent's memory is completely siloed. Cursor doesn't know what Claude Code learned, Claude Code doesn't know what Windsurf fixed.

Memorix gives them all a shared, persistent memory layer through the standard MCP protocol. The part I'm most excited about is the Git memory — your commit history becomes searchable engineering memory with noise filtering, so your agents can actually answer "what changed in the auth module last week?" from real git history.

It's fully local (SQLite + Orama), open source (Apache 2.0), and works with 10 different coding agents. Would love your feedback!

## Gallery image ideas (need to create)
1. Hero: "Your AI agents keep forgetting everything" → "Memorix fixes this"
2. Architecture: simple diagram showing 3 agents → Memorix → shared memory
3. Git memory demo: commit → auto-captured → searchable
4. Quick start: 3 commands in terminal
5. Supported clients grid

## Links
- GitHub: https://github.com/AVIDS2/memorix
- npm: https://www.npmjs.com/package/memorix
- Docs: https://github.com/AVIDS2/memorix/tree/main/docs
