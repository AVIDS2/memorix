# Task-Lensed Memory Brief 1.1.7 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship 1.1.7 with a task-lensed Memory Autopilot brief shared by CLI and MCP.

**Architecture:** Add a focused task-lens policy module under `src/codegraph/` and keep `auto-context.ts` as the shared brief builder. CLI, MCP, JSON, and generated agent guidance consume the same selected lens.

**Tech Stack:** TypeScript, Vitest, existing CodeGraph Memory SQLite store, citty CLI, MCP server tool registration.

---

## File Structure

- Create `src/codegraph/task-lens.ts`: task classification, lens policy, path/source ranking, verification hints.
- Modify `src/codegraph/auto-context.ts`: include lens metadata in `AutoProjectContext`, use lens-aware formatting and warning suppression.
- Modify `src/cli/commands/context.ts`: include lens in JSON result.
- Modify `src/server.ts`: keep MCP schema stable while returning lens-aware prompt/summary/json.
- Modify `tests/codegraph/auto-context.test.ts`: add lens behavior coverage.
- Modify `tests/cli/context-command.test.ts`: assert JSON lens and user-facing lens text.
- Add or modify a server/tool-profile focused test if MCP text needs direct coverage.
- Modify `src/hooks/rules/memorix-agent-rules.md`, `src/hooks/official-skills.ts`, and setup-generated rules text in `src/hooks/installers/index.ts`: mention task-lensed project context.
- Modify `README.md`, `README.zh-CN.md`, `docs/API_REFERENCE.md`, `CHANGELOG.md`, root/workspace package versions, and `package-lock.json`.

## Task 1: Add Task Lens Policy

- [ ] Write failing unit expectations in `tests/codegraph/auto-context.test.ts` for `bugfix`, `release`, and `onboarding` lens text.
- [ ] Create `src/codegraph/task-lens.ts` with `TaskLensId`, `TaskLens`, `resolveTaskLens`, `rankLensPaths`, `rankLensSources`, and `lensVerificationHints`.
- [ ] Run `npx vitest run tests/codegraph/auto-context.test.ts` and verify the new tests fail before wiring the formatter.

## Task 2: Wire Lens Into Auto Context

- [ ] Modify `AutoProjectContext` to include `lens: TaskLens`.
- [ ] Call `resolveTaskLens(input.task)` inside `buildAutoProjectContext`.
- [ ] Update prompt and summary formatting to print `Task lens: <id> - <description>`.
- [ ] Use lens-aware Start here ranking and lens-specific verification hints.
- [ ] Suppress unrelated suspect details by showing counts plus only top ranked caution sources.
- [ ] Run `npx vitest run tests/codegraph/auto-context.test.ts`.

## Task 3: Preserve CLI and MCP Contract

- [ ] Update `src/cli/commands/context.ts` JSON payload to include `lens`.
- [ ] Add CLI JSON/text assertions in `tests/cli/context-command.test.ts`.
- [ ] Confirm `src/server.ts` returns `JSON.stringify(context, null, 2)` with lens included without schema changes.
- [ ] Run `npx vitest run tests/cli/context-command.test.ts tests/integration/tool-profile.test.ts tests/server/context-pack-tool-profile.test.ts`.

## Task 4: Refresh Agent Guidance and Docs

- [ ] Update generated rules to tell agents to pass the user's actual task into `memorix_project_context`.
- [ ] Update official skill copy to describe task-lensed brief behavior.
- [ ] Update API docs and READMEs with a short 1.1.7 example.
- [ ] Add `CHANGELOG.md` 1.1.7 entry.
- [ ] Run hook/setup tests that assert generated rule text.

## Task 5: Version and Release Verification

- [ ] Bump root/workspace package versions from 1.1.6 to 1.1.7 and update `package-lock.json`.
- [ ] Run `npm run lint`.
- [ ] Run `npm run build`.
- [ ] Run focused tests from Tasks 2-4.
- [ ] Smoke built CLI with:

```powershell
node .\dist\cli\index.js context --task "fix release blocker in package smoke" --refresh never
node .\dist\cli\index.js context --task "prepare 1.1.7 release" --refresh never --json
```

- [ ] Smoke MCP `memorix_project_context` through the existing server/tool-profile tests or a direct SDK smoke.
- [ ] Commit, push `codex/1.1.7-task-lensed-brief`, and open a PR.

## Self-Review

- The plan has no schema migration and no new dependency.
- CLI and MCP continue to share one context builder.
- Remote GitHub/CI evidence is explicitly excluded from 1.1.7.
- Each test target maps to a product behavior, not only an implementation detail.
