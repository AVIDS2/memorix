# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Fixed
- **API-first auto embedding selection** -- `MEMORIX_EMBEDDING=auto` now prefers a configured remote embedding API before falling back to local `fastembed` or `transformers`, preventing unexpected local-model activation when API credentials are already present.
- **Embedding cache isolation across config changes** -- API embedding cache keys and probe-dimension metadata now stay isolated per `baseUrl + model + requestedDimensions`, so switching between shortened and native dimensions no longer reuses stale cached embeddings or stale dimension probes.

## [1.0.6] - 2026-04-05

### Added -- Memory Provenance and Layered Retrieval
- **Provenance foundation** -- Observations now carry `sourceDetail` (`explicit` / `hook` / `git-ingest`) and `valueCategory` (`core` / `contextual` / `ephemeral`). All ten write-path call sites annotated. Backward-compatible: old data without new fields parses cleanly.
- **Layered disclosure (L1/L2/L3)** -- `memorix_session_start` now separates routing hints (L1), working context (L2), and deep evidence (L3). Session injection scores observations by source and value category so hook noise stays out of working context.
- **Evidence retrieval** -- `memorix_detail` and `memorix_timeline` now surface provenance cues (source badge, evidence basis) so operators can trace why a memory exists and what supports it.
- **Verification-aware evidence** -- Detail and timeline outputs distinguish direct, summarized, derived, and repository-backed evidence without requiring a full citation framework.
- **Citation-lite** -- Evidence-bearing surfaces emit lightweight citation hints (`[source: git]`, `[verified: repo-backed]`) to support "why surfaced" and "what supports this" queries.
- **Retrieval tuning** -- Source-aware boost treats `git-ingest` as first-class git evidence for intent-aware ranking. Lightweight provenance tiebreaking for ambiguous retrieval results. L1 routing surfaces active entities as next-hop search guidance.
- **Graph routing hints** -- Knowledge graph neighborhood is used for lightweight retrieval enrichment and entity-affinity scoring without a full graph rewrite.

### Added -- Task-Line Scoping, Secret Safety, and Attribution Hardening
- **Task-line scoping** -- Search and session context now bias toward the current entity/task-line/subdomain, reducing cross-workstream contamination within a single project bucket.
- **Secret safety** -- Store-time detection blocks obvious credentials, passwords, and tokens from entering durable memory. Retrieval-time redaction acts as a second safety net for already-stored sensitive data.
- **Project attribution hardening** -- Write-path consistency checks reduce wrong-bucket writes. `memorix_audit_project` scans for misattributed observations and reports them with confidence levels.
- **Ambiguous-target attribution fix** -- Observations stored during ambiguous project context are now flagged rather than silently written to the wrong bucket.

### Added -- Retention, Cleanup, and Operator Remediation
- **Retention calibration** -- Source-aware retention multipliers (hook 0.5x, git-ingest 1.5x) and value-category multipliers (ephemeral 0.5x, core 2.0x) with a 7-day minimum floor. Immunity refined: only `critical` importance and `core` valueCategory grant permanent immunity; `high`-importance types keep long retention but can now decay.
- **Retention explainability** -- `memorix_retention action="stale"` shows a full table with per-observation retention explanation (importance, multipliers, effective days, zone, immunity reason).
- **Cleanup remediation loop** -- `memorix_retention` (stale/report), `memorix_audit_project`, and `memorix_resolve` now form a coherent operator loop. Each output includes structured `Suggested IDs: [...]` blocks and explicit next-step guidance. `memorix_resolve` links back to retention report for closed-loop cleanup.

### Added -- OpenCode Plugin Improvements
- **`post_compact` event** -- New `post_compact` hook event type. OpenCode's `session.compacted` event correctly maps to `post_compact` (was incorrectly mapped to `pre_compact`). Plugin event handler triggers `runHook` side-effect on compaction completion.
- **Structured compaction prompt** -- OpenCode compaction prompt rewritten as a structured continuation format requesting current task, key decisions, active files, blockers, next steps, active entities, and memorix context. No longer promises automatic `memorix_store` / `memorix_session_start` invocation during compaction.

### Fixed
- **#45 OpenCode compaction** -- Compaction prompt no longer makes misleading tool-call promises. `session.compacted` event now fires a real side-effect via `runHook`. Normalizer mapping corrected to `post_compact`.
- **#46 Dotenv load order** -- `loadDotenv()` now runs before `getEmbeddingProvider()` in `status`, `doctor`, and TUI entry points, fixing "No API key" errors when `.env` credentials were present.
- **#48 Ingest log dedup** -- `memorix ingest log` now deduplicates by commit hash, matching the behavior of `ingest commit` and TUI batch ingest. Repeated runs skip already-ingested commits.

### Stats
- **Tests:** 1439 passed | 2 skipped (102 files)
- **Phases landed:** 11 (provenance -> layered disclosure -> evidence -> verification -> citation-lite -> retrieval tuning -> graph routing -> task-line/secret -> attribution -> retention -> cleanup ergonomics)

---

## [1.0.5] - 2026-03-24

### Added
- **TUI workbench matured into a product-grade terminal UI** - Added an Ink-native `/configure` flow, interactive sidebar navigation, unified keyboard model, better no-project empty state, compact responsive layouts, and broader TUI interaction coverage.
- **Gemini CLI as a first-class integration target** - Added a dedicated Gemini CLI target across TUI integrate flows, workspace adapters, rules sync, hook normalization, and MCP config generation.
- **Release-blocker regression suite** - Added real embedded `serve-http` route tests for CORS and `/api/config`, plus cold-start CLI search regression coverage against persisted observations.
- **Silent auto-update wiring** - Wired the existing updater into real runtime entry points so TUI and HTTP control-plane starts can background-check and silently install newer npm releases without blocking startup.

### Changed
- **Control plane stability and scope semantics** - Hardened HTTP project binding, dashboard API behavior, project-scoped health/search diagnostics, and release-readiness around multi-project sessions.
- **Product positioning and integration messaging** - Updated README, AI-facing docs, and agent/rules entry docs to foreground Memorix as an open-source cross-agent memory layer compatible with ten major coding IDEs and MCP hosts.
- **Search and retrieval transparency** - Search mode reporting is now project-scoped end-to-end, including TUI, embedded stats, and MCP search responses.
- **Session handoff semantics** - `memorix_session_start` now separates `Recent Handoff`, `Key Project Memories`, and `Recent Session History` so recency-first handoff context is no longer mixed with long-term importance-ranked memories.

### Fixed
- **Embedded dashboard security and config isolation** - Fixed localhost-only CORS behavior for embedded dashboard JSON APIs and closed the `/api/config?project=...` startup-project YAML leak.
- **Cross-project retrieval correctness** - Fixed `memorix_detail` bare numeric IDs to remain project-safe instead of opening observations from another project.
- **Concurrent memory write consistency** - Fixed `topicKey` upsert races by rechecking authoritative disk state under the file lock before deciding whether to create or update.
- **CLI cold-start search regression** - Fixed `memorix search` so persisted observations are hydrated into the Orama index on a fresh process before searching.
- **Embedding provider resilience** - Fixed API embedding batch-limit handling with provider-aware chunking, automatic split-and-retry on oversized batches, and retry handling for transient 429/5xx errors.
- **OpenCode stale plugin detection** - Added generated-version markers and hook-status detection so outdated OpenCode plugin installs are surfaced and can be reinstalled before they corrupt the TUI experience.
- **Documentation encoding regressions** - Restored clean UTF-8 copy for Chinese README content and agent/rules entry docs so release docs match the current product shape.

### Known Limitations
- **Gemini CLI / Antigravity shared `.gemini/*` ecosystem** - This follows the official Gemini ecosystem design. Integrations are independent at the target/adapter level, but hook runtime identity can still behave as "last installer wins" because both share the same official hook config surface.

### Stats
- **Tests:** 1099/1101 passing (`82` files, `2` skipped)
- **Runtime surfaces covered before release:** stdio MCP, HTTP control plane, dashboard, TUI workbench, silent auto-update, Gemini CLI integration, git-hook ingest, and cold-start CLI search

---

## [1.0.4] -- 2026-03-17

### Added
- **Git Memory pipeline** -- `git commit` can now flow directly into Memorix via `memorix git-hook`, `memorix git-hook-uninstall`, and `memorix ingest commit --auto`. Stored observations now carry `source` and `commitHash`, and Git memories can be filtered explicitly with `source: "git"`.
- **Reasoning Memory tools** -- Added `memorix_store_reasoning` and `memorix_search_reasoning` so design rationale, alternatives, constraints, and risks can be stored and searched as a first-class memory layer.
- **Source-aware retrieval and cross-linking** -- Search now boosts Git, reasoning, and problem-solution memories differently based on query intent. Git memories and reasoning memories can cross-reference each other via related commits and shared entities.
- **Structured config model** -- Added project/user `memorix.yml`, project/user `.env` loading, `memorix init`, and configuration provenance diagnostics in `memorix status`.
- **Dashboard control plane upgrades** -- Added Git Memory, Config Provenance, and Identity Health views, plus richer stats and a stabilized graph layout for the HTTP dashboard.

### Changed
- **Documentation consolidation** -- Reworked README, README.zh-CN, setup, architecture, API reference, configuration, Git Memory, and development guides so they match the current product model: local-first platform, `memorix.yml + .env`, Git Memory, HTTP dashboard, and the four-layer architecture.
- **Project detection model** -- Project identity now centers on real Git roots, MCP roots support, system-directory fallback handling, and runtime project switching instead of older placeholder-style fallback identities.
- **Dashboard usage model** -- `memorix background start` is now the primary long-lived HTTP control-plane entrypoint when you want HTTP transport, collaboration features, and dashboard access in one place. `memorix serve-http --port 3211` remains the foreground/debug variant.

### Fixed
- **Project identity drift** -- Fixed Codex/Windsurf startup issues that produced `local/System32`, IDE-installation-directory identities, or other incorrect local project bindings.
- **Worktree-safe Git hooks** -- Hook installation, uninstall, auto-install checks, and status reporting now resolve hooks directories correctly for both normal repos and Git worktrees.
- **Runtime config correctness** -- Fixed project-level `memorix.yml` not reaching runtime getters, `.env` values leaking across project switches, and legacy `config.json` not showing up correctly in provenance diagnostics.
- **Git Memory quality** -- Added noise filtering, preserved release/version milestone commits, and implemented `memorix ingest commit --force` as an escape hatch for manual ingestion.
- **Cross-project detail retrieval** -- Global search results can now be opened reliably with project-aware refs instead of colliding on observation IDs from different projects.
- **Skill generation noise** -- `memorix_skills generate` now filters low-signal command-history observations like `git`, `gh`, `npm`, and `npx` so generated skills stay project-relevant.
- **OpenCode static plugin noise** -- Merged the first external PR to silence `console.log` spam in the static OpenCode plugin without reintroducing session lifecycle side effects.
- **CI/publish flow** -- Restored CI green after type/test regressions and changed npm publishing workflow to manual trigger instead of automatic release publishing.

### Stats
- **Tests:** 879/879 passing across 68 files
- **Runtime modes:** stdio MCP (`memorix serve`), HTTP MCP + dashboard (`memorix background start` by default, or `memorix serve-http --port 3211` in the foreground), and standalone dashboard remain supported

---

## [1.0.3] -- 2026-03-14

### Added
- **Memory Formation Pipeline** -- Three-stage pipeline (Extract -> Resolve -> Evaluate) runs in shadow mode on every `memorix_store` call and hooks trigger. Collects quality metrics without affecting storage decisions.
  - **Extract**: Automatic fact extraction from narratives, title normalization, entity resolution against Knowledge Graph, observation type verification.
  - **Resolve**: 4 resolution actions (new/merge/evolve/discard) based on similarity scoring, word overlap, and contradiction detection.
  - **Evaluate**: Multi-factor knowledge value assessment (type weight, fact density, specificity, causal reasoning, noise detection). Categorizes memories as core/contextual/ephemeral.
- **`memorix_formation_metrics` tool** -- New MCP tool to query aggregated Formation Pipeline metrics (value scores, resolution actions, extraction rates, processing times).
- **`getEntityNames()` method** on `KnowledgeGraphManager` for Formation Pipeline entity resolution.

### Stats
- **Default MCP Tools:** 23 (+1: `memorix_formation_metrics`)
- **Tests:** 803/803 passing across 60 files (+50 new Formation Pipeline tests)
- **Hooks safety:** handler.ts +21 lines (shadow call only), zero modification to existing hook logic

---

## [1.0.2] -- 2026-03-14

### Fixed
- **MCP Server version mismatch** -- Server now reports the correct version from `package.json` (was hardcoded `0.1.0`). Injected at build time via tsup `define`.
- **CI Node.js matrix** -- Removed Node 18 from CI matrix to match `engines: >=20` in `package.json`.
- **Orama reindex idempotency** -- `reindexObservations()` now resets the Orama DB before rebuilding, eliminating "document already exists" errors in multi-session scenarios.
- **E2E tests no longer touch real user data** -- Mini-skills E2E tests now use a temporary directory with synthetic observations instead of reading/writing `~/.memorix/data/`.

---

## [1.0.1] -- 2026-03-14

### Fixed
- **OpenCode stdout pollution** -- Removed all `console.log` / `console.error` from the generated OpenCode plugin template. Hooks now run fully silent. (fixes #15)
- **OpenCode session_id missing** -- `normalizeOpenCode()` now reads `session_id` from the payload instead of hardcoding empty string. Plugin template generates and injects a stable session ID per plugin lifetime. (fixes #14)
- **Auto-install hooks scope** -- Hooks are now only auto-installed for IDEs whose project-level config directory already exists (e.g., `.cursor/`, `.windsurf/`), preventing unwanted IDE directories from appearing in projects opened with a different IDE.

### Added
- **`MEMORIX_DATA_DIR` environment variable** -- Override the default data directory (`~/.memorix/data/`) by setting `MEMORIX_DATA_DIR`. Applied consistently across persistence, alias registry, and embedding cache.

---

## [1.0.0] -- 2026-03-09

### 🎉 First Stable Release

Memorix reaches v1.0.0 -- all major features complete. Future versions will iterate based on AI/agent ecosystem evolution.

### Added
- **Multi-Agent Team Collaboration** -- 4 team tools (`team_manage`, `team_file_lock`, `team_task`, `team_message`) for cross-IDE agent coordination. File-based persistence via `team-state.json`. Verified: Windsurf <-> Antigravity bidirectional communication.
- **Auto-Cleanup on Startup** -- Background retention archiving and intelligent deduplication run automatically in `deferredInit`. With LLM configured: semantic dedup via any OpenAI-compatible model. Without LLM: Jaccard similarity consolidation. Zero manual maintenance required.
- **`memorix_transfer` tool** -- Merged `memorix_export` + `memorix_import` into a single tool with `action: "export" | "import"`.
- **TEAM.md** -- Multi-agent coordination protocol documentation.

### Changed
- **Tool consolidation: 41 -> 22 default tools (-46%)**
  - Team tools: 13 individual -> 4 merged (action parameter pattern)
  - Knowledge Graph tools: 9 -> conditional via `~/.memorix/settings.json` (`{ "knowledgeGraph": true }`)
  - Export+Import: 2 -> 1 (`memorix_transfer`)
- **Dashboard Team Panel** -- Redesigned with Iconify icons, Material Design 3 style. Agent cards, task lists, message panel, file lock panel.
- **README updated** for v1.0.0 stable (EN + 中文).

### Fixed
- **Windows EPERM file lock race condition** -- Treat EPERM same as EEXIST in file-lock.ts.
- **PowerShell BOM in config.json** -- `Set-Content -Encoding UTF8` adds BOM in PS 5.x, breaking `JSON.parse`. Always use Node.js for config file writes.

### Production Hardening
- Cross-session shared team state
- Inbox capped at 200 messages with auto-eviction
- Session timeout GC (30min idle -> auto-close)
- Send to inactive agent rejected
- Agent leave releases file locks + clears inbox
- Orphaned task rescue when assignee inactive
- Input validation: agent name max 100, message max 10KB

### Stats
- **Default MCP Tools:** 22 (+9 optional KG)
- **Tests:** 753/753 passing across 56 files
- **IDE Support:** 10 agents (Cursor, Windsurf, Claude Code, Codex, Copilot, Kiro, Antigravity, OpenCode, Trae, Gemini CLI)

## [0.12.0] -- 2026-03-08

### Added
- **Intent-Aware Recall** -- Search understands query intent ("why X?" prioritizes decisions/trade-offs, "how to X?" prioritizes how-it-works).
- **MCP Deadlock Fix** -- Resolved stdio transport deadlock under high concurrency.
- **Dashboard Dark Theme Fix** -- Proper dark mode support across all panels.
- **Build Race Condition Fix** -- Fixed tsup parallel build race condition.

## [0.11.0] -- 2026-03-07

### Added
- **Mini-Skills** (`memorix_promote`) -- Promote observations to permanent skills that auto-inject at session start. Never decay, project-scoped.
- **LLM Quality Engine** -- Compact-on-write (duplicate detection at write time), narrative compression (~27% token reduction), search reranking (60% queries improved).
- **`memorix_deduplicate` tool** -- LLM-powered semantic deduplication with dry-run support.
- **`memorix_resolve` tool** -- Mark completed tasks and fixed bugs as resolved to prevent context pollution.

### Fixed
- **Retention decay fix** -- Reclassified `what-changed`/`discovery` to low retention (30d instead of 90d).

### Stats
- **Tests:** 641 -> 674 passing

## [0.10.6] -- 2026-03-06

### Fixed
- Minor stability improvements.

## [0.10.5] -- 2026-03-05

### Fixed
- **🔴 Critical: Antigravity MCP connection failure** -- CLI banner (starting with 🧠 emoji, UTF-8 `F0 9F A7 A0`) was written to `stdout` via `console.log` in the non-interactive branch. When `citty` dispatches to `serve` subcommand, it calls parent `run()` first, polluting the MCP JSON-RPC stream. Go's `encoding/json` in Antigravity failed on the first byte `0xF0` with `invalid character 'ð'`. Fix: `console.log` -> `console.error` for all CLI banner output.
- **🔴 Critical: Claude Code Stop hook schema validation failure** -- `hookSpecificOutput` was returned for all hook events, but Claude Code only supports it for `PreToolUse`, `UserPromptSubmit`, and `PostToolUse`. Events like `SessionStart`, `Stop`, and `PreCompact` with `hookSpecificOutput` triggered `JSON validation failed: Invalid input`. Fix: only include `hookSpecificOutput` for the 3 supported event types.
- **Claude Code hook_event_name not read** -- Handler read `payload.hookEventName` (camelCase) but Claude Code sends `hook_event_name` (snake_case), causing `hookEventName` to always be empty and `hookSpecificOutput` to be `{}`.
- **Windows hook stdin piping broken** -- `cmd /c memorix hook` wrapper broke stdin piping for hook event JSON. Changed to `memorix.cmd hook` which directly invokes the CMD shim and properly forwards stdin.
- **CLI emoji removed** -- All emoji in CLI output replaced with plain text markers (`[OK]`, `[FAIL]`, `[WARN]`, `[SKIP]`, `[DRY RUN]`) for enterprise-grade compatibility and to prevent future UTF-8 encoding issues.

## [0.9.25] -- 2026-02-28

### Fixed
- **Windsurf "no tools returned"** -- Transport-first architecture caused Windsurf to query `tools/list` before tools were registered. Normal path now registers tools first, then connects transport. Roots path (invalid cwd) still connects first to query `listRoots`.
- **Windsurf rules not activated** -- Generated `.windsurf/rules/memorix.md` lacked YAML frontmatter (`trigger: always_on`). Windsurf ignored the file without it. Also added `alwaysApply: true` frontmatter for Cursor `.mdc` files.
- **Windsurf hook `post_command` content too short** -- Normalizer didn't extract `commandOutput` from Windsurf `post_command` events, causing content to be <30 chars and filtered out.
- **Hook hot-reload broken on Windows** -- `fs.watch()` lost track of `observations.json` after `atomicWriteFile` (which uses `rename()`). Switched to `fs.watchFile` with 2s polling for reliable cross-platform hot-reload. Hook-written memories are now searchable within ~4 seconds.

## [0.9.18] -- 2026-02-26

### Fixed
- **Self-referential command noise** -- Bash commands that inspect memorix's own data (e.g. `node -e "...observations.json..."`, `cat ~/.memorix/...`) were being stored as observations, creating a feedback loop. Now filtered alongside `memorix_internal` tools.

## [0.9.17] -- 2026-02-26

### Fixed
- **Session activity noise** -- Empty `session_end` events were unconditionally stored, generating ~8.5% of all observations as useless `"Session activity (discovery)"` entries. Now requires content ≥ 50 chars, matching the quality-first philosophy of 0.9.16.

## [0.9.16] -- 2026-02-26

### Architecture
- **Classify -> Policy -> Store pipeline** -- Replaced the monolithic `switch/case` handler (527 lines) with a clean declarative pipeline (432 lines). Inspired by claude-mem's store-first philosophy and mcp-memory-service's configurable scoring.
- **Tool Taxonomy** -- `classifyTool()` categorizes tools into `file_modify | file_read | command | search | memorix_internal | unknown`. Each category has a declarative `StoragePolicy` (store mode, minLength, defaultType).
- **Pattern detection = classification only** -- Pattern detection now only determines observation *type* (decision, error, etc.), not whether to store. Storage decisions are made by policy.
- **Unified `TYPE_EMOJI`** -- Single exported constant, eliminating 3 duplicated copies across handler and session_start.

### Fixed
- **🔴 Critical: Bash commands with `cd` prefix silently dropped** -- Claude Code sends Bash commands as `cd /project && npm test 2>&1`. The noise filter `/^cd\b/` matched the `cd` prefix and silently discarded the entire command. This caused `npm test`, `npm install express`, `node -e "..."`, and all other project-scoped commands to never be stored. Fix: `extractRealCommand()` strips `cd path && ` prefix before noise checking, so `cd /path && npm test` is correctly evaluated as `npm test`.
- **Cooldown key too broad** -- Old key `post_tool:Bash` meant ALL Bash commands shared one 30-second cooldown. New key uses `event:filePath|command|toolName`, so `npm test` and `npm install` have independent cooldowns.
- **Store-first for commands** -- Command-category tools now use `store: 'always'` policy with minLength 30 (down from 50-200), capturing more meaningful development activity.

## [0.9.15] -- 2026-02-26

### Fixed
- **Feedback visibility** -- Hook auto-stores were silent. Now returns `systemMessage` to the agent after each save, e.g. `🟢 Memorix saved: Updated auth.ts [what-changed]`. Gives Codex-like visibility into what memorix is recording.
- **File-modifying tools always store** -- Write/Edit/MultiEdit tool events were rejected when content lacked pattern keywords (e.g., writing utility functions with no "error"/"fix" keywords). Now file-modifying tools always store if content > 100 chars, classified as `what-changed` by default.
- **PreCompact low-quality spam** -- PreCompact events stored empty/minimal observations with no meaningful content. Now requires `MIN_STORE_LENGTH` (100 chars) to store.
- **Normalizer prompt extraction** -- `normalizeClaude` only extracted `prompt` for `user_prompt` events. Now extracts for all events (PreCompact, etc.), preserving context that would otherwise be lost.

## [0.9.14] -- 2026-02-26

### Fixed
- **🔴 Critical: Hooks never auto-store during development** -- Two root causes:
  1. `extractContent()` had a fatal `parts.length === 0` guard that skipped rich `toolInput` data (file content, edit diffs, commands) whenever `toolResult` was present. Since all agents send short `toolResult` like `"File written successfully"` (28 chars), the content was always < 100 chars and got rejected by `MIN_STORE_LENGTH`.
  2. Bash/shell tool events (npm install, npm test, git commands) also got rejected because their content (~90 chars) fell below the generic `post_tool` threshold of 200 chars, even though commands are inherently meaningful.
- **Fix**: Always extract `toolInput` fields alongside `toolResult`. Bash tools now use a dedicated low-threshold path (50 chars) with noise command filtering, matching the `post_command` logic.

### Added
- **12 Claude Code E2E tests** -- Validates the full hook pipeline (stdin JSON -> normalize -> handleHookEvent -> observation) for Write, Edit, Bash, UserPromptSubmit, SessionStart, Stop, PreCompact, and edge cases (noise filtering, memorix recursion skip, short prompts).

## [0.9.12] -- 2026-02-25

### Fixed
- **Copilot hooks format completely wrong** -- Was reusing Claude Code's `generateClaudeConfig()` (PascalCase events, `command` field). Copilot requires `version: 1`, `bash`/`powershell` fields, `timeoutSec`, and camelCase event names (`sessionStart`, `userPromptSubmitted`, `preToolUse`, `postToolUse`, `sessionEnd`, `errorOccurred`). Now uses dedicated `generateCopilotConfig()`. Source: [GitHub Docs](https://docs.github.com/en/copilot/reference/hooks-configuration).
- **Codex fake hooks.json removed** -- Codex has no hooks system (only `notify` in config.toml for `agent-turn-complete`). Was generating a non-existent `.codex/hooks.json`. Now only installs rules (AGENTS.md). Source: [OpenAI Codex Config Reference](https://developers.openai.com/codex/config-reference/).
- **Kiro hook file extension wrong** -- Was `.hook.md`, should be `.kiro.hook`. Now generates 3 hook files: `memorix-agent-stop.kiro.hook` (session memory), `memorix-prompt-submit.kiro.hook` (context loading), `memorix-file-save.kiro.hook` (file change tracking). Source: [Kiro Docs](https://kiro.dev/docs/hooks/).
- **Kiro only had 1 event** -- Was only `file_saved`. Now covers `agent_stop`, `prompt_submit`, and `file_save` events.

### Added
- **Antigravity/Gemini CLI hook installer** -- New `generateGeminiConfig()` for `.gemini/settings.json`. PascalCase events (`SessionStart`, `AfterTool`, `AfterAgent`, `PreCompress`), timeout in milliseconds (10000ms). Source: [Gemini CLI Docs](https://geminicli.com/docs/hooks/).
- **Copilot normalizer** -- Dedicated `normalizeCopilot()` function with `inferCopilotEvent()` for payload-based event detection (Copilot sends typed payloads without explicit event names).
- **Gemini CLI normalizer** -- Dedicated `normalizeGemini()` function with event mapping for all 11 Gemini CLI events (`BeforeAgent`, `AfterAgent`, `BeforeTool`, `AfterTool`, `PreCompress`, etc.).
- **Gemini CLI event mappings** -- Full EVENT_MAP entries for Gemini CLI PascalCase events -> normalized events.
- **Copilot event mappings** -- EVENT_MAP entries for Copilot-specific camelCase events (`userPromptSubmitted`, `preToolUse`, `postToolUse`, `errorOccurred`).

## [0.9.11] -- 2026-02-25

### Fixed
- **CLI crashes with `Dynamic require of "fs" is not supported`** -- When bundling CJS dependencies (like `gray-matter`) into ESM output via `noExternal`, esbuild's CJS-to-ESM wrapper couldn't resolve Node.js built-in modules. Added `createRequire` banner to provide a real `require` function before esbuild's wrapper runs, fixing `require('fs')` and other built-in module calls.

## [0.9.10] -- 2026-02-25

### Fixed
- **CLI crashes with `ERR_MODULE_NOT_FOUND` on global install** -- `@orama/orama`, `gpt-tokenizer`, `gray-matter` and other dependencies were not bundled into the CLI output. tsup treated `dependencies` as external by default. Added `noExternal` to force-bundle all deps into CLI (275KB -> 2.59MB), making `memorix hook` work reliably when installed globally via `npm install -g`.
- **Cursor agent detection corrected** -- Real Cursor payload confirmed to include `hook_event_name` + `conversation_id` (not just `workspace_roots`). Detection now uses `conversation_id` or `cursor_version` as primary discriminator vs Claude Code (which sends `session_id` without `conversation_id`). `extractEventName` reads `hook_event_name` first, falls back to payload inference.

## [0.9.9] -- 2026-02-25

### Fixed
- **Cursor hooks config format invalid** -- Generated config was missing required `version` field and used objects instead of arrays for hook scripts. Cursor requires `{ version: 1, hooks: { eventName: [{ command: "..." }] } }` format. Added `sessionStart`, `beforeShellExecution`, `afterMCPExecution`, `preCompact` events.
- **Cursor agent detection failed** -- Cursor does NOT send `hook_event_name` like Claude Code. Detection now uses Cursor-specific fields (`workspace_roots`, `is_background_agent`, `composer_mode`). Event type inferred from payload structure (e.g., `old_content`/`new_content` -> `afterFileEdit`).
- **Cursor `session_id` field not read** -- Normalizer expected `conversation_id` but Cursor sends `session_id`. Now reads both with fallback.

## [0.9.8] -- 2026-02-25

### Fixed
- **Claude Code hooks installed to wrong file** -- Hooks were written to `.github/hooks/memorix.json` but Claude Code reads from `.claude/settings.local.json` (project-level) or `~/.claude/settings.json` (global). Now correctly writes to `.claude/settings.local.json` for project-level installation.
- **Hooks merge overwrites existing settings** -- Shallow spread `{...existing, ...generated}` would overwrite the entire `hooks` key, destroying user's other hook configurations. Now deep-merges the `hooks` object so existing hooks from other tools are preserved.

## [0.9.7] -- 2026-02-25

### Fixed
- **Claude Code hooks never triggering auto-memory** -- Claude Code sends `hook_event_name` (snake_case) but the normalizer expected `hookEventName` (camelCase). This caused **every event** (SessionStart, UserPromptSubmit, PostToolUse, PreCompact, Stop) to be misidentified as `post_tool`, breaking event routing, prompt extraction, memory injection, and session tracking. Also fixed `session_id` -> `sessionId` and `tool_response` -> `toolResult` field mappings.
- **Empty content extraction from Claude Code tool events** -- `extractContent()` now unpacks `toolInput` fields (Bash commands, Write file content, etc.) when no other content is available. Previously tool events produced empty or near-empty content strings.
- **User prompts silently dropped** -- `MIN_STORE_LENGTH=100` was too high for typical user prompts. Added `MIN_PROMPT_LENGTH=20` specifically for `user_prompt` events.
- **Post-tool events too aggressively filtered** -- Tool events with substantial content (>200 chars) are now stored even without keyword pattern matches.

## [0.9.6] -- 2026-02-25

### Fixed
- **Cross-IDE project identity fragmentation** -- Data was stored in per-project subdirectories (`~/.memorix/data/<projectId>/`), but different IDEs often detected different projectIds for the same repo (e.g. `placeholder/repo` vs `local/repo` vs `local/Kiro`). This caused observations to silently split across directories, making cross-IDE relay unreliable. Now **all data is stored in a single flat directory** (`~/.memorix/data/`). projectId is metadata only, not used for directory partitioning. Existing per-project subdirectories are automatically merged on first startup (IDs remapped, graphs deduplicated, subdirs backed up to `.migrated-subdirs/`).
- **`scope: 'project'` parameter now works** -- Previously accepted but ignored. Now properly filters search results by the current project's ID via Orama where-clause.

## [0.9.5] -- 2026-02-25

### Fixed
- **Claude Code hooks `matcher` format** -- `matcher` must be a **string** (tool name pattern like `"Bash"`, `"Edit|Write"`), not an object. For hooks that should fire on ALL events, `matcher` is now omitted entirely instead of using `{}`. Fixes `matcher: Expected string, but received object` validation error on Claude Code startup.

## [0.9.4] -- 2026-02-25

### Fixed
- **Codex/all-IDE `tools/list -> Method not found`** -- Critical bug where `local/<dirname>` projects (any directory without a git remote) wrongly entered the MCP roots resolution flow. This flow connects the server *before* registering tools, so the MCP `initialize` handshake declared no `tools` capability, causing all subsequent `tools/list` calls to fail with "Method not found". Now only truly invalid projects (home dir, system dirs) enter the roots flow; `local/` projects go through the normal path (register tools first, then connect).

## [0.9.3] -- 2026-02-25

### Fixed
- **`memorix_timeline` "not found" bug** -- Timeline was using unreliable Orama empty-term search. Now uses in-memory observations (same fix pattern as `memorix_detail`).
- **`memorix_retention` "no observations found" bug** -- Same root cause as timeline. Now uses in-memory observations for reliable document retrieval.
- **`memorix_search` cross-IDE projectId mismatch** -- Removed redundant projectId filter from search. Data isolation is already handled at the directory level. Different IDEs resolving different projectIds for the same directory no longer causes empty search results.
- **Claude Code hooks format** -- Updated `generateClaudeConfig` to use the new `{matcher: {}, hooks: [...]}` structure required by Claude Code 2025+. Fixes "Expected array, but received undefined" error on `memorix hooks install --agent claude --global`.
- **EPERM `process.cwd()` crash** -- All CLI commands (`serve`, `hooks install/uninstall/status`) now safely handle `process.cwd()` failures (e.g., deleted CWD on macOS) with fallback to home directory.

## [0.9.2] -- 2026-02-25

### Fixed
- **Empty directory support** -- Memorix now starts successfully in any directory, even without `.git` or `package.json`. No more `__invalid__` project errors for brand new folders. Only truly dangerous directories (home dir, drive root, system dirs) are rejected.
- **`findPackageRoot` safety** -- Walking up from temp/nested directories no longer accidentally selects the home directory as project root.

### Changed
- **README rewrite** -- Complete rewrite of Quick Start section for both EN and 中文 READMEs:
  - Two-step install (global install + MCP config) instead of error-prone `npx`
  - Per-agent config examples (Claude Code, Cursor, Windsurf, etc.)
  - Troubleshooting table for common errors
  - AI-friendly: agents reading the README will now configure correctly on first try

## [0.9.1] -- 2026-02-25

### Fixed
- **Defensive parameter coercion** -- All 24 MCP tools now gracefully handle string-encoded arrays and numbers (e.g., `"[16]"` -> `[16]`, `"20"` -> `20`). Fixes compatibility with Claude Code CLI's known serialization bug ([#5504](https://github.com/anthropics/claude-code/issues/5504), [#26027](https://github.com/anthropics/claude-code/issues/26027)) and non-Anthropic models (GLM, etc.) that may produce incorrectly typed tool call arguments. Codex, Windsurf, and Cursor were already unaffected.

## [0.9.0] -- 2026-02-24

### Added
- **Memory Consolidation** (`memorix_consolidate`) -- Find and merge similar observations to reduce memory bloat. Uses Jaccard text similarity to cluster observations by entity+type, then merges them preserving all facts, files, and concepts. Supports `preview` (dry run) and `execute` modes with configurable similarity threshold.
- **Temporal Queries** -- `memorix_search` now supports `since` and `until` parameters for date range filtering. Example: "What auth decisions did we make last week?"
- **Explainable Recall** -- Search results now include a `Matched` column showing which fields matched the query (title, entity, concept, narrative, fact, file, or fuzzy). Helps understand why each result was found.
- **Export/Import** -- Two new tools for team collaboration:
  - `memorix_export` -- Export project observations and sessions as JSON (importable) or Markdown (human-readable for PRs/docs)
  - `memorix_import` -- Import from JSON export, re-assigns IDs, skips duplicate topicKeys
- **Dashboard Sessions Panel** -- New "Sessions" tab in the web dashboard with timeline view, active/completed counts, agent info, and session summaries. Bilingual (EN/中文).
- **Auto sessionId** -- `memorix_store` now automatically associates the current active session's ID with stored observations.
- **16 new tests** -- 8 consolidation + 8 export/import (484 total).

### Stats
- **MCP Tools:** 20 -> 24 (memorix_consolidate, memorix_export, memorix_import + dashboard sessions API)
- **Tests:** 484/484 passing

## [0.8.0] -- 2026-02-24

### Added
- **Session Lifecycle Management** -- 3 new MCP tools for cross-session context continuity:
  - `memorix_session_start` -- Start a coding session, auto-inject context from previous sessions (summaries + key observations). Previous active sessions are auto-closed.
  - `memorix_session_end` -- End a session with structured summary (Goal/Discoveries/Accomplished/Files format). Summary is injected into the next session.
  - `memorix_session_context` -- Manually retrieve session history and context (useful after compaction recovery).
- **Topic Key Upsert** -- `memorix_store` now accepts an optional `topicKey` parameter. When an observation with the same `topicKey + projectId` already exists, it is **updated in-place** instead of creating a duplicate. `revisionCount` increments on each upsert. Prevents data bloat for evolving decisions, architecture docs, etc.
- **`memorix_suggest_topic_key` tool** -- Suggests stable topic keys from type + title using family heuristics (`architecture/*`, `bug/*`, `decision/*`, `config/*`, `discovery/*`, `pattern/*`). Supports CJK characters.
- **Session persistence** -- `sessions.json` with atomic writes and file locking for cross-process safety.
- **Observation fields** -- `topicKey`, `revisionCount`, `updatedAt`, `sessionId` added to `Observation` interface.
- **30 new tests** -- 16 session lifecycle tests + 14 topic key upsert tests (468 total).

### Improved
- **`storeObservation` API** -- Now returns `{ observation, upserted }` instead of just `Observation`, enabling callers to distinguish new vs updated observations.

### Inspired by
- [Engram](https://github.com/alanbuscaglia/engram) -- Session lifecycle design, topic_key upsert pattern, structured session summaries.

## [0.7.11] -- 2026-02-24

### Added
- **File locking & atomic writes** (`withFileLock`, `atomicWriteFile`) -- Cross-process safe writes for `observations.json`, `graph.jsonl`, and `counter.json`. Uses `.memorix.lock` directory lock with stale detection (10s timeout) and write-to-temp-then-rename for crash safety.
- **Retention auto-archive** -- `memorix_retention` tool now supports `action="archive"` to move expired observations to `observations.archived.json`. Reversible -- archived memories can be restored manually.
- **Chinese entity extraction** -- Entity extractor now recognizes Chinese identifiers in brackets (`「认证模块」`, `【数据库连接】`) and backticks, plus Chinese causal language patterns (因为/所以/由于/导致/决定/采用).
- **Graph-memory bidirectional sync** -- Dashboard DELETE now cleans up corresponding `[#id]` references from knowledge graph entities. Prevents orphaned data.

### Improved
- **Search accuracy** -- Added fuzzy tolerance, field boosting (title > entityName > concepts > narrative), lowered similarity threshold to 0.5, tuned hybrid weights (text 0.6, vector 0.4).
- **Auto-relations performance** -- Entity lookups now use O(1) index (`Map`) instead of O(n) `find()` on every observation store. `KnowledgeGraphManager` maintains a `entityIndex` rebuilt on create/delete mutations.
- **Re-read-before-write** -- `storeObservation` re-reads `observations.json` inside the lock before writing, merging concurrent changes instead of overwriting.

## [0.7.10] -- 2026-02-24

### Added
- **Chinese README** (`README.zh-CN.md`) -- Full bilingual documentation with language switcher at the top of both README files.
- **Antigravity config guide** -- Collapsible note in README Quick Start and updated `docs/SETUP.md` Antigravity section explaining the `MEMORIX_PROJECT_ROOT` requirement, why it's needed (cwd + MCP roots both unavailable), and how to configure it.
- **Project detection priority documentation** -- Clear detection chain (`--cwd` -> `MEMORIX_PROJECT_ROOT` -> `INIT_CWD` -> `process.cwd()` -> MCP roots -> error) in README, SETUP.md, and troubleshooting section.

## [0.7.9] -- 2026-02-24

### Fixed
- **Dashboard auto-switch when project changes** -- When the dashboard is already running (started from project A) and `memorix_dashboard` is called from project B, the dashboard server's current project is now updated via a `/api/set-current-project` POST request before opening the browser. Previously, the dashboard always showed the project it was initially started with; now it correctly switches to the calling project. Existing browser tabs will also show the correct project on the next page load/refresh.

### Added
- **MCP roots protocol support** -- When the IDE's `cwd` is not a valid project (e.g., Antigravity sets cwd to `G:\Antigravity`), Memorix now automatically tries the MCP `roots/list` protocol to get the IDE's actual workspace path. This means standard MCP configs (`npx memorix@latest serve`) can work without `--cwd` in IDEs that support MCP roots. Falls back gracefully if the client doesn't support roots. Priority chain: `--cwd` > `MEMORIX_PROJECT_ROOT` > `INIT_CWD` > `process.cwd()` > **MCP roots** > error.

## [0.7.8] -- 2026-02-24

### Fixed
- **Graceful error on invalid project detection** -- When `detectProject()` returns `__invalid__` (e.g., IDE sets cwd to its own install directory like `G:\Antigravity`), the server now prints a clear, actionable error message with fix instructions (`--cwd` or `MEMORIX_PROJECT_ROOT`) instead of crashing with an opaque stack trace.
- **Dashboard process liveness check** -- `memorix_dashboard` now verifies the port is actually listening before returning "already running". If the dashboard process was killed externally (e.g., `taskkill`), it automatically restarts instead of opening a browser to a dead server.

### Added
- **`MEMORIX_PROJECT_ROOT` environment variable** -- New way to specify the project directory for IDEs that don't set `cwd` to the project path (e.g., Antigravity uses `G:\Antigravity` as cwd). Priority: `--cwd` > `MEMORIX_PROJECT_ROOT` > `INIT_CWD` > `process.cwd()`. Example MCP config: `"env": { "MEMORIX_PROJECT_ROOT": "e:/your/project" }`.

## [0.7.7] -- 2026-02-24

### Fixed
- **Wrong project detection in Antigravity/global MCP configs** -- Removed dangerous `scriptDir` fallback in `serve.ts` that caused the MCP server to detect the memorix development repo (or other wrong projects) instead of the user's actual project. When `process.cwd()` was not a git repo, the old code fell back to the memorix script's own directory, which could resolve to a completely unrelated project. Now relies solely on `detectProject()` which has proper fallback logic.
- **Dashboard always showing wrong project** -- When re-opening the dashboard (already running on port 3210), it now passes the current project as a `?project=` URL parameter. The frontend reads this parameter and auto-selects the correct project in the switcher, so opening dashboard from different IDEs/projects shows the right data.

## [0.7.6] -- 2026-02-24

### Added
- **`llms.txt` + `llms-full.txt`** -- Machine-readable project documentation for AI crawlers (2026 llms.txt standard). Helps Gemini, GPT, Claude, and other AI systems discover and understand Memorix automatically.
- **FAQ semantic anchors in README** -- 7 Q&A entries matching common AI search queries ("How do I keep context when switching IDEs?", "Is there an MCP server for persistent AI coding memory?", etc.)

### Changed
- **GitHub repo description** -- Shortened to ~150 chars for optimal og:title/og:description generation
- **GitHub topics** -- 20 GEO-optimized tags including `cursor-mcp`, `windsurf-mcp`, `claude-code-memory`, `cross-ide-sync`, `context-persistence`, `agent-memory`
- **package.json keywords** -- Replaced generic tags with IDE-specific MCP entity-linking keywords
- **package.json description** -- Shortened to under 160 chars for better meta tag generation
- **MCP tool descriptions** -- Enhanced `memorix_store`, `memorix_search`, `memorix_workspace_sync`, `memorix_skills` with cross-IDE context so AI search engines understand what problems they solve

## [0.7.5] -- 2026-02-22

### Changed
- **README rewrite** -- Completely restructured to focus on real-world scenarios, use cases, and features. Added 5 walkthrough scenarios, comparison table with alternatives, "Works with" badges for all 7 agents. Moved detailed config to sub-README.
- **New `docs/SETUP.md`** -- Dedicated setup guide with agent-specific config, vector search setup, data storage, and troubleshooting

## [0.7.4] -- 2026-02-22

### Fixed
- **Hyphenated concepts not searchable** -- Concepts like `project-detection` and `bug-fix` are now normalized to `project detection` and `bug fix` in the search index so Orama's tokenizer can split them into individual searchable terms. Original observation data is preserved unchanged.

## [0.7.3] -- 2026-02-22

### Fixed
- **Windows: git remote detection fails due to "dubious ownership"** -- Added `safe.directory=*` flag to all git commands so MCP subprocess can read git info regardless of directory ownership settings. If git CLI still fails, falls back to directly parsing `.git/config` file. This fixes projects incorrectly getting `local/<dirname>` instead of `owner/repo` as their project ID.

## [0.7.2] -- 2026-02-22

### Fixed
- **`memorix_workspace_sync` rejects `kiro` as target** -- Added `kiro` to `AGENT_TARGETS` enum (adapter was already implemented but missing from the tool's input schema)
- **`memorix_rules_sync` missing `kiro` target** -- Added `kiro` to `RULE_SOURCES` enum so Kiro steering rules can be generated as a sync target
- **VS Code Copilot README config** -- Separated `.vscode/mcp.json` (workspace) and `settings.json` (global) formats which have different JSON structures

## [0.7.1] -- 2026-02-22

### Fixed
- **Dashboard checkbox checkmark not visible** -- Added `position: relative/absolute` to `.obs-checkbox::after` so the ✓ renders correctly in batch select mode
- **Embedding provider status flickers to "fulltext only"** -- Replaced `initialized` boolean flag with a shared Promise lock; concurrent callers now wait for the same initialization instead of seeing `provider = null` mid-load
- **`memorix_dashboard` MCP tool reliability** -- Replaced fixed 800ms wait with TCP port polling (up to 5s) so the tool only returns after the HTTP server is actually listening
- **Dashboard embedding status always shows "fulltext only"** -- Fixed root cause: dashboard is an independent process, `isEmbeddingEnabled()` from orama-store always returns false there; now uses `provider !== null` directly

## [0.7.0] -- 2026-02-21

### Added
- **Memory-Driven Skills Engine** (`memorix_skills` MCP tool):
  - `list` -- Discover all `SKILL.md` files across 7 agent directories
  - `generate` -- Auto-generate project-specific skills from observation patterns (gotchas, decisions, how-it-works)
  - `inject` -- Return full skill content directly to agent context
  - Intelligent scoring: requires skill-worthy observation types, not just volume
  - Write to any target agent with `write: true, target: "<agent>"`
- **Transformers.js Embedding Provider**:
  - Pure JavaScript fallback (`@huggingface/transformers`) -- no native deps required
  - Provider chain: `fastembed` -> `transformers.js` -> fulltext-only
  - Quantized model (`q8`) for small footprint
- **Dashboard Enhancements**:
  - Canvas donut chart for observation type distribution
  - Embedding provider status card (enabled/provider/dimensions)
  - Search result highlighting with `<mark>` tags
- **17 new tests** for Skills Engine (list, generate, inject, write, scoring, dedup)

### Changed
- Scoring algorithm requires at least 1 skill-worthy type (gotcha/decision/how-it-works/problem-solution/trade-off) -- pure discovery/what-changed entities won't generate skills
- Volume bonus reduced from 2xobs to 1xobs (capped at 5) to favor quality over quantity
- Type diversity bonus increased from 2 to 3 points per unique skill-worthy type

### Fixed
- 422 tests passing (up from 405), 34 test files, zero regressions

## [0.5.0] -- 2026-02-15

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

## [0.1.0] -- 2026-02-14

### Core
- Knowledge Graph: Entity-Relation-Observation model (MCP Official compatible)
- 3-Layer Progressive Disclosure: compact search -> timeline -> detail
- 9 observation types with icon classification
- Full-text search via Orama (BM25)
- Per-project isolation via Git remote detection
- 14 MCP tools (9 official + 5 Memorix extensions)

### Cross-Agent Sync
- Rules Parser: 4 format adapters (Cursor, Claude Code, Codex, Windsurf)
- Rules Syncer: scan -> deduplicate -> conflict detection -> cross-format generation
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
- Graceful degradation: no fastembed -> fulltext only
- Embedding cache (5000 entries LRU)

### Agent Instructions
- CLAUDE.md: Claude Code usage instructions + lifecycle hooks
- Example configs for Cursor, Windsurf, Codex
