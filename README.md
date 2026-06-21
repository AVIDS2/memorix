<p align="center">
  <img src="https://raw.githubusercontent.com/AVIDS2/memorix/main/assets/readme-logo-bridge.png" alt="Memorix" width="720">
</p>

<h1 align="center">Memorix</h1>

<p align="center">
  <strong>Local-first shared memory layer for AI coding agents.</strong><br>
  One project memory system for Claude Code, Codex, Cursor, Windsurf, Copilot, Gemini CLI, OpenCode, Pi, Kiro, Antigravity, Trae, memcode, and any MCP-capable agent.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/memorix"><img src="https://img.shields.io/npm/v/memorix.svg?style=for-the-badge&logo=npm&color=cb3837" alt="npm"></a>
  <a href="https://github.com/AVIDS2/memorix/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/AVIDS2/memorix/ci.yml?style=for-the-badge&label=CI&logo=github" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache%202.0-2563eb?style=for-the-badge" alt="license"></a>
  <a href="https://github.com/AVIDS2/memorix"><img src="https://img.shields.io/github/stars/AVIDS2/memorix?style=for-the-badge&logo=github&color=facc15" alt="stars"></a>
</p>

<p align="center">
  <strong>Shared Project Memory</strong> | <strong>MCP</strong> | <strong>Git Memory</strong> | <strong>Reasoning Memory</strong> | <strong>Plugins</strong> | <strong>Orchestration</strong>
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

Memorix gives the AI coding agents you already use a shared, searchable project memory that survives new chats, IDE switches, terminal sessions, and handoffs. The memory lives under the Git project, not inside one chat window or one tool.

Use Claude Code today, Codex tomorrow, Cursor in the afternoon, and memcode when you want a native terminal agent — they all read and write the same project memory.

**Reach for Memorix when** you keep re-explaining the same project to a fresh agent: a new session lost what the last one figured out, a teammate's IDE can't see what yours learned, or a design decision is buried in a chat you can't find anymore.

| Problem | What Memorix adds |
| --- | --- |
| The next session forgets what the last session learned | Project-scoped memory, session summaries, timelines, and detail retrieval |
| Different agents know different things | One local memory pool shared through MCP, hooks, CLI, SDK, and memcode |
| Git records what changed, but agents cannot recall it well | Git Memory turns commits into searchable engineering facts |
| Architecture decisions disappear into old chats | Reasoning Memory stores why choices were made, with alternatives and trade-offs |
| Static rule files drift | Gotchas, fixes, and project skills evolve from real work |
| Parallel agent work gets messy | `memorix orchestrate` coordinates task context, handoffs, locks, verification, and review loops |

Memorix is local-first. SQLite is the canonical store, Orama handles search, and LLM-backed formation/embedding is optional. Without model keys, Memorix still works with local full-text retrieval.

<h2 id="works-with-your-agent"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/tags/light/section-agents.svg"><img src="assets/tags/section-agents.svg" alt="Works with every agent" height="32" /></picture></h2>

Memorix meets each agent through the integration surfaces that agent already understands: plugin packages, MCP servers, project rules, hooks, skills, or a first-party terminal agent. `memorix setup` installs the best available package for the target host and keeps stdio MCP as the default transport.

<table>
<tr>
<td align="center" width="12.5%">
<a href="https://claude.com/product/claude-code"><img src="https://github.com/anthropics.png?size=120" alt="Claude Code" width="48" height="48"></a><br>
<strong>Claude Code</strong><br>
<sub>official plugin + MCP + hooks + skills</sub>
</td>
<td align="center" width="12.5%">
<a href="https://github.com/openai/codex"><img src="https://github.com/openai.png?size=120" alt="Codex CLI" width="48" height="48"></a><br>
<strong>Codex CLI</strong><br>
<sub>official plugin + MCP + AGENTS.md</sub>
</td>
<td align="center" width="12.5%">
<a href="https://github.com/features/copilot"><img src="https://github.githubassets.com/images/modules/site/copilot/copilot.png" alt="GitHub Copilot CLI" width="48" height="48"></a><br>
<strong>GitHub Copilot CLI</strong><br>
<sub>plugin + MCP + hooks + skills</sub>
</td>
<td align="center" width="12.5%">
<a href="https://cursor.com"><picture><source media="(prefers-color-scheme: dark)" srcset="https://svgl.app/library/cursor_dark.svg"><img src="https://svgl.app/library/cursor_light.svg" alt="Cursor" width="48" height="48"></picture></a><br>
<strong>Cursor</strong><br>
<sub>MCP + rules + skills</sub>
</td>
<td align="center" width="12.5%">
<a href="https://windsurf.com"><picture><source media="(prefers-color-scheme: dark)" srcset="https://svgl.app/library/windsurf-dark.svg"><img src="https://svgl.app/library/windsurf-light.svg" alt="Windsurf" width="48" height="48"></picture></a><br>
<strong>Windsurf</strong><br>
<sub>MCP + rules + hooks</sub>
</td>
<td align="center" width="12.5%">
<a href="https://github.com/google-gemini/gemini-cli"><img src="https://github.com/google-gemini.png?size=120" alt="Gemini CLI" width="48" height="48"></a><br>
<strong>Gemini CLI</strong><br>
<sub>extension + MCP + GEMINI.md</sub>
</td>
</tr>
<tr>
<td align="center" width="12.5%">
<a href="https://github.com/opencode-ai/opencode"><picture><source media="(prefers-color-scheme: dark)" srcset="https://svgl.app/library/opencode-dark.svg"><img src="https://svgl.app/library/opencode.svg" alt="OpenCode" width="48" height="48"></picture></a><br>
<strong>OpenCode</strong><br>
<sub>local plugin + MCP + skills + AGENTS.md</sub>
</td>
<td align="center" width="12.5%">
<a href="https://pi.dev"><img src="https://pi.dev/favicon.svg" alt="pi coding agent" width="48" height="48"></a><br>
<strong>pi coding agent</strong><br>
<sub>package + extension + skill</sub>
</td>
<td align="center" width="12.5%">
<a href="https://kiro.dev"><img src="https://kiro.dev/icon.svg" alt="Kiro" width="48" height="48"></a><br>
<strong>Kiro</strong><br>
<sub>MCP + steering + hooks</sub>
</td>
<td align="center" width="12.5%">
<a href="https://antigravity.google"><img src="https://antigravity.google/favicon.ico" alt="Antigravity" width="48" height="48"></a><br>
<strong>Antigravity</strong><br>
<sub>MCP + GEMINI.md</sub>
</td>
<td align="center" width="12.5%">
<a href="https://www.trae.ai"><img src="https://github.com/Trae-AI.png?size=120" alt="Trae" width="48" height="48"></a><br>
<strong>Trae</strong><br>
<sub>MCP + project rules</sub>
</td>
<td align="center" width="12.5%">
<img src="https://raw.githubusercontent.com/AVIDS2/memorix/main/assets/logo.png" alt="memcode" width="48" height="48"><br>
<strong>memcode</strong><br>
<sub>first-party terminal agent</sub>
</td>
<td align="center" width="12.5%">
<a href="https://modelcontextprotocol.io"><img src="https://github.com/modelcontextprotocol.png?size=120" alt="Any MCP Client" width="48" height="48"></a><br>
<strong>Any MCP Client</strong><br>
<sub>stdio or HTTP MCP</sub>
</td>
</tr>
</table>

<p align="center">
  <sub>Works with agents that speak MCP, expose hooks/rules, or support plugin/package entries. One local-first memory layer shared across all of them.</sub>
</p>

Integration surfaces:

| Surface | What it does | Memorix entry |
| --- | --- | --- |
| Setup package | Installs the host's best Memorix integration in one step | `memorix setup --agent <agent>` |
| MCP | Gives an agent Memorix tools for search, detail retrieval, storage, reasoning, and coordination | bundled in setup packages or `memorix serve` |
| Project instructions | Teaches an agent when and how to use Memorix without forcing memory lookup on every prompt | bundled or generated by `memorix setup` |
| Hooks | Captures useful prompts, tool events, file edits, and session lifecycle events where the host exposes hooks | bundled or generated by `memorix setup` |
| Plugin package | Installs host-native plugin files for plugin-capable clients | Claude Code, Codex, GitHub Copilot CLI |
| Package or extension | Installs host-native package files where the host uses packages or extensions | Pi, Gemini CLI |
| Local project plugin | Installs project-local plugin files where the host loads them directly | OpenCode |
| MCP/rules package | Writes MCP, rules, steering, guidance, or hook config for IDEs and agents that expose those surfaces | Cursor, Windsurf, Kiro, Antigravity, Trae |
| Skills | Turns durable project knowledge into reusable task guidance | `memorix skills` and `memorix_promote` |
| memcode | Opens the bundled terminal agent that uses Memorix memory natively | `memorix` or `memcode` |

See [Integration Surfaces](docs/INTEGRATIONS.md) for the current support matrix and what each generated file means.

CLI, MCP, and HTTP are different entry points:

- `memorix` CLI is the operator surface for install, setup, memory search/store, Git Memory, import/export, dashboard, orchestration, diagnostics, and automation.
- `memorix serve` is the stdio MCP bridge used by IDEs and coding agents.
- `memorix background start` / `memorix serve-http` run the advanced HTTP control plane for a shared endpoint, dashboard, Docker, or multiple clients.

## Install

Requirements:

- Node.js `>=22.19.0`
- Git, because project identity is derived from the real Git root

Install and initialize:

```bash
npm install -g memorix
cd your-git-repo
memorix init
memorix setup --list
memorix setup --agent claude   # or codex, copilot, cursor, pi, gemini-cli, ...
```

`memorix init` creates or updates TOML configuration:

- `~/.memorix/config.toml` for global defaults
- `<git-root>/memorix.toml` for optional project overrides

Legacy `memorix.yml`, `.env`, and `~/.memorix/config.json` are still read for compatibility, but new setup flows use TOML.

## Quick Start

### Add memory to an existing agent

Use the setup command first. It installs the best available integration for the target host:

```bash
memorix setup --agent claude
memorix setup --agent codex
memorix setup --agent copilot
memorix setup --agent cursor
memorix setup --agent pi
memorix setup --agent gemini-cli
memorix setup --agent opencode
```

What it installs:

- Claude Code: local marketplace plugin with MCP, hooks, and skills, plus `CLAUDE.md` guidance.
- Codex: local Personal marketplace plugin with MCP, hooks, and skills, plus `AGENTS.md` guidance.
- GitHub Copilot CLI: Copilot CLI plugin package with MCP, hooks, and official Memorix skills.
- Pi: project-local Pi package with a Memorix extension and official skills, registered with `pi install`.
- Cursor: MCP config, Cursor rules, skills, and hook guidance through Cursor's project config surfaces.
- Gemini CLI: extension package with MCP and `GEMINI.md` context.
- OpenCode: local plugin file, `opencode.json` MCP config, OpenCode skills, plus `AGENTS.md` guidance.
- Windsurf, Kiro, Antigravity, Trae: MCP/rules/hooks files according to host support.

If your agent only needs a manual MCP entry, use stdio:

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

HTTP is not required for normal setup. Use it only when you intentionally want a shared background control plane, dashboard, Docker, or multiple clients using the same endpoint:

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
| Install an agent integration package | `memorix setup --agent <agent>` |
| Manually expose stdio MCP | `memorix serve` |
| Run shared HTTP MCP plus dashboard | `memorix background start` |
| Debug HTTP MCP in the foreground | `memorix serve-http --port 3211` |
| Inspect or manage memory directly | `memorix memory`, `memorix reasoning`, `memorix session`, `memorix ingest` |
| Use the bundled first-party memagent | `memorix` or `memcode` |
| Run orchestrated subagent work | `memorix orchestrate --goal "..."` |

## memcode: First-Party Memagent

memcode is the bundled terminal memagent for Memorix. It can read, edit, run commands, resume sessions, switch models, and expose `/memory` commands — reading and writing the same project memory pool used by Claude Code, Codex, Cursor, Windsurf, and other agents connected through Memorix MCP.

Use it when you want a terminal agent that has memory out of the box, or when you'd rather not wire an extra MCP server into your existing IDE.

```text
one Git project -> one shared Memorix memory pool
```

See [docs/MEMCODE.md](docs/MEMCODE.md) for the memcode-specific guide.

## Configuration

Minimal `~/.memorix/config.toml`:

```toml
[agent]
provider = "openai"
model = "gpt-4o"
api_key = "..."

[memory.llm]
provider = "openai"
model = "gpt-4o-mini"
api_key = "..."

[embedding]
provider = "auto"

[memory]
inject = "minimal"
formation = "active"
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

## Docs

| Start here | Use when |
| --- | --- |
| [Docs Map](docs/README.md) | You want the shortest route to the right guide |
| [Setup Guide](docs/SETUP.md) | Installing, using `memorix setup`, choosing stdio vs HTTP |
| [Integration Surfaces](docs/INTEGRATIONS.md) | Plugin packages, MCP, project rules, hooks, and skills support |
| [Configuration](docs/CONFIGURATION.md) | TOML config, model lanes, compatibility files |
| [API Reference](docs/API_REFERENCE.md) | MCP tools and operator CLI |
| [Git Memory](docs/GIT_MEMORY.md) | Commit ingestion and searchable engineering truth |
| [Docker](docs/DOCKER.md) | Containerized HTTP control plane |
| [memcode](docs/MEMCODE.md) | Using the bundled first-party memagent |
| [Agent Operator Playbook](docs/AGENT_OPERATOR_PLAYBOOK.md) | AI-facing execution guide for install, binding, hooks, and troubleshooting |
| [Development](docs/DEVELOPMENT.md) | Contributing, testing, release checks |
| [Changelog](CHANGELOG.md) | What changed in each release |

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
