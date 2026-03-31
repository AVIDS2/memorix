# Memorix Configuration Guide

Memorix is designed around one simple idea:

- `memorix.yml` controls behavior
- `.env` stores secrets

Everything else exists for compatibility or advanced overrides.

The recommended model is:

- keep your day-to-day defaults in `~/.memorix`
- add project files only when a repo needs overrides
- let project config override global defaults instead of treating every repo as a fresh setup

---

## Two Files, Two Roles

### `memorix.yml`

Use `memorix.yml` for structured project behavior:

- LLM provider and model defaults
- embedding mode
- Git-Memory settings
- session injection behavior
- server and dashboard settings
- team or hub-mode options

Default location:

- user defaults: `~/.memorix/memorix.yml`

Optional override location:

- project root: `./memorix.yml`

### `.env`

Use `.env` for secrets only:

- API keys
- base URLs
- provider tokens

Default location:

- user defaults: `~/.memorix/.env`

Optional override location:

- project root: `./.env`

---

## Resolution Order

### Behavior settings

For normal configuration values, Memorix resolves in this order:

1. environment variables
2. project `memorix.yml` overrides
3. user `~/.memorix/memorix.yml` defaults
4. legacy `~/.memorix/config.json`
5. hardcoded defaults

### Secrets

For secrets loaded through dotenv, Memorix resolves in this order:

1. system environment variables from the shell or MCP host config
2. project `.env` overrides
3. user `~/.memorix/.env` defaults

This means host-provided env vars always win.

---

## Minimal Example

If you want to initialize these files interactively, run:

```bash
memorix init
```

The init wizard now lets you choose between:

- `Global defaults` for personal multi-project workflows
- `Project config` for repo-specific overrides

`memorix.yml`

```yml
llm:
  provider: openai
  model: gpt-4o-mini

embedding:
  provider: off

git:
  autoHook: true
  ingestOnCommit: true
  skipMergeCommits: true

behavior:
  formationMode: active
  sessionInject: minimal

server:
  transport: stdio
  dashboard: true
```

`.env`

```bash
MEMORIX_LLM_API_KEY=sk-...
MEMORIX_EMBEDDING_API_KEY=sk-...
MEMORIX_LLM_BASE_URL=https://api.openai.com/v1
MEMORIX_EMBEDDING_BASE_URL=https://api.openai.com/v1
```

If you do not need LLM or embedding features yet, you can leave `.env` empty and Memorix will still work.

---

## Key Sections in `memorix.yml`

### `llm`

Used for optional LLM-enhanced behavior such as:

- formation quality uplift
- compression
- reranking
- smarter deduplication

Common keys:

- `provider`
- `model`
- `baseUrl`

### `embedding`

Controls semantic search mode.

Common values:

- `off`
- `api`
- `fastembed`
- `transformers`
- `auto`

`auto` now prefers a configured remote embedding API first.

- if `MEMORIX_EMBEDDING_API_KEY` or another supported API key is present, Memorix will use the remote `/v1/embeddings` provider first
- only if API embedding is unavailable will it fall back to local `fastembed`, then `transformers`
- this keeps semantic search on the API path by default while preserving local fallback behavior

When using API embeddings with optional dimension shortening:

- `MEMORIX_EMBEDDING_DIMENSIONS` is treated as part of the embedding configuration identity
- Memorix keeps API embedding cache entries and probed dimension metadata isolated per `baseUrl + model + requestedDimensions`
- changing from shortened dimensions back to native dimensions no longer reuses stale cached vectors or stale probe results

### `git`

Controls Git-Memory behavior.

Common keys:

- `autoHook`
- `ingestOnCommit`
- `maxDiffSize`
- `skipMergeCommits`
- `excludePatterns`
- `noiseKeywords`

### `behavior`

Controls runtime behavior.

Common keys:

- `sessionInject`
- `syncAdvisory`
- `autoCleanup`
- `formationMode`

### `server`

Controls transport and dashboard behavior.

Common keys:

- `transport`
- `port`
- `dashboard`
- `dashboardPort`

---

## Diagnosing Active Config

Run:

```bash
memorix status
```

`memorix status` shows:

- which config files exist
- which `.env` files were loaded
- where important values came from
- whether env vars overrode YAML

This is the fastest way to debug “why is Memorix using this value?”

---

## Legacy Config

Memorix still supports:

- `~/.memorix/config.json`

This exists mainly for backward compatibility with older TUI-based configuration flows.

For new setups, prefer:

- `memorix.yml`
- `.env`

---

## Recommended Team Conventions

For most teams, keep it simple:

- keep your personal defaults in `~/.memorix/memorix.yml`
- commit `memorix.yml` only when the repo needs shared overrides
- do **not** commit `.env`
- reserve project-level config for shared behavior or repo-specific overrides

This gives you:

- reproducible project behavior
- local secret isolation
- cleaner onboarding for new contributors

---

## Related Docs

- [Setup Guide](SETUP.md)
- [Git Memory Guide](GIT_MEMORY.md)
- [Architecture](ARCHITECTURE.md)
- [Development Guide](DEVELOPMENT.md)
