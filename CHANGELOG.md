# Changelog

All notable changes to this project will be documented in this file.

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
