export const meta = {
  name: 'tui-phase1-fix',
  description: 'Fix TUI Phase 1 critical issues from Codex review',
  phases: [
    { title: 'Fix', detail: 'Fix critical and high issues' },
    { title: 'Verify', detail: 'Build and verify' },
  ],
}

const ROOT = 'E:/my_idea_cc/my_copilot/memorix'

// ── Phase A: Fix critical issues ──────────────────────────────────
phase('Fix')

await parallel([
  // Fix 1: InputBar — focused prop, keyboard handler, @ trigger, cursorColor
  () => agent(
    `Fix critical issues in InputBar component.

File: ${ROOT}/packages/memcode/src/tui/components/inputbar.tsx

Fix these issues:
1. Add focused prop to <input> element (required for OpenTUI to accept keystrokes)
2. Remove cursorColor prop (not valid in OpenTUI)
3. Fix @ trigger detection — e.name is not "@" for Shift+2. Instead, detect @ in the handleInput callback by checking if the input value contains @
4. Fix useKeyboard in activeMode — don't call preventDefault() for non-special keys, only for enter/escape/up/down/tab. Let other keys pass through to the Input component.
5. Fix stale closure in handleInput — remove useCallback wrapping, use regular function
6. Fix selectedIdx bounds check — reset to 0 when filtered list changes

Read the file first, then apply fixes surgically.
`,
    { label: 'fix-inputbar', phase: 'Fix', mode: 'bypassPermissions' }
  ),

  // Fix 2: App component — compose all sub-components
  () => agent(
    `Fix App component to compose all sub-components and wire up to agent runtime.

File: ${ROOT}/packages/memcode/src/tui/app.tsx

The App component currently renders just two static text strings. Fix it to:
1. Import and render Header, InputBar, MessageList, StatusBar components
2. Accept props: { runtime: any, cwd: string, sessionId: string }
3. Use createSignal for messages, status, memoryCount
4. Wire up InputBar onSend to add user message and trigger agent response
5. Wire up agent events to update status and messages

For now, create a simple mock agent response (just echo back the user's message) until the real agent runtime is wired up. This ensures the TUI is functional for testing.

Read the file first, then rewrite it to compose all components.
`,
    { label: 'fix-app', phase: 'Fix', mode: 'bypassPermissions' }
  ),

  // Fix 3: index.tsx — pass runtime to App
  () => agent(
    `Fix TUI entry point to accept and pass runtime to App.

File: ${ROOT}/packages/memcode/src/tui/index.tsx

Currently startTui() takes zero arguments. Fix it to:
1. Accept runtime parameter (the AgentSessionRuntime from main.ts)
2. Pass runtime to App component
3. Export startTui with correct signature

Also update main.ts to pass the runtime:
File: ${ROOT}/packages/memcode/src/main.ts
Find the line: await startTui()
Change to: await startTui(runtime)

Read both files first, then apply fixes.
`,
    { label: 'fix-entry', phase: 'Fix', mode: 'bypassPermissions' }
  ),
])

// ── Phase B: Verify ───────────────────────────────────────────────
phase('Verify')

await agent(
  `Verify TUI Phase 1 fixes.

Steps:
1. cd ${ROOT}/packages/memcode
2. Build: npx tsc -p tsconfig.build.json
3. Check for TypeScript errors
4. Verify all components exist and are properly imported
5. Verify App component composes Header, InputBar, MessageList, StatusBar

Report: what compiled, what had errors, what you fixed.
`,
  { label: 'verify-fixes', phase: 'Verify', mode: 'bypassPermissions' }
)
