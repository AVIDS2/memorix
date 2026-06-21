# Memcode Native Hooks Design

## Goal

Memcode should use Memorix as a first-party runtime capability, not as an external MCP tool layer. Since memcode ships inside this repository and already embeds the Pi-derived agent runtime, it should feed its own lifecycle into Memorix's native hook pipeline by default.

The user-facing outcome is simple: open memcode, work normally, and useful project knowledge is captured and recalled without asking the user to install hooks, configure MCP, or manually call memory tools.

## Non-Goals

- Do not store raw transcripts by default.
- Do not store every assistant message.
- Do not replace explicit memory tools such as `memorix_search`, `memorix_store`, and `memorix_detail`.
- Do not require `memorix hooks install` for memcode itself.
- Do not make hook failures block the agent response.

## Existing State

Memorix already has a hook pipeline under `src/hooks/`:

- `normalizer.ts` converts agent-specific payloads into `NormalizedHookInput`.
- `handler.ts` classifies events, applies policies, stores observations, injects session-start context, and optionally runs Formation in shadow mode.
- `significance-filter.ts` rejects greetings, trivial commands, retrieved results, secrets, and other low-value content.
- `pattern-detector.ts` maps durable patterns into observation types such as decision, gotcha, problem-solution, and what-changed.

Memcode currently has partial memory integration:

- `packages/memcode/src/extensions/memory-extension.ts` registers memory tools.
- `memory-injection.ts` injects relevant memories before a turn.
- `memory-storage.ts` stores a simplistic assistant-turn summary after `agent_end`.

That last part is the weak point. It bypasses Memorix's mature hook pipeline and makes memcode feel like an external integration instead of the native Memorix agent.

## Recommended Architecture

Add a small in-process bridge, tentatively:

`packages/memcode/src/memory/memorix-hook-bridge.ts`

The bridge maps memcode extension events into Memorix-native hook events and calls the existing hook handler/storage path directly.

Primary mapping:

- `before_agent_start` -> `session_start` context behavior plus `user_prompt` capture.
- `tool_result` -> `post_tool`, with tool name, sanitized input metadata, result text, cwd, and session id.
- `message_end` for final assistant text -> `post_response`.
- `agent_end` -> optional `session_end` only when a durable summary is available.
- compaction events later -> `pre_compact` / `post_compact`.

The bridge should live below the extension surface so it works for TUI, print, and future RPC modes whenever the memory extension is enabled.

## Storage Policy

Default-on does not mean store-everything.

The first implementation should rely on existing hook filtering:

- ordinary greetings and acknowledgements are ignored;
- memory search/detail outputs are ignored to avoid self-pollution;
- `memorix_*` tool calls are ignored by the existing tool taxonomy;
- read/list/search tools are either skipped or stored only when substantial;
- write/edit/bash/test results can become `what-changed`, `problem-solution`, `gotcha`, or `decision` when significant;
- assistant final responses are stored only when they contain durable technical knowledge.

This preserves the production value of memory: decisions, fixes, project conventions, pitfalls, and verified outcomes.

## Safety And UX

- Hook execution must be best-effort and non-blocking where possible.
- Errors should be logged with concise `[memcode] native hook ... failed` diagnostics.
- No full secrets, API keys, private keys, or token-like payloads should be stored.
- Startup UI may later show "native hooks active", but the first implementation should avoid noisy banners.
- `/memory stats`, `/memory diff`, and future `/memory hooks` can expose status without requiring setup.

## Implementation Phases

1. Build `memorix-hook-bridge.ts` with pure mapping helpers and tests.
2. Replace `memory-storage.ts` usage in `memory-extension.ts` with the bridge for `tool_result`, `message_end`, and `agent_end`.
3. Keep `memory-injection.ts` for fast pre-turn retrieval, but align session-start behavior with the hook pipeline over time.
4. Add tests proving ordinary chat is not stored, useful tool/assistant outcomes are stored, Memorix internal tool results are skipped, and hook failures never break a turn.

## Verification

Run focused memcode tests first:

```powershell
npm --prefix packages/memcode test -- memory
npm --prefix packages/memcode test -- native-hooks
```

Then run:

```powershell
npm --prefix packages/memcode run build
```

Manual smoke check:

```powershell
node .\packages\memcode\dist\cli.js --offline
```

Confirm that a normal conversation does not create noisy memories, while a real code edit/test/fix produces durable hook-backed observations.
