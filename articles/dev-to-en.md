# Memorix: Give Your AI Coding Agents Shared, Persistent Project Memory

> TL;DR: Every coding agent forgets between sessions. Memorix is an open-source MCP memory layer that gives Cursor, Claude Code, Windsurf, and 7 other agents shared, persistent project memory — with Git truth and reasoning built in. `npm install -g memorix` and you're running.

---

## The problem nobody talks about

You're working in Cursor. You tell it about a tricky database migration pattern. Next session? Gone. You switch to Claude Code to continue. It has no idea what Cursor just learned.

This isn't a bug — it's the default. Every AI coding agent is stateless between sessions. Each one lives in its own silo.

Some agents have started adding memory features, but they're all **agent-specific**. Cursor's memory doesn't help Claude Code. Claude Code's memory doesn't help Windsurf. And none of them know what actually happened in your git history.

## What would "done right" look like?

I kept running into this problem across projects, so I built something to fix it properly. Here's what I think a cross-agent memory layer needs:

1. **Shared, not siloed** — Any agent can read and write to the same local memory base
2. **Git is ground truth** — Your commit history is the most reliable record of what actually happened. It should be searchable memory, not just log output
3. **Reasoning, not just facts** — "We chose PostgreSQL over MongoDB because of X" is more valuable than "database config changed"
4. **Quality control** — Without retention, deduplication, and formation, memory degrades into noise
5. **Local and private** — No cloud dependency. Your project memory stays on your machine

## Memorix: a memory layer for coding agents

[Memorix](https://github.com/AVIDS2/memorix) is an open-source MCP server that does all of the above. It runs locally, connects to your agents via the Model Context Protocol, and gives them a shared memory layer that persists across sessions and IDEs.

```
npm install -g memorix
memorix init
memorix serve
```

That's it. Your agent now has persistent project memory.

### What it stores

Memorix has three memory layers:

- **Observation Memory** — what changed, how something works, gotchas, problem-solution notes
- **Reasoning Memory** — why a decision was made, alternatives considered, trade-offs, risks
- **Git Memory** — immutable engineering facts derived from your commit history, with noise filtering

### How agents use it

Once Memorix is connected via MCP, your agents can:

- `memorix_store` — save a decision, gotcha, or observation
- `memorix_search` — find relevant past context
- `memorix_detail` — get the full story behind a result
- `memorix_timeline` — see the chronological context around a memory
- `memorix_store_reasoning` — record why a choice was made, not just what changed

And you don't have to manually trigger these — Memorix's hooks can auto-capture git commits, and the memory formation pipeline automatically deduplicates, merges, and scores incoming memories.

### The Git memory angle

This is the part I'm most excited about. Install the post-commit hook:

```bash
memorix git-hook --force
```

Now every commit becomes searchable engineering memory — with noise filtering that skips lockfile bumps, merge commits, and typo fixes. When you ask your agent "what changed in the auth module last week?", it can answer from actual git history, not just what someone bothered to write down.

### Cross-agent in practice

Here's a real workflow:

1. **Cursor** identifies a tricky caching bug and stores the root cause
2. **Claude Code** picks up the same project next session, searches memory, finds the bug context
3. **Windsurf** fixes the bug and stores the reasoning behind the fix
4. Next week, **Copilot** encounters a similar pattern and finds the prior reasoning

No copy-pasting context. No repeating explanations. The memory is just there.

## 10 agents, one memory

Memorix currently supports:

| Tier | Clients |
|------|---------|
| ★ Core | Claude Code, Cursor, Windsurf |
| ◆ Extended | GitHub Copilot, Kiro, Codex |
| ○ Community | Gemini CLI, OpenCode, Antigravity, Trae |

If a client can speak MCP and launch a local command or HTTP endpoint, it can usually connect even if it's not listed.

## How this differs from other memory tools

Most MCP memory servers focus on one thing: storing and retrieving text snippets. Memorix takes a different approach:

- **Git-grounded, not just user-stored** — Your commit history is the most reliable record of what actually happened in a project. Memorix turns it into searchable memory automatically, instead of relying entirely on what agents or users manually save
- **Reasoning, not just facts** — Storing "database config changed" is easy. Storing "we chose PostgreSQL over MongoDB because of X, Y, Z" is what actually helps future decisions
- **Cross-agent by design, not by accident** — The memory layer is shared across all connected agents from day one, not bolted on as an afterthought
- **Quality pipeline, not just storage** — Without dedup, compaction, and retention, memory degrades into noise over time. Memorix handles this automatically

## What's running under the hood

- **SQLite** as the single source of truth — observations, mini-skills, sessions, and archives all share one DB handle
- **Orama** for fast full-text and semantic search
- **Memory formation pipeline** — formation, compaction, retention, and source-aware retrieval work together
- **Team identity** — agent registration, heartbeat, task board, handoff artifacts for multi-agent coordination
- **HTTP control plane** — `memorix background start` gives you a dashboard + shared HTTP endpoint for multiple agents

## Try it

```bash
npm install -g memorix
memorix init
memorix serve
```

Add to your MCP client config:

```json
{
  "mcpServers": {
    "memorix": {
      "command": "memorix",
      "args": ["serve"]
    }
  }
}
```

**Links:**
- GitHub: https://github.com/AVIDS2/memorix
- npm: https://www.npmjs.com/package/memorix
- Docs: https://github.com/AVIDS2/memorix/tree/main/docs

Memorix is [Apache 2.0](https://github.com/AVIDS2/memorix/blob/main/LICENSE). If you're using multiple coding agents and tired of them forgetting everything, I'd love your feedback.

---

*Tags: #ai #coding #mcp #developer-tools #opensource*
