# Memcode Native Hooks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make memcode feed its own agent lifecycle into Memorix's native hook pipeline by default.

**Architecture:** Add a small in-process bridge in `packages/memcode/src/memory/memorix-hook-bridge.ts`. Wire it from `memory-extension.ts` so memcode keeps explicit memory tools and fast memory injection, but replaces simplistic `agent_end` turn storage with native hook capture for prompts, assistant responses, and tool results.

**Tech Stack:** TypeScript, Vitest, memcode Extension API, Memorix `src/hooks/handler.ts` loaded via `importFromMemorix()`.

---

### Task 1: Native Hook Bridge

**Files:**
- Create: `packages/memcode/src/memory/memorix-hook-bridge.ts`
- Test: `packages/memcode/test/memorix-hook-bridge.test.ts`

- [ ] **Step 1: Write failing bridge tests**

Test that the bridge builds normalized Memorix hook inputs from memcode prompt/tool/message events, skips empty assistant text, skips Memorix internal tool names through the existing handler policy, and swallows handler failures.

- [ ] **Step 2: Run bridge tests and verify RED**

Run: `npm --prefix packages/memcode test -- memorix-hook-bridge.test.ts`

Expected: FAIL because `memorix-hook-bridge.ts` does not exist yet.

- [ ] **Step 3: Implement bridge**

Export a `createMemorixHookBridge()` factory with methods:

- `captureUserPrompt(event, ctx)`
- `captureToolResult(event, ctx)`
- `captureAssistantMessage(event, ctx)`
- `captureSessionEnd(event, ctx)`

Each method builds a `NormalizedHookInput`-compatible object and passes it to a handler dependency. The default handler dynamically imports `handleHookEvent` from `hooks/handler.js`. If an observation is returned, the default handler stores it with the same project initialization path used by root `runHook()`.

- [ ] **Step 4: Run bridge tests and verify GREEN**

Run: `npm --prefix packages/memcode test -- memorix-hook-bridge.test.ts`

Expected: PASS.

### Task 2: Memory Extension Wiring

**Files:**
- Modify: `packages/memcode/src/extensions/memory-extension.ts`
- Test: `packages/memcode/test/memory-extension-native-hooks.test.ts`

- [ ] **Step 1: Write failing extension test**

Test that `memoryExtension()` registers `before_agent_start`, `message_end`, `tool_result`, and `agent_end` native hook handlers while keeping the three memory tools registered.

- [ ] **Step 2: Run extension test and verify RED**

Run: `npm --prefix packages/memcode test -- memory-extension-native-hooks.test.ts`

Expected: FAIL because current extension only registers `before_agent_start` and `agent_end` memory-storage behavior.

- [ ] **Step 3: Wire native bridge**

Replace `storeMemoryFromTurn()` usage with `createMemorixHookBridge()` calls. Keep `createMemoryInjectionHandler()` in `before_agent_start`, and additionally capture the submitted user prompt through the bridge.

- [ ] **Step 4: Run extension tests and verify GREEN**

Run: `npm --prefix packages/memcode test -- memory-extension-native-hooks.test.ts memorix-hook-bridge.test.ts`

Expected: PASS.

### Task 3: Build Verification

**Files:**
- No new files.

- [ ] **Step 1: Run focused tests**

Run: `npm --prefix packages/memcode test -- memorix-hook-bridge.test.ts memory-extension-native-hooks.test.ts`

Expected: PASS.

- [ ] **Step 2: Run existing memory command regression**

Run: `npm --prefix packages/memcode test -- interactive-mode-memory-command.test.ts slash-commands.test.ts`

Expected: PASS.

- [ ] **Step 3: Run package build**

Run: `npm --prefix packages/memcode run build`

Expected: exit code 0.
