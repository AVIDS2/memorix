export const meta = {
  name: 'tui-phase2',
  description: 'TUI Phase 2: Wire real agent runtime to TUI components',
  phases: [
    { title: 'Wire', detail: 'Connect agent runtime, message events, status events' },
    { title: 'Verify', detail: 'Build, test, Codex review' },
  ],
}

const ROOT = 'E:/my_idea_cc/my_copilot/memorix'

// ── Phase A: Wire agent runtime ───────────────────────────────────
phase('Wire')

await agent(
  `Wire the real agent runtime to the TUI components.

The TUI currently uses mock data. Connect it to the real agent session.

Key files to modify:
1. packages/memcode/src/tui/app.tsx — Accept runtime prop, wire up agent events
2. packages/memcode/src/tui/index.tsx — Pass runtime to App

The runtime object (AgentSessionRuntime) has these key APIs:
- runtime.session — the AgentSession instance
- runtime.session.agent — the Agent with state (messages, tools, model)
- runtime.session.prompt(text) — send a message
- runtime.session.steer(text) — interrupt and inject
- runtime.session.followUp(text) — queue follow-up

Agent events (via runtime.session.subscribe or extension handlers):
- message_start — new message being streamed
- message_update — streaming content update
- message_end — message complete
- tool_execution_start — tool call starting
- tool_execution_end — tool call complete
- turn_end — turn complete
- agent_end — all turns complete

For the TUI:
1. App should accept { runtime, cwd, sessionId } props
2. On user send (InputBar onSend):
   - Add user message to messages state
   - Call runtime.session.prompt(text)
   - Listen for agent events to update messages and status
3. On agent event:
   - message_start → set status to "Thinking..."
   - message_update → update streaming message content
   - message_end → add complete message to messages
   - tool_execution_start → set status to "Using [tool]..."
   - tool_execution_end → clear tool status
   - turn_end → clear status

IMPORTANT: The agent events are async. Use createSignal for reactive state.
Import from 'solid-js' for reactive primitives (createSignal, createEffect, on).

Read the current files first, then implement the wiring.
`,
  { label: 'wire-runtime', phase: 'Wire', mode: 'bypassPermissions' }
)

// ── Phase B: Verify ───────────────────────────────────────────────
phase('Verify')

await agent(
  `Verify TUI Phase 2 wiring.

Steps:
1. cd ${ROOT}/packages/memcode
2. Build: npx tsc -p tsconfig.build.json
3. Check for TypeScript errors
4. Verify:
   - App component accepts runtime prop
   - InputBar onSend calls runtime.session.prompt
   - Agent events update messages and status state
   - StatusBar shows real thinking status

Report: what compiled, what had errors, what you fixed.
`,
  { label: 'verify-wire', phase: 'Verify', mode: 'bypassPermissions' }
)
