# Memory Autopilot 1.1.5 Implementation Plan

Goal: ship 1.1.5 as the Memory Autopilot release: better default project context, safer agent/tool surfaces, stronger context-pack quality, updated agent rules, and release-ready verification.

## Phase 1: Spec and Baseline

Files:

- `docs/superpowers/specs/2026-07-02-memory-autopilot-1.1.5-design.md`
- `docs/superpowers/plans/2026-07-02-memory-autopilot-1.1.5.md`

Verification:

- `git status --short --branch`
- spec and plan exist with P1-P9 scope and no placeholder sections.

## Phase 2: Safety Regression

Files:

- `packages/agent-core/src/agent-loop.ts`
- `packages/agent-core/test/agent-loop.test.ts`
- `packages/memcode/src/modes/interactive/components/session-selector-search.ts`
- matching memcode test file if one exists, otherwise add focused coverage.

Implementation:

- Add an explicit helper or guard that treats `context.tools` as the turn allowlist.
- Add a regression test where a model requests a tool that is registered elsewhere but absent from the current context; the call must not execute.
- Replace unsafe user-input regex search with literal matching or escaped regex.

Verification:

- `npx vitest run packages/agent-core/test/agent-loop.test.ts`
- focused memcode test for session selector search.

## Phase 3: Context Pack Quality

Files:

- `src/codegraph/context-pack.ts`
- `tests/codegraph/context-pack.test.ts`

Implementation:

- Add lower-trust unbound memories to context packs when task-relevant.
- Keep stale/suspect memories in warnings, not reliable memory.
- Keep path filtering and compact limits.
- Add verification hints that tell agents what must be inspected before trusting old memory.

Verification:

- `npx vitest run tests/codegraph/context-pack.test.ts`

## Phase 4: Autopilot Brief Format

Files:

- `src/codegraph/auto-context.ts`
- `src/codegraph/project-context.ts` if the shared formatting needs a small helper.
- `tests/codegraph/auto-context.test.ts`
- `tests/cli/context-command.test.ts`
- `tests/hooks/handler-e2e.test.ts`

Implementation:

- Format default context as `Memorix Autopilot Brief`.
- Include Start here, Reliable memory, Verify before trusting, Suggested verification, and How to use this.
- Preserve JSON shapes unless a new optional field is needed.

Verification:

- `npx vitest run tests/codegraph/auto-context.test.ts tests/cli/context-command.test.ts tests/hooks/handler-e2e.test.ts`

## Phase 5: Freshness and Ranking Policy

Files:

- `src/codegraph/context-pack.ts`
- `src/codegraph/auto-context.ts`
- `docs/API_REFERENCE.md`

Implementation:

- Make ranking behavior obvious in code names and docs.
- Ensure current code-bound facts are first, stale/suspect warnings are separate, and unbound text is labeled lower trust.

Verification:

- targeted CodeGraph tests from Phases 3 and 4.

## Phase 6: Internal Self-Loop Rules

Files:

- `src/hooks/rules/memorix-agent-rules.md`
- `src/hooks/official-skills.ts`
- generated docs or setup snapshots if tests require updates.

Implementation:

- Update rules so agents use Memorix as a loop: project context, inspect code, store durable outcomes, bind/refresh, resolve stale memories.
- Keep language concise and tool-neutral.

Verification:

- hook/setup tests that snapshot or assert rules text.

## Phase 7: User-Facing Docs and UX

Files:

- `README.md`
- `README.zh-CN.md`
- `docs/API_REFERENCE.md`
- `CHANGELOG.md`
- relevant memcode docs if surfaced there.

Implementation:

- Present Memory Autopilot as the default path.
- Keep CodeGraph commands as advanced controls.
- Add 1.1.5 changelog entry.

Verification:

- docs links and headings render logically.
- no fake domains or unsupported claims.

## Phase 8: Dogfood and MCP Smoke

Commands:

- `npm run build`
- `npm run lint`
- targeted Vitest suites from Phases 2-6.
- `node dist\cli\index.js context --task "continue Memory Autopilot work" --refresh auto`
- MCP/tool profile tests for `memorix_project_context`, `memorix_context_pack`, and `memorix_codegraph_status`.

Success:

- Built CLI returns an agent-ready brief.
- MCP tool registry exposes the expected context tools.
- Smoke does not require leaking any API keys.

## Phase 9: Release 1.1.5

Files:

- root and workspace `package.json`
- `package-lock.json`
- `CHANGELOG.md`

Implementation:

- Bump versions to `1.1.5`.
- Run final package verification.
- Push branch, open PR, merge after checks, publish npm, create GitHub release.

Verification:

- `npm pack --dry-run`
- GitHub Actions/PR checks where available.
- `npm view memorix version` after publish.
