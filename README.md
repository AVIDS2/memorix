<p align="center">
  <img src="https://raw.githubusercontent.com/AVIDS2/memorix/main/assets/readme-logo-bridge.png" alt="Memorix" width="720">
</p>

<h1 align="center">Memorix</h1>

<p align="center">
  <strong>Local-first shared memory layer for AI coding agents.</strong><br>
  One project memory system for Claude Code, Codex, Cursor, Windsurf, Copilot, Gemini CLI, OpenCode, Kiro, Antigravity, Trae, memcode, and any MCP-capable agent.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/memorix"><img src="https://img.shields.io/npm/v/memorix.svg?style=for-the-badge&logo=npm&color=cb3837" alt="npm"></a>
  <a href="https://github.com/AVIDS2/memorix/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/AVIDS2/memorix/ci.yml?style=for-the-badge&label=CI&logo=github" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache%202.0-2563eb?style=for-the-badge" alt="license"></a>
  <a href="https://github.com/AVIDS2/memorix"><img src="https://img.shields.io/github/stars/AVIDS2/memorix?style=for-the-badge&logo=github&color=facc15" alt="stars"></a>
</p>

<p align="center">
  <strong>Shared Project Memory</strong> | <strong>MCP</strong> | <strong>Git Memory</strong> | <strong>Reasoning Memory</strong> | <strong>Dashboard</strong> | <strong>Agent Team</strong>
</p>

<p align="center">
  <a href="README.zh-CN.md">Chinese</a> |
  <a href="#install">Install</a> |
  <a href="#works-with-your-agent">Agents</a> |
  <a href="#quick-start">Quick Start</a> |
  <a href="#memory-model">Memory Model</a> |
  <a href="#memcode-first-party-memagent">memcode</a> |
  <a href="#docs">Docs</a>
</p>

---

## What Memorix Is

Memorix is a memory layer for AI software work. It is not another agent you have to switch to. It gives the agents you already use a shared, searchable project memory that survives new chats, IDE switches, terminal sessions, and handoffs.

Use Claude Code today, Codex tomorrow, Cursor in the afternoon, and memcode when you want a native terminal agent. Memorix keeps the project memory under the Git project instead of trapping it inside one chat window or one tool.

| Problem | What Memorix adds |
| --- | --- |
| The next session forgets what the last session learned | Project-scoped memory, session summaries, timelines, and detail retrieval |
| Different agents know different things | One local memory pool shared through MCP, hooks, CLI, SDK, and memcode |
| Git records what changed, but agents cannot recall it well | Git Memory turns commits into searchable engineering facts |
| Architecture decisions disappear into old chats | Reasoning Memory stores why choices were made, with alternatives and trade-offs |
| Static rule files drift | Gotchas, fixes, and project skills evolve from real work |
| Multi-agent work gets messy | Optional Agent Team state for tasks, messages, handoffs, locks, and orchestration |

Memorix is local-first. SQLite is the canonical store, Orama handles search, and LLM-backed formation/embedding is optional. Without model keys, Memorix still works with local full-text retrieval.

## Works With Your Agent

Memorix works with agents that can launch a local MCP server, connect to HTTP MCP, or run hooks. The exact integration depth differs by client.

<table>
<tr>
<td align="center" width="12.5%">
<a href="https://claude.com/product/claude-code"><img src="https://github.com/anthropics.png?size=120" alt="Claude Code" width="48" height="48"></a><br>
<strong>Claude Code</strong><br>
<sub>Core: MCP + hooks + rules</sub>
</td>
<td align="center" width="12.5%">
<a href="https://openai.com/codex"><img src="https://github.com/openai.png?size=120" alt="Codex" width="48" height="48"></a><br>
<strong>Codex</strong><br>
<sub>Extended: MCP + rules</sub>
</td>
<td align="center" width="12.5%">
<a href="https://cursor.com"><picture><source media="(prefers-color-scheme: dark)" srcset="https://svgl.app/library/cursor_dark.svg"><img src="https://svgl.app/library/cursor_light.svg" alt="Cursor" width="48" height="48"></picture></a><br>
<strong>Cursor</strong><br>
<sub>Core: MCP + rules</sub>
</td>
<td align="center" width="12.5%">
<a href="https://windsurf.com"><picture><source media="(prefers-color-scheme: dark)" srcset="https://svgl.app/library/windsurf-dark.svg"><img src="https://svgl.app/library/windsurf-light.svg" alt="Windsurf" width="48" height="48"></picture></a><br>
<strong>Windsurf</strong><br>
<sub>Core: MCP + hooks</sub>
</td>
<td align="center" width="12.5%">
<a href="https://github.com/features/copilot"><img src="https://github.githubassets.com/images/modules/site/copilot/copilot.png" alt="GitHub Copilot" width="48" height="48"></a><br>
<strong>Copilot</strong><br>
<sub>Extended: VS Code MCP</sub>
</td>
<td align="center" width="12.5%">
<a href="https://github.com/google-gemini/gemini-cli"><img src="https://github.com/google-gemini.png?size=120" alt="Gemini CLI" width="48" height="48"></a><br>
<strong>Gemini CLI</strong><br>
<sub>Community: MCP</sub>
</td>
</tr>
<tr>
<td align="center" width="12.5%">
<a href="https://github.com/opencode-ai/opencode"><picture><source media="(prefers-color-scheme: dark)" srcset="https://svgl.app/library/opencode-dark.svg"><img src="https://svgl.app/library/opencode.svg" alt="OpenCode" width="48" height="48"></picture></a><br>
<strong>OpenCode</strong><br>
<sub>Community: hooks + MCP</sub>
</td>
<td align="center" width="12.5%">
<img src="https://placehold.co/48x48/111827/ffffff?text=K" alt="Kiro" width="48" height="48"><br>
<strong>Kiro</strong><br>
<sub>Extended: MCP + hooks</sub>
</td>
<td align="center" width="12.5%">
<img src="https://placehold.co/48x48/111827/ffffff?text=A" alt="Antigravity" width="48" height="48"><br>
<strong>Antigravity</strong><br>
<sub>Community: MCP</sub>
</td>
<td align="center" width="12.5%">
<img src="https://placehold.co/48x48/111827/ffffff?text=T" alt="Trae" width="48" height="48"><br>
<strong>Trae</strong><br>
<sub>Community: MCP</sub>
</td>
<td align="center" width="12.5%">
<img src="https://raw.githubusercontent.com/AVIDS2/memorix/main/assets/logo.png" alt="memcode" width="48" height="48"><br>
<strong>memcode</strong><br>
<sub>First-party memagent</sub>
</td>
<td align="center" width="12.5%">
<img src="https://placehold.co/48x48/111827/ffffff?text=M" alt="Any MCP Client" width="48" height="48"><br>
<strong>Any MCP Client</strong><br>
<sub>stdio or HTTP MCP</sub>
</td>
</tr>
</table>

Support tiers:

| Tier | Meaning |
| --- | --- |
| Core | Tested MCP path plus first-class rules or hooks |
| Extended | Supported path with platform-specific caveats |
| Community | Best-effort compatibility through MCP or hook adapters |
| First-party | Built by this repo to prove and use Memorix memory natively |

## Install

Requirements:

- Node.js `>=22.19.0`
- Git, because project identity is derived from the real Git root

Install and initialize:

```bash
npm install -g memorix
cd your-git-repo
memorix init
```

`memorix init` creates or updates TOML configuration:

- `~/.memorix/config.toml` for global defaults
- `<git-root>/memorix.toml` for optional project overrides

Legacy `memorix.yml`, `.env`, and `~/.memorix/config.json` are still read for compatibility, but new setup flows use TOML.

## Quick Start

### Add memory to an existing agent

Generic stdio MCP:

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

Generic HTTP MCP:

```bash
memorix background start
```

Then point the client at:

```text
http://localhost:3211/mcp
```

In HTTP mode, agents should bind the active repo explicitly with `memorix_session_start(projectRoot=...)` when the client can provide the workspace path. Git remains the final source of truth for project identity.

### Work from the CLI

```bash
memorix memory search --query "release blocker"
memorix reasoning search --query "why sqlite"
memorix git-hook --force
memorix ingest log --count 20
memorix dashboard
```

### Use the first-party memagent

```bash
memorix
# or
memcode
```

This opens memcode, the bundled terminal memagent for working directly with the same Memorix project memory used by MCP-connected agents.

## Memory Model

| Layer | Stores | Best for |
| --- | --- | --- |
| Observation Memory | facts, gotchas, fixes, implementation notes | "How does this work?" |
| Reasoning Memory | rationale, alternatives, constraints, risks | "Why did we choose this?" |
| Git Memory | commit-derived engineering facts | "What changed and where?" |

Search is project-scoped by default. `scope="global"` searches across projects. Retrieval boosts Git Memory for "what changed" questions and reasoning records for "why" questions.

## Runtime Modes

| You want | Run |
| --- | --- |
| Give an IDE or agent shared memory over stdio MCP | `memorix serve` |
| Run shared HTTP MCP plus dashboard | `memorix background start` |
| Debug HTTP MCP in the foreground | `memorix serve-http --port 3211` |
| Inspect or manage memory directly | `memorix memory`, `memorix reasoning`, `memorix session`, `memorix ingest` |
| Use the bundled first-party memagent | `memorix` or `memcode` |
| Run autonomous multi-agent work | `memorix orchestrate --goal "..."` |

## memcode: First-Party Memagent

memcode is the bundled terminal memagent for Memorix. It reads from and writes to the same project memory pool used by your MCP-connected coding agents.

memcode can read, edit, run commands, resume sessions, switch models, and expose `/memory` commands. It writes into the same project memory pool used by Claude Code, Codex, Cursor, Windsurf, and other agents connected through Memorix MCP.

```text
one Git project -> one shared Memorix memory pool
```

See [docs/MEMCODE.md](docs/MEMCODE.md) for the memcode-specific guide.

## Configuration

Minimal `~/.memorix/config.toml`:

```toml
[memory.llm]
provider = "openai"
model = "gpt-4o-mini"
api_key = "..."

[embedding]
provider = "auto"

[memory]
inject = "minimal"
formation = "active"

[agent]
provider = "openai"
model = "gpt-4o"
api_key = "..."
```

Use `[memory.llm]` and `[embedding]` for Memorix memory quality and retrieval. Use `[agent]` only for memcode or other first-party agent flows. Keep credentials in global config or environment variables, and do not commit secrets.

## Docker

Docker is for the HTTP control plane, not stdio MCP:

```bash
docker compose up --build -d
```

Then open:

- dashboard: `http://localhost:3211`
- MCP: `http://localhost:3211/mcp`
- health: `http://localhost:3211/health`

The container must be able to see the repository path passed as `projectRoot` for project-scoped Git/config behavior.

## SDK

Use Memorix directly from TypeScript:

```ts
import { createMemoryClient } from 'memorix/sdk';

const client = await createMemoryClient({ projectRoot: '/path/to/repo' });

await client.store({
  entityName: 'auth-module',
  type: 'decision',
  title: 'Use JWT for API auth',
  narrative: 'Chose JWT because the API is stateless and used by multiple clients.',
});

const results = await client.search({ query: 'auth decision' });
await client.close();
```

## What's New In The 1.1 Line

- **TOML-first configuration**: `~/.memorix/config.toml` and project `memorix.toml` are the user-facing config model.
- **Separate model lanes**: memory formation, embeddings, and first-party agent flows can use different providers.
- **memcode as a first-party memagent**: a bundled terminal agent that can directly use and contribute to Memorix project memory.
- **Release hardening**: packaged memcode resolution, SQLite ESM loading, resume/session UI, CLI test isolation, and CI checks were tightened for the release path.

## Docs

| Start here | Use when |
| --- | --- |
| [Docs Map](docs/README.md) | You want the shortest route to the right guide |
| [Setup Guide](docs/SETUP.md) | Installing, choosing stdio vs HTTP, configuring IDEs |
| [Configuration](docs/CONFIGURATION.md) | TOML config, model lanes, compatibility files |
| [API Reference](docs/API_REFERENCE.md) | MCP tools and operator CLI |
| [Git Memory](docs/GIT_MEMORY.md) | Commit ingestion and searchable engineering truth |
| [Docker](docs/DOCKER.md) | Containerized HTTP control plane |
| [memcode](docs/MEMCODE.md) | Using the bundled first-party memagent |
| [Agent Operator Playbook](docs/AGENT_OPERATOR_PLAYBOOK.md) | AI-facing execution guide for install, binding, hooks, and troubleshooting |
| [Development](docs/DEVELOPMENT.md) | Contributing, testing, release checks |

LLM-friendly summaries: [llms.txt](llms.txt) and [llms-full.txt](llms-full.txt).

## Development

```bash
git clone https://github.com/AVIDS2/memorix.git
cd memorix
npm install
npm run lint
npm test
npm run build
```

## Acknowledgements

Memorix builds on ideas from the MCP ecosystem and prior memory projects such as mcp-memory-service, MemCP, claude-mem, and Mem0. memcode is based on the Pi coding-agent codebase and adapts its terminal-agent model for the Memorix ecosystem.

## License

[Apache 2.0](LICENSE)
