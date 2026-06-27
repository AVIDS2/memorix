# Integration Surfaces

Memorix is a shared project memory layer. Agents connect through the interfaces they already support: plugin packages, MCP, project instructions, hooks, skills, or the bundled memcode terminal agent.

For most users, start with:

```bash
memorix setup --agent <agent> --global
```

That command installs the recommended Memorix package or config for the target agent. Manual `integrate`, `hooks`, and raw MCP config remain available when you need a fallback setup.

---

## What Gets Installed

| Surface | User-facing purpose | Typical install path |
| --- | --- | --- |
| Plugin or bundle package | Bundles Memorix MCP, skills, hooks, commands, and usage guidance where the agent supports plugins or compatible bundles | `memorix setup --agent claude --global`, `codex --global`, `copilot --global`, `antigravity --global`, `openclaw --global`, or `hermes --global` |
| Package or extension | Bundles Memorix for agents that use package or extension systems | `memorix setup --agent pi --global`, `omp --global`, or `gemini-cli --global` |
| Local plugin | Installs a local plugin file where the agent loads plugins directly | `memorix setup --agent opencode --global` |
| MCP server | Gives an agent live tools for search, recall, storage, reasoning, and coordination | bundled by setup, host MCP config, or `memorix serve` |
| Usage guidance | Tells the agent when and how to use memory | `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, Cursor/Windsurf/Kiro/Trae rules |
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
- `--global` writes user-level plugin, config, and hook surfaces where the host supports them.
- Running the same setup command without `--global` is the repo-local path for one project only.
- Hooks are only global where the host provides a global hook surface. If the host only supports project hooks, Memorix uses that project scope instead.

---

## Agent Support Matrix

| Agent | Recommended install | Official entry | What gets installed | Notes |
| --- | --- | --- | --- | --- |
| Claude Code | `memorix setup --agent claude --global` | Claude Code plugin marketplace | Local `memorix-local` marketplace, plugin-bundled stdio MCP, skills, hooks, plus `CLAUDE.md` guidance | Setup attempts `claude plugin marketplace add` and `claude plugin install memorix@memorix-local`. |
| Codex | `memorix setup --agent codex --global` | Codex Personal marketplace plugin | Local plugin under `~/.codex/plugins/memorix`, Personal marketplace entry, plugin-bundled stdio MCP, skills, hooks, plus `AGENTS.md` guidance | Setup attempts `codex plugin add memorix@personal`. |
| GitHub Copilot CLI | `memorix setup --agent copilot --global` | Copilot CLI plugin package | Local plugin under `~/.copilot/plugins/local/memorix` with MCP, skills, and hooks | Setup attempts `copilot plugin install <local-path>` when Copilot CLI is available. |
| Cursor | `memorix setup --agent cursor --global` | Cursor MCP and rules config | Cursor MCP config, `.cursor/rules/memorix.mdc`, skills, and hook guidance | Reload Cursor after setup so it can pick up project config changes. |
| Gemini CLI | `memorix setup --agent gemini-cli --global` | Gemini CLI extension | Extension under `~/.gemini/extensions/memorix` with MCP, `GEMINI.md` context, hooks, commands, and skills | Antigravity CLI has an official Gemini CLI migration path, but Gemini CLI remains an active standalone Google CLI target. |
| OpenCode | `memorix setup --agent opencode --global` | OpenCode local plugin file | Global setup writes `~/.config/opencode/plugins/memorix.js`, `~/.config/opencode/opencode.json`, skills, and `AGENTS.md` guidance; repo-local setup writes the `.opencode/` equivalents. | OpenCode loads local plugin and skill files from its config scope. |
| OpenClaw | `memorix setup --agent openclaw --global` | OpenClaw compatible bundle | `~/.openclaw/extensions/memorix` with `.mcp.json`, skills, and OpenClaw `HOOK.md`/`handler.ts` hook pack | Setup attempts `openclaw plugins install <path> --force` and `openclaw hooks enable memorix` when OpenClaw is available. |
| Hermes Agent | `memorix setup --agent hermes --global` | Hermes plugin | Hermes home (`%LOCALAPPDATA%\hermes` on native Windows, `~/.hermes` elsewhere, or `HERMES_HOME`), plugin enablement in `config.yaml`, and `mcp_servers.memorix` | The plugin registers hooks, a slash command, a CLI command, and skills through Hermes' plugin context. Existing YAML keys are preserved. |
| Oh-my-Pi | `memorix setup --agent omp --global` | Oh-my-Pi `omp.extensions` package | `.omp/packages/memorix` or `~/.omp/agent/packages/memorix`, plus `.omp/mcp.json` or `~/.omp/agent/mcp.json` | Setup attempts `omp plugin link <path>`. This target uses Oh-my-Pi's package/extension manifest, not Pi's legacy package manifest. |
| Pi | `memorix setup --agent pi --global` | Pi package | User Pi package with extension and official skills, registered through `pi install <path> --approve` | Run without `--global` only when you want a project-local Pi package. Pi currently does not need a separate Memorix MCP config lane. |
| Windsurf | `memorix setup --agent windsurf --global` | Windsurf MCP/rules/hooks config | stdio MCP config, `.windsurf/rules/memorix.md`, hook config | Uses Windsurf's current config surfaces. |
| Kiro | `memorix setup --agent kiro --global` | Kiro MCP/steering/hooks config | MCP config, `.kiro/steering/memorix.md`, `.kiro/hooks/*.kiro.hook` | Uses Kiro steering and hook files. |
| Antigravity | `memorix setup --agent antigravity --global` | Antigravity plugin | Plugin under `~/.gemini/config/plugins/memorix` or `.agents/plugins/memorix`, with `plugin.json`, `mcp_config.json`, `hooks.json`, rules, and skills | Uses Antigravity's official plugin layout. Dedicated MCP configs live at `~/.gemini/config/mcp_config.json` or `.agents/mcp_config.json`; legacy Gemini settings are read only for compatibility. |
| Trae | `memorix setup --agent trae --global` | Trae MCP/rules config | MCP config and `.trae/rules/project_rules.md` | Current support is MCP plus project rules. |
| memcode | `memorix` or `memcode` | Bundled terminal agent | Built-in Memorix memory access | memcode uses the same project memory pool; it is not a separate memory silo. |
| Any MCP client | Manual MCP config | MCP stdio or HTTP | `memorix serve` or `memorix background start` | Use stdio first unless you need a shared HTTP endpoint. |

---

## One-Command Setup

Install Memorix:

```bash
npm install -g memorix
memorix init --global
```

Then install the agent integration you use:

```bash
memorix setup --agent claude --global
memorix setup --agent codex --global
memorix setup --agent copilot --global
memorix setup --agent cursor --global
memorix setup --agent pi --global
memorix setup --agent gemini-cli --global
memorix setup --agent opencode --global
memorix setup --agent openclaw --global
memorix setup --agent hermes --global
memorix setup --agent omp --global
```

Use `memorix setup --agent all --global` only when you intentionally want every supported agent integration generated for the current machine/user scope.

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
memorix setup --agent openclaw --global
memorix setup --agent hermes --global
memorix setup --agent omp --global
memorix hooks install --agent cursor
memorix hooks install --agent opencode
```

Use them when you do not want the full setup package, or when you are updating one generated integration file by hand.

`memorix integrate --agent <agent>` writes usage guidance and MCP settings where supported. `memorix setup --agent openclaw|hermes|omp` installs the official package or plugin entry that those hosts expose, plus MCP config where needed. `memorix hooks install --agent <agent>` installs fallback automatic capture only where the agent exposes standalone hook files; package-owned hooks stay managed by `memorix setup`.

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
