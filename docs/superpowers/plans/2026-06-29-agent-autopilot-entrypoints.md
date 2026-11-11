# Agent Autopilot Entrypoints Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the 1.1.3 Code Memory work feel like a project-aware agent autopilot instead of exposing internal codegraph machinery.

**Architecture:** Keep `memorix codegraph ...` as the advanced/debug surface, but add a shared project context service used by user-facing `memorix context`, `memorix explain`, and `memorix doctor`. Extend the Lite indexer from TS/JS-only to polyglot file-level indexing with basic symbol extraction for common languages.

**Tech Stack:** TypeScript, citty CLI commands, SQLite-backed CodeGraphStore, Vitest, PowerShell-compatible smoke commands.

---

### Task 1: Polyglot Lite Indexing

**Files:**
- Modify: `src/codegraph/lite-provider.ts`
- Test: `tests/codegraph/lite-provider.test.ts`

- [ ] **Step 1: Write failing tests**

Add tests that create a temp project with TypeScript, Python, Go, Rust, Java, C#, C++, and Markdown files. Assert that code files from supported languages are indexed, top-level symbols are extracted for common languages, and non-code docs are ignored.

- [ ] **Step 2: Verify RED**

Run:

```powershell
npx vitest run tests/codegraph/lite-provider.test.ts
```

Expected: fails because Python/Go/Rust/etc files are not indexed yet.

- [ ] **Step 3: Implement minimal polyglot support**

Extend `SUPPORTED_EXTENSIONS`, `languageForPath`, `extractSymbols`, and `extractImportEdges` with regex-based language profiles. Do not add new dependencies. Every supported language must at least produce file-level nodes; symbol extraction can remain top-level and heuristic.

- [ ] **Step 4: Verify GREEN**

Run:

```powershell
npx vitest run tests/codegraph/lite-provider.test.ts
```

Expected: passes.

### Task 2: Shared Project Context Service

**Files:**
- Create: `src/codegraph/project-context.ts`
- Test: `tests/codegraph/project-context.test.ts`

- [ ] **Step 1: Write failing tests**

Test that a project context summary reports project name, code memory status, languages, files, symbols, refs, active memory counts, stale/suspect ref counts, and source labels without requiring users to know codegraph internals.

- [ ] **Step 2: Verify RED**

Run:

```powershell
npx vitest run tests/codegraph/project-context.test.ts
```

Expected: fails because `project-context.ts` does not exist.

- [ ] **Step 3: Implement service**

Create pure service functions:

- `buildProjectContextOverview(input)`
- `buildProjectContextExplain(input)`
- `formatProjectContextOverview(overview)`
- `formatProjectContextExplain(explain)`

The service should read from `CodeGraphStore` and observations passed by caller. It should not detect projects or initialize stores itself.

- [ ] **Step 4: Verify GREEN**

Run:

```powershell
npx vitest run tests/codegraph/project-context.test.ts
```

Expected: passes.

### Task 3: User-Facing CLI Entrypoints

**Files:**
- Create: `src/cli/commands/context.ts`
- Create: `src/cli/commands/explain.ts`
- Modify: `src/cli/index.ts`
- Test: `tests/cli/context-command.test.ts`

- [ ] **Step 1: Write failing CLI tests**

Test `context` and `explain` commands against a temp git repo with `MEMORIX_DATA_DIR`. The tests should refresh code memory, store one memory, and assert:

- `context` shows "Project context", code files/symbols, active memories, and suggested reads.
- `explain` shows source/provenance-style details and code memory status.
- JSON mode returns structured objects.

- [ ] **Step 2: Verify RED**

Run:

```powershell
npx vitest run tests/cli/context-command.test.ts
```

Expected: fails because commands are not registered.

- [ ] **Step 3: Implement CLI commands**

Use `getCliProjectContext`, `CodeGraphStore`, `getAllObservations`, and the new project context service. Keep `memorix codegraph context-pack` unchanged as the advanced surface.

- [ ] **Step 4: Verify GREEN**

Run:

```powershell
npx vitest run tests/cli/context-command.test.ts
```

Expected: passes.

### Task 4: Doctor Code Memory Section

**Files:**
- Modify: `src/cli/commands/doctor.ts`
- Test: `tests/cli/context-command.test.ts` or a focused doctor test if existing helpers fit better.

- [ ] **Step 1: Write failing test**

Add a test that runs doctor JSON after code memory refresh and asserts `report.codeMemory` includes provider, files, symbols, refs, and stale/suspect counts.

- [ ] **Step 2: Verify RED**

Run:

```powershell
npx vitest run tests/cli/context-command.test.ts tests/cli/receipt.test.ts
```

Expected: fails because doctor lacks the new code memory section.

- [ ] **Step 3: Implement doctor section**

Add a "Project Context" or "Code Memory" section after data status. Avoid internal jargon in human output, but keep JSON keys explicit.

- [ ] **Step 4: Verify GREEN**

Run:

```powershell
npx vitest run tests/cli/context-command.test.ts tests/cli/receipt.test.ts
```

Expected: passes.

### Task 5: Verification and Smoke

**Files:**
- No new source files unless tests reveal a real issue.

- [ ] **Step 1: Run focused tests**

```powershell
npx vitest run tests/codegraph/lite-provider.test.ts tests/codegraph/project-context.test.ts tests/cli/context-command.test.ts tests/cli/codegraph-command.test.ts tests/cli/receipt.test.ts
```

- [ ] **Step 2: Build**

```powershell
npm run build
```

- [ ] **Step 3: Real CLI smoke**

Create a temp git repo with at least TS and Python files. Run:

```powershell
node dist\cli\index.js codegraph refresh --json
node dist\cli\index.js context
node dist\cli\index.js explain
node dist\cli\index.js doctor --json
```

Expected: all commands exit 0, context/explain use user-facing language, and Python files are included in the refreshed index.

- [ ] **Step 4: Full test**

```powershell
npm test
```

Expected: all tests pass.

---

## Self-Review

- Spec coverage: covers black-box user entrypoints, doctor visibility, and polyglot Lite fallback.
- Scope control: does not remove advanced `codegraph` commands, does not add new parser dependencies, does not implement external CodeGraph/Understand adapters in this slice.
- Ambiguity: "polyglot" means file-level support plus heuristic top-level symbols for common languages, not perfect semantic graphing.
