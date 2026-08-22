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

# Optional HTTP rerank. Off unless provider = "http".
# [rerank]
# provider = "http"
# model = "rerank-model"
# base_url = "https://api.example.com/v1"

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

# Optional: use an already-indexed local CodeGraph only when it is healthy.
external_context = "auto"
# external_command = "C:\\tools\\codegraph.cmd"
external_timeout_ms = 1200

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
- optional LLM reranking fallback
- cleanup assistance

Common keys:

- `provider`
- `model`
- `base_url`
- `api_key`

For OpenAI-compatible providers such as DashScope, DeepSeek-compatible gateways,
or internal model gateways, use `provider = "openai"` and set `base_url`.
Memorix uses an explicit provider path as-is: for example,
`https://ark.cn-beijing.volces.com/api/v3` remains `/api/v3`. Only a bare host
without a versioned path receives the convenience suffix `/v1`.

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
`transformers` is no longer installed by default; install
`@huggingface/transformers` explicitly in the project or global prefix where
Memorix runs if you choose that provider. `fastembed` remains a supported local
provider and is likewise not installed by default.

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

When `base_url` points at OpenRouter and no `model` is configured, Memorix
defaults to `qwen/qwen3-embedding-8b` (4096 dimensions) instead of the
OpenAI-only default. The equivalent env-var form is
`MEMORIX_EMBEDDING=api`, `MEMORIX_EMBEDDING_BASE_URL=https://openrouter.ai/api/v1`,
`MEMORIX_EMBEDDING_MODEL=qwen/qwen3-embedding-8b`.

### `[rerank]`

Optional HTTP rerank for thorough search. Off by default.
When `provider = "http"`, Memorix POSTs a Cohere-compatible
`{model, query, documents}` body to `{base_url}/rerank` (or an explicit
`/rerank` path). Any compatible endpoint works — hosted APIs, TEI, vLLM,
or a local gateway. Memorix sends the configured `model` string unchanged.

Common keys:

- `provider` — `off` (default) or `http`
- `model` — user-configured model id (no built-in default). Example:
  `rerank-model`
- `base_url` — API root that serves `/rerank`, for example
  `https://api.example.com/v1` or `http://127.0.0.1:8080`. When unset and
  `provider = "http"`, Memorix inherits `[memory.llm].base_url`.
- `api_key` — bearer token. When unset, inherits the memory LLM key
  (`MEMORIX_LLM_API_KEY`, `MEMORIX_API_KEY`, or `[memory.llm].api_key`)
  only if the effective `base_url` is the same trusted endpoint as
  `[memory.llm].base_url`. A different rerank URL requires
  `MEMORIX_RERANK_API_KEY` or `rerank.api_key`.

Environment overrides (highest priority after CLI flags):

```bash
MEMORIX_RERANK_PROVIDER=http
MEMORIX_RERANK_MODEL=rerank-model
MEMORIX_RERANK_BASE_URL=https://api.example.com/v1
# MEMORIX_RERANK_API_KEY=   # required when base_url is not the memory LLM endpoint
```

If the memory LLM lane already points at the same gateway, you can enable
rerank with:

```toml
[rerank]
provider = "http"
model = "rerank-model"
```

or set `MEMORIX_RERANK_PROVIDER=http` and `MEMORIX_RERANK_MODEL=...`.
Timeout is `MEMORIX_RERANK_TIMEOUT_MS` (default 30000). Thorough search
with at least 3 candidates uses HTTP rerank when configured. On HTTP miss
or timeout, Memorix keeps the original order and does not fall through to
LLM rerank. LLM rerank remains available when HTTP rerank is off, on the
existing thorough/heavy/ambiguous gate.

Image analysis (visual description for ingested images) runs on the LLM lane
through an OpenAI-compatible vision endpoint, so it can also use OpenRouter
with a multimodal model — for example `qwen/qwen3-vl-8b-instruct` via
`MEMORIX_LLM_BASE_URL=https://openrouter.ai/api/v1` and
`MEMORIX_LLM_MODEL=qwen/qwen3-vl-8b-instruct`.

### Controlled MiniMax media

MiniMax generation is separate from the text embedding lane. Set one of these
outside Git only when you deliberately use image or video generation:

- `MINIMAX_API_KEY` for the global endpoint
- `MINIMAX_CN_API_KEY` for the China endpoint
- optional `MINIMAX_REGION=global|cn`
- optional image/video model and endpoint overrides for self-managed routing

The CLI is the normal generation path. `memorix_media` can import, attach, and
inspect assets through MCP, but MCP generation is off by default. Set
`MEMORIX_MCP_MEDIA_GENERATION=1` only after you intentionally allow an agent to
create provider-billed output. The default OpenRouter text embedder remains
text-only; Memorix produces a media vector only when a provider explicitly
declares compatibility with that media modality.

Controlled assets default to a 100 MiB import limit. Vision analysis has a
separate 20 MiB cap so a large local file can remain a usable asset without
creating an oversized chat-completions request.

### Controlled audio transcription

Audio-to-text is a separate, opt-in derivative lane. Set the matching provider
credential outside Git:

- `OPENAI_API_KEY` with `MEMORIX_TRANSCRIPTION_PROVIDER=openai`
- `GROQ_API_KEY` with `MEMORIX_TRANSCRIPTION_PROVIDER=groq`
- optional `MEMORIX_TRANSCRIPTION_MODEL=<provider model>`

The conservative source limit is 25 MiB. The CLI is enabled when a credential
is present; MCP-originated transcription remains disabled unless
`MEMORIX_MCP_MEDIA_TRANSCRIPTION=1` is set after reviewing provider billing.

### Controlled PDF text derivation

PDF text extraction is a separate, opt-in derivative lane with no provider
credentials. `memorix media derive-pdf --asset <asset-id>` parses the managed
PDF locally (bundled PDF.js via `unpdf`, system fonts disabled) and stores a
bounded text derivative with page and character limits (`--maxPages`,
`--maxChars`). The MCP `memorix_media` tool accepts `derive-pdf` with the same
bounds, and the derived text only enters normal memory when explicitly
attached.

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

Code State, CodeGraph Memory, and Project Context scan/provider settings.

Common keys:

- `exclude_patterns = ["vendor/**", "third_party/**", "generated/**"]`
- `max_file_bytes = 2097152` (2 MiB per source file by default)
- `external_context = "auto"` (`"off"` keeps the built-in Lite provider only)
- `external_command = "C:\\tools\\codegraph.cmd"` (optional path when CodeGraph is not on `PATH`)
- `external_timeout_ms = 1200` (bounded local semantic-query timeout)

Legacy YAML uses `codegraph.excludePatterns`, `codegraph.maxFileBytes`,
`codegraph.externalContext`, `codegraph.externalCommand`, and
`codegraph.externalTimeoutMs` for the same settings.

These patterns extend Memorix's built-in CodeGraph excludes (`node_modules`,
build outputs, worktrees, and similar generated directories). Matching paths are
skipped during CodeGraph indexing and hidden from Project Context / Context Pack
suggested reads. Files larger than `max_file_bytes` are also skipped so a
generated or minified source file cannot monopolize an incremental scan. Raise
the limit only for a repository where that file is intentional source.

`external_context = "auto"` is deliberately conservative. Memorix checks for
an already-initialized local `.codegraph` index and uses it only when its status
matches the current project and has no pending changes. It never runs
`codegraph init`, `index`, or `sync`, and it never sends repository content to
a remote service. A valid external response contributes only a small semantic
outline to the current task Workset; raw code is neither copied into the
Workset nor persisted as Memorix knowledge. See
[1.2 Provider Quality](1.2.0-PROVIDER-QUALITY.md) for the complete contract.

### `[server]`

Server and dashboard behavior.

Common keys:

- `transport = "stdio"` — advisory. An explicit `memorix serve-http` still
  runs on HTTP and prints a notice; this key documents the intended mode.
- `port = 3211` — default listener port for `memorix serve-http` when
  `--port` is not given.
- `dashboard = true`
- `dashboard_port = 3210` — default port for `memorix dashboard` when
  `--port` is not given.

### Reserved sections (parsed, not yet enforced)

These sections exist so future releases do not need a config format change.
Today no runtime behavior reads them; set them only as forward-looking notes.

- `[team]` (`enabled`, `workspace_collection`) — coordination defaults.
- `[hooks]` (`native_memcode`, `external_agents`) — hook bootstrap policy.
- The former `mcpServers` key in `memorix.yml` was removed: no code ever
  consumed it, and Memorix is not an MCP aggregator. Unknown keys are
  ignored, so old files keep loading.

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
