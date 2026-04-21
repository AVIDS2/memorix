Title options (pick per subreddit):
- r/MCP: "Memorix: an MCP server that gives coding agents shared, persistent project memory"
- r/LocalLLaMA: "Open-source local memory layer for AI coding agents — works with Cursor, Claude Code, Windsurf, etc."
- r/cursor: "Give Cursor persistent project memory that carries across sessions and IDEs"
- r/ClaudeAI: "Claude Code keeps forgetting between sessions? Here's an open-source fix"

---

## Post body

If you use multiple AI coding agents (Cursor, Claude Code, Windsurf, etc.), you've probably noticed they all forget everything between sessions — and each agent's memory is completely siloed.

I built [Memorix](https://github.com/AVIDS2/memorix) to fix this. It's an open-source MCP server that provides a shared, persistent memory layer across coding agents.

**How it works:**
- Runs locally as an MCP server — no cloud dependency
- Any connected agent can read/write to the same project memory
- Three memory layers: observations (what/how), reasoning (why/trade-offs), and git memory (immutable facts from commit history)
- Git memory has noise filtering — skips lockfile bumps, merge commits, typo fixes
- Memory quality pipeline handles dedup, compaction, retention automatically

**Quick start:**
```
npm install -g memorix
memorix init
memorix serve
```

Then add to your MCP client config and your agent has persistent project memory.

**What makes it different from other memory tools:**
- Cross-agent: same memory works across Cursor, Claude Code, Windsurf, Copilot, etc.
- Git-grounded: commit history becomes searchable memory, not just log output
- Reasoning-aware: stores "why" not just "what"
- Local/private: everything stays on your machine, SQLite + Orama

Supports 10 clients currently. Apache 2.0 licensed.

Would love feedback from anyone dealing with the same agent-memory problem.
