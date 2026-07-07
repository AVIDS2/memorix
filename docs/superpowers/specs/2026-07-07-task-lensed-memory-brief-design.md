# Task-Lensed Memory Brief 1.1.7 Design

Branch: `codex/1.1.7-task-lensed-brief`
Date: 2026-07-07
Status: approved for autonomous implementation

## Summary

1.1.7 improves Memory Autopilot from a fixed project summary into a task-lensed brief. The user or agent should be able to say one natural task sentence, and Memorix should infer the likely work mode, rank context accordingly, and avoid dumping generic memory noise.

This release keeps the existing local-first model. It does not add cloud sync, a new database schema, or a full external code intelligence engine. It uses the current CodeGraph Memory, observations, current project facts, and task text to produce a better first packet for coding agents.

## Product Promise

Memorix should feel like a black-box helper without becoming mysterious:

- The user says what they are doing.
- The agent calls `memorix_project_context` or `memorix context --task`.
- Memorix infers the task lens and gives the agent the right kind of map.
- Old memory is treated as evidence with trust labels, not as truth.
- The brief stays compact enough to be useful in a real context window.

The user should not have to know whether the next context should come from text memory, CodeGraph Memory, Git facts, dev logs, or verification hints.

## Problem

The 1.1.6 brief is reliable but still generic. It includes current project facts, Start here files, reliable memory, stale/suspect warnings, and usage hints, but it does not use the task to decide what kind of context matters.

That creates three product problems:

1. A release task, bugfix, feature task, onboarding task, and refactor task all receive the same shape of brief.
2. Large memory stores can surface too many low-value suspect warnings, commit-message memories, or unrelated code hot spots.
3. The user still feels some of the memory system mechanics instead of getting a clean "here is what this agent needs right now" handoff.

## Goals

### P1: Task Lens Classifier

Add a deterministic local classifier that maps natural task text to one lens:

- `bugfix`
- `feature`
- `release`
- `onboarding`
- `refactor`
- `docs`
- `test`
- `general`

The classifier must be transparent, cheap, offline, and easy to extend. No LLM call is required.

### P2: Lens-Aware Brief Policy

Use the selected lens to change:

- the one-line task focus,
- Start here ranking,
- reliable memory limit,
- suspect warning behavior,
- suggested verification hints,
- and "How to use this" instructions.

The output should still be one compact brief, not a new command family.

### P3: Noise Suppression

Hide low-value suspicious memory by default when it is not task-relevant. Summarize counts and show only the most relevant warnings. Commit-message-shaped and duplicate-looking memories should be less prominent unless they directly match the task.

### P4: Shared CLI and MCP Behavior

`memorix context --task ...`, MCP `memorix_project_context`, and summary/json formats should share the same lens decision. JSON output should include the selected lens and brief policy metadata for debugging.

### P5: Agent Guidance Refresh

Generated rules and official skills should teach agents the new black-box behavior in plain terms: ask for project context with the user's actual task, inspect the lens-suggested files, verify the current code, then store durable outcomes.

### P6: Release Readiness

Update version and changelog to 1.1.7, run focused tests, build/lint, and smoke the built CLI. MCP smoke should verify `memorix_project_context` still returns a task-lensed brief.

## Non-Goals

- Full semantic code search or replacement of external CodeGraph/Understand tools.
- Remote GitHub PR/CI/release evidence as first-class stored evidence. That belongs in a later release.
- Schema migration for memory trust metadata.
- LLM-based classification.
- Forcing every user to run CodeGraph refresh manually.

## Architecture

Keep the existing `src/codegraph/auto-context.ts` entry point as the owner of the default brief. Add a small task-lens module in `src/codegraph/task-lens.ts` with focused responsibilities:

- classify task text,
- expose lens labels and human descriptions,
- provide lens policy values,
- rank candidate paths and sources using the policy,
- provide verification hints.

`buildAutoProjectContext` should include the selected lens in `AutoProjectContext`. Formatting functions should use that lens to shape text. The existing CodeGraph store, current-facts reader, and project-context collector remain unchanged unless a tiny exported helper is needed.

## Lens Policy

Each lens changes emphasis rather than changing the tool contract.

- `bugfix`: prefer files and memories matching error, failure, test, issue, crash, regression, and mentioned path tokens. Verification should suggest the smallest failing test or smoke command.
- `feature`: prefer source entry points, adjacent modules, types, routes, components, and task-matching memories. Verification should suggest focused tests plus a user-flow smoke.
- `release`: prefer changelog, package metadata, Git state, CI/build/package smoke, and release docs. Memory should be secondary unless current code-bound.
- `onboarding`: prefer README, docs, architecture, package metadata, and broad source entry points. Hide most suspect memory unless it is clearly relevant.
- `refactor`: prefer call sites, shared modules, types, tests, and impact notes. Verification should mention affected tests and a small regression pass.
- `docs`: prefer README/docs/changelog and code files only when task terms match. Verification should mention link/heading checks.
- `test`: prefer tests, fixtures, harnesses, and related source files. Verification should mention the exact smallest test run.
- `general`: keep the current balanced behavior.

## Data Flow

1. CLI or MCP passes `task`.
2. `buildAutoProjectContext` refreshes CodeGraph Memory as before.
3. `resolveTaskLens(task)` returns lens metadata and policy.
4. The formatter ranks Start here paths and memory sources through the lens.
5. The prompt and summary include `Task lens: ...`.
6. JSON includes `lens` so agents and tests can inspect why the brief looked different.

## Error Handling

If task text is empty or ambiguous, use `general`. If lens ranking yields no useful files, fall back to existing suggested reads and a direct task-relevant inspection hint. If CodeGraph refresh fails, keep the current failure message and still render current facts plus lens-specific next steps.

## Testing

Add focused tests for:

- deterministic lens classification,
- bugfix brief prioritizing test/source paths and bug verification hints,
- release brief surfacing package/changelog/Git guidance before memory,
- onboarding brief preferring README/docs and hiding unrelated suspect detail,
- CLI JSON including lens metadata,
- MCP project context returning the same lens-aware text.

Existing auto-context, CLI context, hook/setup, lint, build, and smoke checks remain the release gate.

## Acceptance Criteria

- `memorix context --task "fix login regression"` prints `Task lens: bugfix` and gives bugfix-shaped verification.
- `memorix context --task "prepare 1.1.7 release"` prints `Task lens: release` and prioritizes release facts.
- MCP `memorix_project_context({ task })` returns the same task-lensed brief.
- JSON output includes the selected lens.
- The brief is more compact under noisy suspect memory stores and shows warnings as grouped cautions.
- Docs and changelog describe 1.1.7 accurately.
