# Memorix Configuration Guide

Memorix now uses one primary product configuration model:

- global defaults: `~/.memorix/config.toml`
- project overrides: `<git-root>/memorix.toml`

The project file is loaded only after Memorix has resolved the real project root
from `.git`. Config files do not decide project identity.

Legacy `memorix.yml`, `.env`, and `~/.memorix/config.json` files are still read
for compatibility, but new setup flows and docs use TOML.

---

## Minimal Example

Run:

```bash
memorix init
```

The init wizard lets you choose:

- `Global defaults` for personal multi-project workflows
- `Project config` for repo-specific overrides

Example `~/.memorix/config.toml`:

```toml
[agent]
provider = "deepseek"
model = "deepseek-chat"
base_url = "https://api.deepseek.com/v1"
api_key = "..."

[memory.llm]
provider = "openai"
model = "qwen3.5-flash"
base_url = "https://dashscope.aliyuncs.com/compatible-mode/v1"
api_key = "..."

[embedding]
provider = "api"
model = "text-embedding-v4"
base_url = "https://dashscope.aliyuncs.com/compatible-mode/v1"
api_key = "..."

[memory]
inject = "minimal"
formation = "active"
auto_cleanup = true

[server]
transport = "stdio"
dashboard = true
dashboard_port = 3210
```

Global `config.toml` is local to your machine and is the normal place to keep
provider credentials. Project `memorix.toml` should be treated as repo config:
override models, switches, and behavior there, but do not commit credentials.

---

## Resolution Order

Memorix resolves configuration in this order:

1. explicit CLI flags
2. process environment variables
3. project `<git-root>/memorix.toml`
4. global `~/.memorix/config.toml`
5. legacy compatibility files
6. built-in defaults

Environment variables stay available for CI, MCP launchers, and temporary shell
overrides. They are not the default user-facing setup path.

If you want the simplest setup, configure `~/.memorix/config.toml` once and stop
there. Add `<git-root>/memorix.toml` only when a repository needs different
models, memory behavior, or server defaults.

---

## Configuration Lanes

### `[agent]`

Used by memcode's interactive coding agent.

Common keys:

- `provider`
- `model`
- `base_url`
- `api_key`

This lane follows memcode's agent runtime behavior. `/model`, `/login`, and
agent auth storage still own interactive model switching and login state.
When `[agent]` is omitted, memcode falls back to `[memory.llm]` defaults without
changing its interactive model commands.

### `[memory.llm]`

Used by Memorix background memory intelligence:

- memory formation
- summarization
- deduplication
- optional reranking
- cleanup assistance

Common keys:

- `provider`
- `model`
- `base_url`
- `api_key`

For OpenAI-compatible providers such as DashScope, DeepSeek-compatible gateways,
or internal model gateways, use `provider = "openai"` and set `base_url`.

### `[embedding]`

Used by semantic/vector search. This lane is intentionally separate from
`[agent]` and `[memory.llm]`.

Common keys:

- `provider`
- `model`
- `base_url`
- `api_key`
- `dimensions`

Provider values:

- `off`
- `api`
- `auto`
- `fastembed`
- `transformers`

If embedding is unavailable, Memorix falls back to BM25/full-text search.

### `[memory]`

Runtime memory behavior.

Common keys:

- `inject = "minimal"` (`full`, `minimal`, `silent`)
- `formation = "active"` (`active`, `shadow`, `fallback`)
- `auto_cleanup = true`

### `[server]`

Server and dashboard behavior.

Common keys:

- `transport = "stdio"`
- `port = 37850`
- `dashboard = true`
- `dashboard_port = 3210`

---

## Compatibility

These files are still read when TOML is absent or incomplete:

- project `memorix.yml`
- user `~/.memorix/memorix.yml`
- project `.env`
- user `~/.memorix/.env`
- legacy `~/.memorix/config.json`

New commands should create TOML. Existing users do not need to migrate
immediately.

Useful commands:

```bash
memorix config path
memorix config get agent.model
memorix status
```

To create one global file from existing local settings:

```bash
memorix config migrate --global
```

To create a project override file without writing local credentials:

```bash
memorix config migrate
```

`memorix status` shows the active project, search mode, and resolved
configuration lanes with sensitive values redacted.
