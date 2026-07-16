# Memorix Configuration Guide

Memorix uses TOML as its main configuration model:

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
sync_advisory = true

[git]
auto_hook = false
ingest_on_commit = true
max_diff_size = 500
skip_merge_commits = true
exclude_patterns = ["*.lock", "dist/**"]
noise_keywords = ["format", "typo"]

[codegraph]
exclude_patterns = ["vendor/**", "third_party/**", "generated/**"]
max_file_bytes = 2097152

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
`transformers` is installed as an optional dependency. `fastembed` remains a
supported local provider, but it is no longer installed by default; install it
explicitly in the project or global prefix where Memorix runs if you choose that
provider.

OpenRouter embeddings can use the official OpenRouter environment variable:

```toml
[embedding]
provider = "api"
model = "qwen/qwen3-embedding-8b"
base_url = "https://openrouter.ai/api/v1"
```

Then set `OPENROUTER_API_KEY` in your shell, user environment, or `.env`. You
can still set `MEMORIX_EMBEDDING_API_KEY` when you want an explicit embedding
key override; it takes priority over `OPENROUTER_API_KEY`.

### `[memory]`

Runtime memory behavior.

Common keys:

- `inject = "minimal"` (`full`, `minimal`, `silent`)
- `formation = "active"` (`active`, `shadow`, `fallback`)
- `auto_cleanup = true`
- `sync_advisory = true`

The same values are available in legacy YAML under `behavior.*`. Existing
`~/.memorix/config.json` behavior settings are retained only as a fallback for
older installs.

### `[git]`

Git-memory and hook behavior.

Common keys:

- `auto_hook = false`
- `ingest_on_commit = true`
- `max_diff_size = 500`
- `skip_merge_commits = true`
- `exclude_patterns = ["*.lock", "dist/**"]`
- `noise_keywords = ["format", "typo"]` (literal phrases, case-insensitive)

Project identity is still resolved from the real `.git` root. A project
`memorix.toml` is an override file under that root; it does not create or rename
the Memorix project ID.

### `[codegraph]`

CodeGraph Memory and Project Context scan limits.

Common keys:

- `exclude_patterns = ["vendor/**", "third_party/**", "generated/**"]`
- `max_file_bytes = 2097152` (2 MiB per source file by default)

Legacy YAML uses `codegraph.excludePatterns` and `codegraph.maxFileBytes` for
the same settings.

These patterns extend Memorix's built-in CodeGraph excludes (`node_modules`,
build outputs, worktrees, and similar generated directories). Matching paths are
skipped during CodeGraph indexing and hidden from Project Context / Context Pack
suggested reads. Files larger than `max_file_bytes` are also skipped so a
generated or minified source file cannot monopolize an incremental scan. Raise
the limit only for a repository where that file is intentional source.

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

- legacy project `memorix.yml`
- legacy user `~/.memorix/memorix.yml`
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
