# Integration Surfaces

Memorix is a shared project memory layer. Agents connect through the interfaces they already support: plugin packages, MCP, project instructions, hooks, skills, or the bundled memcode terminal agent.

For most users, start with:

```bash
memorix setup --agent <agent>
```

That command installs the recommended Memorix package or config for the target agent. Manual `integrate`, `hooks`, and raw MCP config remain available when you need a fallback setup.

---

## What Gets Installed

| Surface | User-facing purpose | Typical install path |
| --- | --- | --- |
| Plugin package | Bundles Memorix MCP, skills, hooks, and usage guidance where the agent supports plugins | `memorix setup --agent claude`, `codex`, or `copilot` |
| Package or extension | Bundles Memorix for agents that use package or extension systems | `memorix setup --agent pi` or `gemini-cli` |
| Project plugin | Installs a plugin file where the agent loads project plugins directly | `memorix setup --agent opencode` |
| MCP server | Gives an agent live tools for search, recall, storage, reasoning, and coordination | bundled by setup or `memorix serve` |
| Project guidance | Tells the agent when and how to use memory | `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, Cursor/Windsurf/Kiro/Trae rules |
| Hooks | Captures useful session events when the agent exposes hook events | bundled by plugin packages or generated hook files |
| Skills | Turns durable project knowledge into reusable task guidance | plugin skills, `memorix skills`, `memorix_promote` |
| memcode | Opens a terminal coding agent that already uses Memorix memory | `memorix`, `memcode` |
| HTTP service | Runs one shared MCP endpoint plus dashboard | `memorix background start` |

HTTP is not required for normal agent setup. Use it when you intentionally want a shared background process, dashboard, Docker deployment, or multiple clients using the same MCP endpoint.

CLI, MCP, and HTTP have separate jobs:

- CLI is the direct command surface. Use it for setup, diagnostics, memory operations, Git Memory, import/export, dashboard commands, and orchestration.
- Stdio MCP is the normal agent/IDE bridge. It gives the agent live Memorix tools by launching `memorix serve`.
- HTTP MCP is the shared service bridge. Use it for one endpoint shared by multiple clients, dashboard, Docker, or supervised foreground debugging.

Generated guidance also has scope:

- Project guidance (`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, Cursor/Windsurf/Kiro/Trae rules) may say the repository is configured for Memorix.
- Plugin or skill package guidance is workspace-safe. It says to use Memorix when the active workspace has Memorix tools available.

---

## Agent Support Matrix

| Agent | Recommended install | Official entry | What gets installed | Notes |
| --- | --- | --- | --- | --- |
| Claude Code | `memorix setup --agent claude` | Claude Code plugin marketplace | Local `memorix-local` marketplace, plugin-bundled stdio MCP, skills, hooks, plus `CLAUDE.md` guidance | Setup attempts `claude plugin marketplace add` and `claude plugin install memorix@memorix-local`. |
| Codex | `memorix setup --agent codex` | Codex Personal marketplace plugin | Local plugin under `~/.codex/plugins/memorix`, Personal marketplace entry, plugin-bundled stdio MCP, skills, hooks, plus `AGENTS.md` guidance | Setup attempts `codex plugin add memorix@personal`. |
| GitHub Copilot CLI | `memorix setup --agent copilot` | Copilot CLI plugin package | Local plugin under `~/.copilot/plugins/local/memorix` with MCP, skills, and hooks | Setup attempts `copilot plugin install <local-path>` when Copilot CLI is available. |
| Cursor | `memorix setup --agent cursor` | Cursor MCP and rules config | Cursor MCP config, `.cursor/rules/memorix.mdc`, skills, and hook guidance | Reload Cursor after setup so it can pick up project config changes. |
| Gemini CLI | `memorix setup --agent gemini-cli` | Gemini CLI extension | Extension under `~/.gemini/extensions/memorix` with MCP and `GEMINI.md` context | Gemini CLI remains supported; Antigravity is the newer Google agent lane. |
| OpenCode | `memorix setup --agent opencode` | OpenCode local plugin file | `.opencode/plugins/memorix.js`, `opencode.json` MCP config, `.opencode/skills/*/SKILL.md`, plus `AGENTS.md` guidance | OpenCode loads project local plugin and skill files from `.opencode/`. |
| Pi | `memorix setup --agent pi` | Pi package | Project `.pi/packages/memorix` package with extension and official skills, registered through `pi install <path> -l --approve` | Pi package resources can be checked with `pi config --approve`. Pi currently does not need a separate Memorix MCP config lane. |
| Windsurf | `memorix setup --agent windsurf` | Windsurf MCP/rules/hooks config | stdio MCP config, `.windsurf/rules/memorix.md`, hook config | Uses Windsurf's current config surfaces. |
| Kiro | `memorix setup --agent kiro` | Kiro MCP/steering/hooks config | MCP config, `.kiro/steering/memorix.md`, `.kiro/hooks/*.kiro.hook` | Uses Kiro steering and hook files. |
| Antigravity | `memorix setup --agent antigravity` | Antigravity MCP/context/hooks config | MCP config, `GEMINI.md`, Gemini-style hook config | Uses Gemini-compatible project context. |
| Trae | `memorix setup --agent trae` | Trae MCP/rules config | MCP config and `.trae/rules/project_rules.md` | Current support is MCP plus project rules. |
| memcode | `memorix` or `memcode` | Bundled terminal agent | Built-in Memorix memory access | memcode uses the same project memory pool; it is not a separate memory silo. |
| Any MCP client | Manual MCP config | MCP stdio or HTTP | `memorix serve` or `memorix background start` | Use stdio first unless you need a shared HTTP endpoint. |

---

## One-Command Setup

Install Memorix:

```bash
npm install -g memorix
cd your-git-repo
memorix init
```

Then install the agent integration:

```bash
memorix setup --agent claude
memorix setup --agent codex
memorix setup --agent copilot
memorix setup --agent cursor
memorix setup --agent pi
memorix setup --agent gemini-cli
memorix setup --agent opencode
```

Use `memorix setup --agent all` only when you intentionally want every supported agent integration generated for the current machine/repo.

---

## Manual MCP Fallback

If an agent only needs a raw stdio MCP entry:

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

Avoid `npx` in persistent MCP configs. Use the globally installed `memorix` binary so startup is predictable.

For HTTP mode:

```bash
memorix background start
```

Endpoint:

```text
http://localhost:3211/mcp
```

In HTTP mode, bind each project session with `memorix_session_start(projectRoot=...)` when the client can provide the workspace path.

---

## Manual Generation Commands

These commands remain useful for controlled fallback setups:

```bash
memorix integrate --agent cursor
memorix integrate --agent gemini-cli
memorix hooks install --agent cursor
memorix hooks install --agent opencode
```

Use them when you do not want the full setup package, or when you are updating one generated integration file by hand.

`memorix integrate --agent <agent>` writes project guidance and MCP settings where supported. `memorix hooks install --agent <agent>` installs automatic capture where the agent exposes hook events.

Shared files such as `AGENTS.md`, `CLAUDE.md`, and `GEMINI.md` are appended or updated carefully so existing project instructions are not replaced wholesale.

---

## Skills And Project Knowledge

Memorix ships an official skill set for agents that support skills:

- `memorix-memory`
- `memorix-reasoning`
- `memorix-sessions`
- `memorix-git-memory`
- `memorix-mini-skills`
- `memorix-orchestrate`
- `memorix-troubleshooting`

These skills are operational guidance for agents: when to search, when to store, when to use CLI fallbacks, when Git Memory is evidence, and when orchestration coordination is appropriate.

Memorix can also promote durable observations into reusable mini-skills. Use this when a project pattern, gotcha, or workflow should become guidance that agents can rediscover later.

Useful commands and tools:

```bash
memorix skills
```

MCP tools:

- `memorix_skills`
- `memorix_promote`
- `memorix_rules_sync`

Plugin and package integrations include the official Memorix skill set where the agent supports skills.

---

## What Memorix Provides

Memorix does three things:

1. Stores project memory locally and makes it searchable.
2. Exposes that memory through plugin packages, MCP, CLI, SDK, hooks, rules, and skills.
3. Provides memcode as a bundled terminal agent for users who want a Memorix-powered coding session in the terminal.

Different agents expose different extension points. When an agent supports plugins, Memorix uses plugins. When it uses rules or instruction files, Memorix writes those. When it only speaks MCP, MCP is the integration.
