# Changelog

All notable changes to this project will be documented in this file.

## [0.9.16] — 2026-02-26

### Architecture
- **Classify → Policy → Store pipeline** — Replaced the monolithic `switch/case` handler (527 lines) with a clean declarative pipeline (432 lines). Inspired by claude-mem's store-first philosophy and mcp-memory-service's configurable scoring.
- **Tool Taxonomy** — `classifyTool()` categorizes tools into `file_modify | file_read | command | search | memorix_internal | unknown`. Each category has a declarative `StoragePolicy` (store mode, minLength, defaultType).
- **Pattern detection = classification only** — Pattern detection now only determines observation *type* (decision, error, etc.), not whether to store. Storage decisions are made by policy.
- **Unified `TYPE_EMOJI`** — Single exported constant, eliminating 3 duplicated copies across handler and session_start.

### Fixed
- **🔴 Critical: Bash commands with `cd` prefix silently dropped** — Claude Code sends Bash commands as `cd /project && npm test 2>&1`. The noise filter `/^cd\b/` matched the `cd` prefix and silently discarded the entire command. This caused `npm test`, `npm install express`, `node -e "..."`, and all other project-scoped commands to never be stored. Fix: `extractRealCommand()` strips `cd path && ` prefix before noise checking, so `cd /path && npm test` is correctly evaluated as `npm test`.
- **Cooldown key too broad** — Old key `post_tool:Bash` meant ALL Bash commands shared one 30-second cooldown. New key uses `event:filePath|command|toolName`, so `npm test` and `npm install` have independent cooldowns.
- **Store-first for commands** — Command-category tools now use `store: 'always'` policy with minLength 30 (down from 50-200), capturing more meaningful development activity.

## [0.9.15] — 2026-02-26

### Fixed
- **Feedback visibility** — Hook auto-stores were silent. Now returns `systemMessage` to the agent after each save, e.g. `🟢 Memorix saved: Updated auth.ts [what-changed]`. Gives Codex-like visibility into what memorix is recording.
- **File-modifying tools always store** — Write/Edit/MultiEdit tool events were rejected when content lacked pattern keywords (e.g., writing utility functions with no "error"/"fix" keywords). Now file-modifying tools always store if content > 100 chars, classified as `what-changed` by default.
- **PreCompact low-quality spam** — PreCompact events stored empty/minimal observations with no meaningful content. Now requires `MIN_STORE_LENGTH` (100 chars) to store.
- **Normalizer prompt extraction** — `normalizeClaude` only extracted `prompt` for `user_prompt` events. Now extracts for all events (PreCompact, etc.), preserving context that would otherwise be lost.

## [0.9.14] — 2026-02-26

### Fixed
- **🔴 Critical: Hooks never auto-store during development** — Two root causes:
  1. `extractContent()` had a fatal `parts.length === 0` guard that skipped rich `toolInput` data (file content, edit diffs, commands) whenever `toolResult` was present. Since all agents send short `toolResult` like `"File written successfully"` (28 chars), the content was always < 100 chars and got rejected by `MIN_STORE_LENGTH`.
  2. Bash/shell tool events (npm install, npm test, git commands) also got rejected because their content (~90 chars) fell below the generic `post_tool` threshold of 200 chars, even though commands are inherently meaningful.
- **Fix**: Always extract `toolInput` fields alongside `toolResult`. Bash tools now use a dedicated low-threshold path (50 chars) with noise command filtering, matching the `post_command` logic.

### Added
- **12 Claude Code E2E tests** — Validates the full hook pipeline (stdin JSON → normalize → handleHookEvent → observation) for Write, Edit, Bash, UserPromptSubmit, SessionStart, Stop, PreCompact, and edge cases (noise filtering, memorix recursion skip, short prompts).

## [0.9.12] — 2026-02-25

### Fixed
- **Copilot hooks format completely wrong** — Was reusing Claude Code's `generateClaudeConfig()` (PascalCase events, `command` field). Copilot requires `version: 1`, `bash`/`powershell` fields, `timeoutSec`, and camelCase event names (`sessionStart`, `userPromptSubmitted`, `preToolUse`, `postToolUse`, `sessionEnd`, `errorOccurred`). Now uses dedicated `generateCopilotConfig()`. Source: [GitHub Docs](https://docs.github.com/en/copilot/reference/hooks-configuration).
- **Codex fake hooks.json removed** — Codex has no hooks system (only `notify` in config.toml for `agent-turn-complete`). Was generating a non-existent `.codex/hooks.json`. Now only installs rules (AGENTS.md). Source: [OpenAI Codex Config Reference](https://developers.openai.com/codex/config-reference/).
- **Kiro hook file extension wrong** — Was `.hook.md`, should be `.kiro.hook`. Now generates 3 hook files: `memorix-agent-stop.kiro.hook` (session memory), `memorix-prompt-submit.kiro.hook` (context loading), `memorix-file-save.kiro.hook` (file change tracking). Source: [Kiro Docs](https://kiro.dev/docs/hooks/).
- **Kiro only had 1 event** — Was only `file_saved`. Now covers `agent_stop`, `prompt_submit`, and `file_save` events.

### Added
- **Antigravity/Gemini CLI hook installer** — New `generateGeminiConfig()` for `.gemini/settings.json`. PascalCase events (`SessionStart`, `AfterTool`, `AfterAgent`, `PreCompress`), timeout in milliseconds (10000ms). Source: [Gemini CLI Docs](https://geminicli.com/docs/hooks/).
- **Copilot normalizer** — Dedicated `normalizeCopilot()` function with `inferCopilotEvent()` for payload-based event detection (Copilot sends typed payloads without explicit event names).
- **Gemini CLI normalizer** — Dedicated `normalizeGemini()` function with event mapping for all 11 Gemini CLI events (`BeforeAgent`, `AfterAgent`, `BeforeTool`, `AfterTool`, `PreCompress`, etc.).
- **Gemini CLI event mappings** — Full EVENT_MAP entries for Gemini CLI PascalCase events → normalized events.
- **Copilot event mappings** — EVENT_MAP entries for Copilot-specific camelCase events (`userPromptSubmitted`, `preToolUse`, `postToolUse`, `errorOccurred`).

## [0.9.11] — 2026-02-25

### Fixed
- **CLI crashes with `Dynamic require of "fs" is not supported`** — When bundling CJS dependencies (like `gray-matter`) into ESM output via `noExternal`, esbuild's CJS-to-ESM wrapper couldn't resolve Node.js built-in modules. Added `createRequire` banner to provide a real `require` function before esbuild's wrapper runs, fixing `require('fs')` and other built-in module calls.

## [0.9.10] — 2026-02-25

### Fixed
- **CLI crashes with `ERR_MODULE_NOT_FOUND` on global install** — `@orama/orama`, `gpt-tokenizer`, `gray-matter` and other dependencies were not bundled into the CLI output. tsup treated `dependencies` as external by default. Added `noExternal` to force-bundle all deps into CLI (275KB → 2.59MB), making `memorix hook` work reliably when installed globally via `npm install -g`.
- **Cursor agent detection corrected** — Real Cursor payload confirmed to include `hook_event_name` + `conversation_id` (not just `workspace_roots`). Detection now uses `conversation_id` or `cursor_version` as primary discriminator vs Claude Code (which sends `session_id` without `conversation_id`). `extractEventName` reads `hook_event_name` first, falls back to payload inference.

## [0.9.9] — 2026-02-25

### Fixed
- **Cursor hooks config format invalid** — Generated config was missing required `version` field and used objects instead of arrays for hook scripts. Cursor requires `{ version: 1, hooks: { eventName: [{ command: "..." }] } }` format. Added `sessionStart`, `beforeShellExecution`, `afterMCPExecution`, `preCompact` events.
- **Cursor agent detection failed** — Cursor does NOT send `hook_event_name` like Claude Code. Detection now uses Cursor-specific fields (`workspace_roots`, `is_background_agent`, `composer_mode`). Event type inferred from payload structure (e.g., `old_content`/`new_content` → `afterFileEdit`).
- **Cursor `session_id` field not read** — Normalizer expected `conversation_id` but Cursor sends `session_id`. Now reads both with fallback.

## [0.9.8] — 2026-02-25

### Fixed
- **Claude Code hooks installed to wrong file** — Hooks were written to `.github/hooks/memorix.json` but Claude Code reads from `.claude/settings.local.json` (project-level) or `~/.claude/settings.json` (global). Now correctly writes to `.claude/settings.local.json` for project-level installation.
- **Hooks merge overwrites existing settings** — Shallow spread `{...existing, ...generated}` would overwrite the entire `hooks` key, destroying user's other hook configurations. Now deep-merges the `hooks` object so existing hooks from other tools are preserved.

## [0.9.7] — 2026-02-25

### Fixed
- **Claude Code hooks never triggering auto-memory** — Claude Code sends `hook_event_name` (snake_case) but the normalizer expected `hookEventName` (camelCase). This caused **every event** (SessionStart, UserPromptSubmit, PostToolUse, PreCompact, Stop) to be misidentified as `post_tool`, breaking event routing, prompt extraction, memory injection, and session tracking. Also fixed `session_id` → `sessionId` and `tool_response` → `toolResult` field mappings.
- **Empty content extraction from Claude Code tool events** — `extractContent()` now unpacks `toolInput` fields (Bash commands, Write file content, etc.) when no other content is available. Previously tool events produced empty or near-empty content strings.
- **User prompts silently dropped** — `MIN_STORE_LENGTH=100` was too high for typical user prompts. Added `MIN_PROMPT_LENGTH=20` specifically for `user_prompt` events.
- **Post-tool events too aggressively filtered** — Tool events with substantial content (>200 chars) are now stored even without keyword pattern matches.

## [0.9.6] — 2026-02-25

### Fixed
- **Cross-IDE project identity fragmentation** — Data was stored in per-project subdirectories (`~/.memorix/data/<projectId>/`), but different IDEs often detected different projectIds for the same repo (e.g. `placeholder/repo` vs `local/repo` vs `local/Kiro`). This caused observations to silently split across directories, making cross-IDE relay unreliable. Now **all data is stored in a single flat directory** (`~/.memorix/data/`). projectId is metadata only, not used for directory partitioning. Existing per-project subdirectories are automatically merged on first startup (IDs remapped, graphs deduplicated, subdirs backed up to `.migrated-subdirs/`).
- **`scope: 'project'` parameter now works** — Previously accepted but ignored. Now properly filters search results by the current project's ID via Orama where-clause.

## [0.9.5] — 2026-02-25

### Fixed
- **Claude Code hooks `matcher` format** — `matcher` must be a **string** (tool name pattern like `"Bash"`, `"Edit|Write"`), not an object. For hooks that should fire on ALL events, `matcher` is now omitted entirely instead of using `{}`. Fixes `matcher: Expected string, but received object` validation error on Claude Code startup.

## [0.9.4] — 2026-02-25

### Fixed
- **Codex/all-IDE `tools/list -> Method not found`** — Critical bug where `local/<dirname>` projects (any directory without a git remote) wrongly entered the MCP roots resolution flow. This flow connects the server *before* registering tools, so the MCP `initialize` handshake declared no `tools` capability, causing all subsequent `tools/list` calls to fail with "Method not found". Now only truly invalid projects (home dir, system dirs) enter the roots flow; `local/` projects go through the normal path (register tools first, then connect).

## [0.9.3] — 2026-02-25

### Fixed
- **`memorix_timeline` "not found" bug** — Timeline was using unreliable Orama empty-term search. Now uses in-memory observations (same fix pattern as `memorix_detail`).
- **`memorix_retention` "no observations found" bug** — Same root cause as timeline. Now uses in-memory observations for reliable document retrieval.
- **`memorix_search` cross-IDE projectId mismatch** — Removed redundant projectId filter from search. Data isolation is already handled at the directory level. Different IDEs resolving different projectIds for the same directory no longer causes empty search results.
- **Claude Code hooks format** — Updated `generateClaudeConfig` to use the new `{matcher: {}, hooks: [...]}` structure required by Claude Code 2025+. Fixes "Expected array, but received undefined" error on `memorix hooks install --agent claude --global`.
- **EPERM `process.cwd()` crash** — All CLI commands (`serve`, `hooks install/uninstall/status`) now safely handle `process.cwd()` failures (e.g., deleted CWD on macOS) with fallback to home directory.

## [0.9.2] — 2026-02-25

### Fixed
- **Empty directory support** — Memorix now starts successfully in any directory, even without `.git` or `package.json`. No more `__invalid__` project errors for brand new folders. Only truly dangerous directories (home dir, drive root, system dirs) are rejected.
- **`findPackageRoot` safety** — Walking up from temp/nested directories no longer accidentally selects the home directory as project root.

### Changed
- **README rewrite** — Complete rewrite of Quick Start section for both EN and 中文 READMEs:
  - Two-step install (global install + MCP config) instead of error-prone `npx`
  - Per-agent config examples (Claude Code, Cursor, Windsurf, etc.)
  - Troubleshooting table for common errors
  - AI-friendly: agents reading the README will now configure correctly on first try

## [0.9.1] — 2026-02-25

### Fixed
- **Defensive parameter coercion** — All 24 MCP tools now gracefully handle string-encoded arrays and numbers (e.g., `"[16]"` → `[16]`, `"20"` → `20`). Fixes compatibility with Claude Code CLI's known serialization bug ([#5504](https://github.com/anthropics/claude-code/issues/5504), [#26027](https://github.com/anthropics/claude-code/issues/26027)) and non-Anthropic models (GLM, etc.) that may produce incorrectly typed tool call arguments. Codex, Windsurf, and Cursor were already unaffected.

## [0.9.0] — 2026-02-24

### Added
- **Memory Consolidation** (`memorix_consolidate`) — Find and merge similar observations to reduce memory bloat. Uses Jaccard text similarity to cluster observations by entity+type, then merges them preserving all facts, files, and concepts. Supports `preview` (dry run) and `execute` modes with configurable similarity threshold.
- **Temporal Queries** — `memorix_search` now supports `since` and `until` parameters for date range filtering. Example: "What auth decisions did we make last week?"
- **Explainable Recall** — Search results now include a `Matched` column showing which fields matched the query (title, entity, concept, narrative, fact, file, or fuzzy). Helps understand why each result was found.
- **Export/Import** — Two new tools for team collaboration:
  - `memorix_export` — Export project observations and sessions as JSON (importable) or Markdown (human-readable for PRs/docs)
  - `memorix_import` — Import from JSON export, re-assigns IDs, skips duplicate topicKeys
- **Dashboard Sessions Panel** — New "Sessions" tab in the web dashboard with timeline view, active/completed counts, agent info, and session summaries. Bilingual (EN/中文).
- **Auto sessionId** — `memorix_store` now automatically associates the current active session's ID with stored observations.
- **16 new tests** — 8 consolidation + 8 export/import (484 total).

### Stats
- **MCP Tools:** 20 → 24 (memorix_consolidate, memorix_export, memorix_import + dashboard sessions API)
- **Tests:** 484/484 passing

## [0.8.0] — 2026-02-24

### Added
- **Session Lifecycle Management** — 3 new MCP tools for cross-session context continuity:
  - `memorix_session_start` — Start a coding session, auto-inject context from previous sessions (summaries + key observations). Previous active sessions are auto-closed.
  - `memorix_session_end` — End a session with structured summary (Goal/Discoveries/Accomplished/Files format). Summary is injected into the next session.
  - `memorix_session_context` — Manually retrieve session history and context (useful after compaction recovery).
- **Topic Key Upsert** — `memorix_store` now accepts an optional `topicKey` parameter. When an observation with the same `topicKey + projectId` already exists, it is **updated in-place** instead of creating a duplicate. `revisionCount` increments on each upsert. Prevents data bloat for evolving decisions, architecture docs, etc.
- **`memorix_suggest_topic_key` tool** — Suggests stable topic keys from type + title using family heuristics (`architecture/*`, `bug/*`, `decision/*`, `config/*`, `discovery/*`, `pattern/*`). Supports CJK characters.
- **Session persistence** — `sessions.json` with atomic writes and file locking for cross-process safety.
- **Observation fields** — `topicKey`, `revisionCount`, `updatedAt`, `sessionId` added to `Observation` interface.
- **30 new tests** — 16 session lifecycle tests + 14 topic key upsert tests (468 total).

### Improved
- **`storeObservation` API** — Now returns `{ observation, upserted }` instead of just `Observation`, enabling callers to distinguish new vs updated observations.

### Inspired by
- [Engram](https://github.com/alanbuscaglia/engram) — Session lifecycle design, topic_key upsert pattern, structured session summaries.

## [0.7.11] — 2026-02-24

### Added
- **File locking & atomic writes** (`withFileLock`, `atomicWriteFile`) — Cross-process safe writes for `observations.json`, `graph.jsonl`, and `counter.json`. Uses `.memorix.lock` directory lock with stale detection (10s timeout) and write-to-temp-then-rename for crash safety.
- **Retention auto-archive** — `memorix_retention` tool now supports `action="archive"` to move expired observations to `observations.archived.json`. Reversible — archived memories can be restored manually.
- **Chinese entity extraction** — Entity extractor now recognizes Chinese identifiers in brackets (`「认证模块」`, `【数据库连接】`) and backticks, plus Chinese causal language patterns (因为/所以/由于/导致/决定/采用).
- **Graph-memory bidirectional sync** — Dashboard DELETE now cleans up corresponding `[#id]` references from knowledge graph entities. Prevents orphaned data.

### Improved
- **Search accuracy** — Added fuzzy tolerance, field boosting (title > entityName > concepts > narrative), lowered similarity threshold to 0.5, tuned hybrid weights (text 0.6, vector 0.4).
- **Auto-relations performance** — Entity lookups now use O(1) index (`Map`) instead of O(n) `find()` on every observation store. `KnowledgeGraphManager` maintains a `entityIndex` rebuilt on create/delete mutations.
- **Re-read-before-write** — `storeObservation` re-reads `observations.json` inside the lock before writing, merging concurrent changes instead of overwriting.

## [0.7.10] — 2026-02-24

### Added
- **Chinese README** (`README.zh-CN.md`) — Full bilingual documentation with language switcher at the top of both README files.
- **Antigravity config guide** — Collapsible note in README Quick Start and updated `docs/SETUP.md` Antigravity section explaining the `MEMORIX_PROJECT_ROOT` requirement, why it's needed (cwd + MCP roots both unavailable), and how to configure it.
- **Project detection priority documentation** — Clear detection chain (`--cwd` → `MEMORIX_PROJECT_ROOT` → `INIT_CWD` → `process.cwd()` → MCP roots → error) in README, SETUP.md, and troubleshooting section.

## [0.7.9] — 2026-02-24

### Fixed
- **Dashboard auto-switch when project changes** — When the dashboard is already running (started from project A) and `memorix_dashboard` is called from project B, the dashboard server's current project is now updated via a `/api/set-current-project` POST request before opening the browser. Previously, the dashboard always showed the project it was initially started with; now it correctly switches to the calling project. Existing browser tabs will also show the correct project on the next page load/refresh.

### Added
- **MCP roots protocol support** — When the IDE's `cwd` is not a valid project (e.g., Antigravity sets cwd to `G:\Antigravity`), Memorix now automatically tries the MCP `roots/list` protocol to get the IDE's actual workspace path. This means standard MCP configs (`npx memorix@latest serve`) can work without `--cwd` in IDEs that support MCP roots. Falls back gracefully if the client doesn't support roots. Priority chain: `--cwd` > `MEMORIX_PROJECT_ROOT` > `INIT_CWD` > `process.cwd()` > **MCP roots** > error.

## [0.7.8] — 2026-02-24

### Fixed
- **Graceful error on invalid project detection** — When `detectProject()` returns `__invalid__` (e.g., IDE sets cwd to its own install directory like `G:\Antigravity`), the server now prints a clear, actionable error message with fix instructions (`--cwd` or `MEMORIX_PROJECT_ROOT`) instead of crashing with an opaque stack trace.
- **Dashboard process liveness check** — `memorix_dashboard` now verifies the port is actually listening before returning "already running". If the dashboard process was killed externally (e.g., `taskkill`), it automatically restarts instead of opening a browser to a dead server.

### Added
- **`MEMORIX_PROJECT_ROOT` environment variable** — New way to specify the project directory for IDEs that don't set `cwd` to the project path (e.g., Antigravity uses `G:\Antigravity` as cwd). Priority: `--cwd` > `MEMORIX_PROJECT_ROOT` > `INIT_CWD` > `process.cwd()`. Example MCP config: `"env": { "MEMORIX_PROJECT_ROOT": "e:/your/project" }`.

## [0.7.7] — 2026-02-24

### Fixed
- **Wrong project detection in Antigravity/global MCP configs** — Removed dangerous `scriptDir` fallback in `serve.ts` that caused the MCP server to detect the memorix development repo (or other wrong projects) instead of the user's actual project. When `process.cwd()` was not a git repo, the old code fell back to the memorix script's own directory, which could resolve to a completely unrelated project. Now relies solely on `detectProject()` which has proper fallback logic.
- **Dashboard always showing wrong project** — When re-opening the dashboard (already running on port 3210), it now passes the current project as a `?project=` URL parameter. The frontend reads this parameter and auto-selects the correct project in the switcher, so opening dashboard from different IDEs/projects shows the right data.

## [0.7.6] — 2026-02-24

### Added
- **`llms.txt` + `llms-full.txt`** — Machine-readable project documentation for AI crawlers (2026 llms.txt standard). Helps Gemini, GPT, Claude, and other AI systems discover and understand Memorix automatically.
- **FAQ semantic anchors in README** — 7 Q&A entries matching common AI search queries ("How do I keep context when switching IDEs?", "Is there an MCP server for persistent AI coding memory?", etc.)

### Changed
- **GitHub repo description** — Shortened to ~150 chars for optimal og:title/og:description generation
- **GitHub topics** — 20 GEO-optimized tags including `cursor-mcp`, `windsurf-mcp`, `claude-code-memory`, `cross-ide-sync`, `context-persistence`, `agent-memory`
- **package.json keywords** — Replaced generic tags with IDE-specific MCP entity-linking keywords
- **package.json description** — Shortened to under 160 chars for better meta tag generation
- **MCP tool descriptions** — Enhanced `memorix_store`, `memorix_search`, `memorix_workspace_sync`, `memorix_skills` with cross-IDE context so AI search engines understand what problems they solve

## [0.7.5] — 2026-02-22

### Changed
- **README rewrite** — Completely restructured to focus on real-world scenarios, use cases, and features. Added 5 walkthrough scenarios, comparison table with alternatives, "Works with" badges for all 7 agents. Moved detailed config to sub-README.
- **New `docs/SETUP.md`** — Dedicated setup guide with agent-specific config, vector search setup, data storage, and troubleshooting

## [0.7.4] — 2026-02-22

### Fixed
- **Hyphenated concepts not searchable** — Concepts like `project-detection` and `bug-fix` are now normalized to `project detection` and `bug fix` in the search index so Orama's tokenizer can split them into individual searchable terms. Original observation data is preserved unchanged.

## [0.7.3] — 2026-02-22

### Fixed
- **Windows: git remote detection fails due to "dubious ownership"** — Added `safe.directory=*` flag to all git commands so MCP subprocess can read git info regardless of directory ownership settings. If git CLI still fails, falls back to directly parsing `.git/config` file. This fixes projects incorrectly getting `local/<dirname>` instead of `owner/repo` as their project ID.

## [0.7.2] — 2026-02-22

### Fixed
- **`memorix_workspace_sync` rejects `kiro` as target** — Added `kiro` to `AGENT_TARGETS` enum (adapter was already implemented but missing from the tool's input schema)
- **`memorix_rules_sync` missing `kiro` target** — Added `kiro` to `RULE_SOURCES` enum so Kiro steering rules can be generated as a sync target
- **VS Code Copilot README config** — Separated `.vscode/mcp.json` (workspace) and `settings.json` (global) formats which have different JSON structures

## [0.7.1] — 2026-02-22

### Fixed
- **Dashboard checkbox checkmark not visible** — Added `position: relative/absolute` to `.obs-checkbox::after` so the ✓ renders correctly in batch select mode
- **Embedding provider status flickers to "fulltext only"** — Replaced `initialized` boolean flag with a shared Promise lock; concurrent callers now wait for the same initialization instead of seeing `provider = null` mid-load
- **`memorix_dashboard` MCP tool reliability** — Replaced fixed 800ms wait with TCP port polling (up to 5s) so the tool only returns after the HTTP server is actually listening
- **Dashboard embedding status always shows "fulltext only"** — Fixed root cause: dashboard is an independent process, `isEmbeddingEnabled()` from orama-store always returns false there; now uses `provider !== null` directly

## [0.7.0] — 2026-02-21

### Added
- **Memory-Driven Skills Engine** (`memorix_skills` MCP tool):
  - `list` — Discover all `SKILL.md` files across 7 agent directories
  - `generate` — Auto-generate project-specific skills from observation patterns (gotchas, decisions, how-it-works)
  - `inject` — Return full skill content directly to agent context
  - Intelligent scoring: requires skill-worthy observation types, not just volume
  - Write to any target agent with `write: true, target: "<agent>"`
- **Transformers.js Embedding Provider**:
  - Pure JavaScript fallback (`@huggingface/transformers`) — no native deps required
  - Provider chain: `fastembed` → `transformers.js` → fulltext-only
  - Quantized model (`q8`) for small footprint
- **Dashboard Enhancements**:
  - Canvas donut chart for observation type distribution
  - Embedding provider status card (enabled/provider/dimensions)
  - Search result highlighting with `<mark>` tags
- **17 new tests** for Skills Engine (list, generate, inject, write, scoring, dedup)

### Changed
- Scoring algorithm requires at least 1 skill-worthy type (gotcha/decision/how-it-works/problem-solution/trade-off) — pure discovery/what-changed entities won't generate skills
- Volume bonus reduced from 2×obs to 1×obs (capped at 5) to favor quality over quantity
- Type diversity bonus increased from 2 to 3 points per unique skill-worthy type

### Fixed
- 422 tests passing (up from 405), 34 test files, zero regressions

## [0.5.0] — 2026-02-15

### Added
- **Antigravity Adapter**: Full support for Antigravity/Gemini IDE (MCP config + rules)
- **Copilot Adapter**: VS Code Copilot MCP config adapter + rules format adapter
- **Comprehensive Documentation**: 7 developer docs in `docs/` (Architecture, Modules, API Reference, Design Decisions, Development Guide, Known Issues & Roadmap, AI Context)
- **8 new npm keywords**: antigravity, mcp-tool, memory-layer, ai-memory, progressive-disclosure, orama, vector-search, bm25
- `prepublishOnly` now runs `npm test` in addition to build

### Changed
- README completely rewritten with clearer structure, npx zero-install setup, 6 agent configs, comparison table, Progressive Disclosure example, and architecture diagram
- `description` field expanded for better npm search ranking
- `files` array cleaned up (removed unused `examples` directory)

### Fixed
- 274 tests passing (up from 219), zero regressions

## [0.1.0] — 2026-02-14

### Core
- Knowledge Graph: Entity-Relation-Observation model (MCP Official compatible)
- 3-Layer Progressive Disclosure: compact search → timeline → detail
- 9 observation types with icon classification
- Full-text search via Orama (BM25)
- Per-project isolation via Git remote detection
- 14 MCP tools (9 official + 5 Memorix extensions)

### Cross-Agent Sync
- Rules Parser: 4 format adapters (Cursor, Claude Code, Codex, Windsurf)
- Rules Syncer: scan → deduplicate → conflict detection → cross-format generation
- Workspace Sync: MCP config migration + workflow sync + apply with backup/rollback

### Intelligence (Competitor-Inspired)
- Access tracking: accessCount + lastAccessedAt (from mcp-memory-service)
- Token budget: maxTokens search trimming (from MemCP)
- Memory decay: exponential decay + retention lifecycle + immunity (from mcp-memory-service + MemCP)
- Entity extraction: regex-based file/module/URL/CamelCase extraction (from MemCP)
- Auto-enrichment: memorix_store auto-extracts and enriches concepts/files
- Causal detection: "because/due to/caused by" pattern detection
- Auto-relations: implicit Knowledge Graph relation creation (causes/fixes/modifies)
- Retention status: memorix_retention MCP tool

### Vector Search
- Embedding provider abstraction layer (extensible)
- fastembed integration (optional, local ONNX, 384-dim bge-small)
- Orama hybrid search mode (BM25 + vector)
- Graceful degradation: no fastembed → fulltext only
- Embedding cache (5000 entries LRU)

### Agent Instructions
- CLAUDE.md: Claude Code usage instructions + lifecycle hooks
- Example configs for Cursor, Windsurf, Codex
