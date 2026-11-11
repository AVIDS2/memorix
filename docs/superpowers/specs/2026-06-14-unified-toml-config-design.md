# Unified TOML Configuration Design

## Goal

Memorix should feel like a product with one obvious place to configure it.
The public configuration surface should move to a Codex-style TOML model:

- global defaults: `~/.memorix/config.toml`
- project overrides: `<git-root>/memorix.toml`

The user should not need to understand a split between YAML, dotenv files,
legacy JSON, memcode settings, and environment variables before starting work.
Those compatibility layers may still exist internally, but they should not be
the primary product story.

## Product Principles

1. One main file for users to remember: `~/.memorix/config.toml`.
2. Project identity is still based on the nearest owning `.git` root only.
3. Project config is an override, not a project identity source.
4. Memcode keeps Pi-derived agent semantics for model selection, auth storage,
   slash commands, trust decisions, and extension loading.
5. Memorix-native memory, embedding, hooks, retention, and background LLM
   behavior are configured in the same TOML tree.
6. Environment variables remain advanced runtime overrides for CI, MCP hosts,
   and temporary shells, not the default user-facing setup path.

## User-Facing Files

### Global Config

`~/.memorix/config.toml`

This is the primary configuration file. It can hold provider credentials,
models, base URLs, memory behavior, embedding behavior, hooks, server settings,
and memcode defaults.

Example:

```toml
[agent]
provider = "deepseek"
model = "deepseek-chat"
base_url = "https://api.deepseek.com/v1"
api_key = "<configured-locally>"

[memory.llm]
provider = "deepseek"
model = "deepseek-chat"
base_url = "https://api.deepseek.com/v1"
api_key = "<configured-locally>"

[embedding]
provider = "dashscope"
model = "text-embedding-v4"
base_url = "https://dashscope.aliyuncs.com/compatible-mode/v1"
api_key = "<configured-locally>"

[memory]
formation = "active"
inject = "minimal"
auto_cleanup = true

[hooks]
native_memcode = true
external_agents = true

[server]
transport = "stdio"
dashboard = true
dashboard_port = 3210
```

### Project Override

`<git-root>/memorix.toml`

The project file is optional. It is loaded only after Memorix has already
resolved the canonical project root from `.git`.

Project config should be used for repo-specific behavior, such as:

- memory injection mode
- hook policy
- dashboard behavior
- agent model preference for this repository
- embedding mode for this repository

It must not influence project identity. This protects the existing Memorix
contract where the repository's `.git` identity is the only durable project
anchor.

## Compatibility Files

The following files remain supported during migration, but they are not the
primary product interface:

- `memorix.yml`
- `~/.memorix/memorix.yml`
- `~/.memorix/config.json`
- `~/.memorix/.env`
- project `.env`
- `~/.memorix/agent/settings.json`
- `<git-root>/.memorix/settings.json`

The CLI and documentation should describe these as compatibility or advanced
files. New setup flows should create or edit TOML.

## Resolution Order

For normal interactive use:

1. Explicit CLI flags.
2. Process environment variables.
3. Project `<git-root>/memorix.toml`.
4. Global `~/.memorix/config.toml`.
5. Legacy compatibility files.
6. Built-in defaults.

Environment variables stay above config so automation, MCP launchers, and CI
can override behavior without editing files. They should not be taught as the
default setup path.

## Configuration Lanes

The config tree keeps three provider lanes because they solve different product
problems.

### Agent Lane

TOML path: `[agent]`

Used by memcode's interactive coding agent. This lane must preserve the
Pi-derived runtime model:

- `/model` changes the active interactive model.
- `/login` and auth storage keep working.
- provider/model commands remain agent-runtime concepts.
- memcode must not silently replace this with memory LLM settings when an
  explicit agent config exists.

Legacy environment aliases in the `MEMORIX_AGENT_*` family and the older
`MEMORIX_AGENT_LLM_*` family remain supported during migration.

### Memory LLM Lane

TOML path: `[memory.llm]`

Used by background memory intelligence:

- formation
- classification
- summarization
- cleanup assistance
- optional reranking

This lane should be cheap, stable, and invisible during normal chat unless the
user asks for Memorix status.

Legacy environment aliases in the `MEMORIX_LLM_*` family remain supported, and
`MEMORIX_API_KEY` stays as the simple compatibility key for the memory lane.

### Embedding Lane

TOML path: `[embedding]`

Used by vector search. It must remain isolated from agent and memory LLM keys.
If embedding is unavailable, Memorix falls back to BM25/full-text behavior
without breaking the agent.

Legacy environment aliases in the `MEMORIX_EMBEDDING_*` family remain
supported for compatibility.

## Memcode Integration

Memcode should read the unified Memorix config before starting the agent
runtime, then project compatible values into the Pi-derived settings layer.

Required behavior:

- `memorix memcode` and direct `memcode` startup use the same bootstrap path.
- The active project is resolved from cwd and `.git`, not from config file
  placement.
- `[agent]` provides initial provider/model/auth defaults.
- Existing memcode settings files keep working for extensions, packages,
  theme, trust, sessions, and low-level interactive preferences.
- `/model`, `/settings`, `/login`, and command discovery remain powered by the
  memcode agent runtime.
- Memorix-specific commands such as `/memory status` read the same resolved
  TOML snapshot and explain which lanes are active.

This keeps memcode compatible with the inherited agent core while making
Memorix the product-level control plane.

## CLI UX

Add or update these commands over time:

- `memorix config open`
- `memorix config path`
- `memorix config doctor`
- `memorix config migrate`
- `memorix config set <path> <value>`
- `memorix config get <path>`

`memorix init` should write TOML by default. It should not ask users to choose
between YAML and dotenv files.

`memorix status` and `/memory status` should show:

- active config file paths
- agent lane provider/model
- memory LLM lane provider/model
- embedding lane provider/model/status
- search mode
- hook status
- retention or cleanup status

Secrets must be redacted in all status output.

## Migration

Migration should be additive and calm:

1. Add TOML reader and typed resolver.
2. Keep existing YAML, dotenv, JSON, and settings readers.
3. Make TOML higher priority than legacy files, below environment variables.
4. Update init/config/status/docs to prefer TOML.
5. Add `memorix config migrate` to copy safe values from legacy files into
   TOML.
6. Warn only when legacy files conflict with TOML, and keep the warning short.

No existing user should lose working configuration during this migration.

## Implementation Boundaries

New code should be centered around one config resolver module rather than
spreading TOML reads across CLI, server, dashboard, and memcode.

Suggested modules:

- `src/config/toml-loader.ts`
- `src/config/resolved-config.ts`
- `src/config/config-paths.ts`
- `packages/memcode/src/config/memorix-config-adapter.ts`

The resolver should expose typed lane snapshots instead of raw unstructured
objects.

## Testing

Required tests:

- global TOML is loaded.
- project TOML overrides global TOML only after `.git` project detection.
- environment variables override TOML.
- legacy YAML/JSON/env files still work when TOML is absent.
- embedding never borrows agent or memory LLM keys.
- memcode bootstrap sees `[agent]` config.
- `memorix memcode` and direct `memcode` entrypoints resolve the same config.
- status output redacts secrets.
- Windows paths under `C:\Users\...\ .memorix` and drive-letter project roots
  resolve correctly.

## Non-Goals

- Do not remove legacy config support in the first implementation.
- Do not rewrite memcode's entire settings manager.
- Do not make config files determine project identity.
- Do not store raw transcripts, secrets, or provider responses in memory.
- Do not change external agent MCP configuration formats in this phase.

## Success Criteria

A new user can run setup, open one TOML file, configure agent, memory LLM, and
embedding providers, then start memcode without learning multiple configuration
systems.

An existing user with `memorix.yml`, `.env`, or memcode settings keeps working.

An advanced user can still override values through environment variables for
CI, MCP hosts, and temporary shell sessions.

Memcode remains compatible with the inherited agent command surface while
feeling like the native Memorix agent.
