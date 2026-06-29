# Auto Context Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Code Memory automatically usable by agents through CLI, MCP, and SessionStart hooks.

**Architecture:** Add a shared `src/codegraph/auto-context.ts` service that owns refresh policy and agent-facing formatting. Wire CLI, MCP, and hooks to this service while keeping advanced `memorix codegraph ...` commands unchanged.

**Tech Stack:** TypeScript, Vitest, citty CLI, MCP server registration, SQLite-backed CodeGraphStore, Windows PowerShell smoke commands.

---

### Task 1: Auto Context Service

**Files:**
- Create: `src/codegraph/auto-context.ts`
- Test: `tests/codegraph/auto-context.test.ts`

- [ ] **Step 1: Write failing tests**

Test a temp git repo with `src/auth.ts` and `src/worker.py`. Store one active observation bound to `src/auth.ts`. Call `buildAutoProjectContext` with `refresh: "auto"` and assert:

- code files are indexed without a prior manual refresh,
- TypeScript and Python languages appear,
- suggested reads include `src/auth.ts`,
- prompt output contains `Memorix project context`,
- prompt output avoids `SQLite`.

- [ ] **Step 2: Verify RED**

Run:

```powershell
npx vitest run tests/codegraph/auto-context.test.ts
```

Expected: fails because `auto-context.ts` does not exist.

- [ ] **Step 3: Implement service**

Create `buildAutoProjectContext`, `formatAutoProjectContextPrompt`, and `formatAutoProjectContextSummary`. Reuse `CodeGraphStore`, `indexProjectLite`, `backfillMissingObservationCodeRefs`, and the existing project-context service.

- [ ] **Step 4: Verify GREEN**

Run:

```powershell
npx vitest run tests/codegraph/auto-context.test.ts
```

Expected: passes.

### Task 2: CLI Uses Auto Context

**Files:**
- Modify: `src/cli/commands/context.ts`
- Modify: `src/cli/commands/explain.ts`
- Test: `tests/cli/context-command.test.ts`

- [ ] **Step 1: Write failing CLI test**

Add a test that does not run `memorix codegraph refresh` before `context`. It should run `context` in a temp repo and assert output includes TypeScript/Python language counts.

- [ ] **Step 2: Verify RED**

Run:

```powershell
npx vitest run tests/cli/context-command.test.ts
```

Expected: fails because current CLI only reads an existing index.

- [ ] **Step 3: Implement CLI wiring**

Add `task` and `refresh` args to `context`; default refresh to `auto`. Add `refresh` to `explain`; default to `auto`. Use `buildAutoProjectContext`.

- [ ] **Step 4: Verify GREEN**

Run:

```powershell
npx vitest run tests/cli/context-command.test.ts
```

Expected: passes.

### Task 3: MCP Project Context Tool

**Files:**
- Modify: `src/server/tool-profile.ts`
- Modify: `src/server.ts`
- Modify: `src/cli/capability-map.ts`
- Test: `tests/server/context-pack-tool-profile.test.ts`

- [ ] **Step 1: Write failing profile test**

Assert `memorix_project_context` is available in lite, team, and full profiles.

- [ ] **Step 2: Verify RED**

Run:

```powershell
npx vitest run tests/server/context-pack-tool-profile.test.ts
```

Expected: fails because the tool is not listed.

- [ ] **Step 3: Register tool**

Register `memorix_project_context` near `memorix_graph_context` / `memorix_context_pack`. Use the auto-context service and return prompt, summary, or JSON text.

- [ ] **Step 4: Verify GREEN**

Run:

```powershell
npx vitest run tests/server/context-pack-tool-profile.test.ts
```

Expected: passes.

### Task 4: SessionStart Full Injection

**Files:**
- Modify: `src/hooks/handler.ts`
- Test: `tests/hooks/handler-e2e.test.ts`

- [ ] **Step 1: Write failing hook test**

Add a SessionStart test with `sessionInject=full`, a temp git repo, one code-bound memory, and no manual CodeGraph refresh. Assert the returned system message contains `Memorix project context` and `src/auth.ts`.

- [ ] **Step 2: Verify RED**

Run:

```powershell
npx vitest run tests/hooks/handler-e2e.test.ts
```

Expected: fails because SessionStart currently only injects recent text memories.

- [ ] **Step 3: Implement hook wiring**

Replace the full-mode session summary builder with `buildAutoProjectContext`. Keep minimal mode light and silent mode unchanged.

- [ ] **Step 4: Verify GREEN**

Run:

```powershell
npx vitest run tests/hooks/handler-e2e.test.ts
```

Expected: passes.

### Task 5: Docs and Verification

**Files:**
- Modify: `docs/API_REFERENCE.md`
- Modify: `docs/README.md`
- Modify if needed: `src/hooks/official-skills.ts`

- [ ] **Step 1: Document user surface**

Document `memorix_project_context`, `memorix context --refresh auto`, and SessionStart full-mode behavior.

- [ ] **Step 2: Run focused tests**

```powershell
npx vitest run tests/codegraph/auto-context.test.ts tests/codegraph/project-context.test.ts tests/cli/context-command.test.ts tests/server/context-pack-tool-profile.test.ts tests/hooks/handler-e2e.test.ts
```

- [ ] **Step 3: Build**

```powershell
npm run build
```

- [ ] **Step 4: Real CLI smoke**

Create a temp TS/Python git repo and run:

```powershell
node dist\cli\index.js context
node dist\cli\index.js explain
node dist\cli\index.js doctor --json
```

Expected: `context` works without a manual refresh.

- [ ] **Step 5: Full test**

```powershell
npm test
```

Expected: all tests pass.
