export const meta = {
  name: 'tui-phase345',
  description: 'TUI Phase 3-5: Interaction, memory features, completeness',
  phases: [
    { title: 'Phase3', detail: 'ToolCall, Slash commands, Toast, Dialog' },
    { title: 'Phase4', detail: 'Memory features, git integration' },
    { title: 'Phase5', detail: 'Vim mode, session commands, completeness' },
    { title: 'Verify', detail: 'Build, test, Codex review' },
  ],
}

const ROOT = 'E:/my_idea_cc/my_copilot/memorix'

// ── Phase 3: Interaction Quality ──────────────────────────────────
phase('Phase3')

await parallel([
  // P3-1: ToolCallBlock component
  () => agent(
    `Create ToolCallBlock component for displaying tool calls.

File: ${ROOT}/packages/memcode/src/tui/components/toolcall.tsx

Three states: running → done | error

Layout:
  ✓ bash  0.3s  ▸     (collapsed, done)
  ✓ bash  0.3s  ▾     (expanded, done)
    $ echo hello
    hello

Features:
- Status icon: Spinner (running), ✓ (done), ✗ (error)
- Tool name in bold
- Execution time display (e.g., "0.3s")
- Expand/collapse toggle (Space/Tab)
- When expanded: show input params and result
- Input shown as <code> component from OpenTUI
- Result shown as text

Props: { name: string, input: any, result?: string, status: 'running' | 'done' | 'error', duration?: number }

Import theme from '../theme.ts'
Use OpenTUI React: <box>, <text>, <code>
`,
    { label: 'toolcall', phase: 'Phase3', mode: 'bypassPermissions' }
  ),

  // P3-2: Slash command system
  () => agent(
    `Create slash command system for memcode TUI.

File: ${ROOT}/packages/memcode/src/tui/components/slash-commands.tsx

Three execution modes:
1. No-arg commands → execute directly (/clear, /help, /vim, /doctor)
2. Selector commands → show picker (/session load, /memory show, /model switch)
3. Text-input commands → fill input (/memory search, /remember)

Command list:
── No-arg ──
/clear, /help, /vim, /doctor, /inspect, /clone, /git status, /memory stats, /memory diff, /session export, /session, /config, /exit

── Selector ──
/session load, /session delete, /session new, /resume, /tree, /fork, /memory show, /memory delete, /memory promote, /model switch, /theme, /git commit

── Text-input ──
/memory search, /remember, /label, /git diff

Implementation:
- Export a COMMANDS array with { name, description, mode, execute? }
- Filter by substring match as user types
- Show as flat list with name + description
- Use OpenTUI <select> component for picker mode

Import theme from '../theme.ts'
`,
    { label: 'slash-commands', phase: 'Phase3', mode: 'bypassPermissions' }
  ),

  // P3-3: Toast system
  () => agent(
    `Create Toast notification system.

File: ${ROOT}/packages/memcode/src/tui/components/toast.tsx

Components:
1. useToast() hook — returns { toasts, show(msg, type) }
2. ToastContainer — renders toasts in top-right corner

Toast types: info (brand color), success (green), error (red)
Auto-dismiss after 2500ms
Stack vertically if multiple

Props: { toasts: Toast[] }
Toast = { id: number, msg: string, type: 'info' | 'success' | 'error' }

Import theme from '../theme.ts'
Use OpenTUI React: <box>, <text>
`,
    { label: 'toast', phase: 'Phase3', mode: 'bypassPermissions' }
  ),

  // P3-4: Dialog system
  () => agent(
    `Create Dialog system for confirmations and selections.

File: ${ROOT}/packages/memcode/src/tui/components/dialog.tsx

Components:
1. Dialog — modal with title, message, confirm/cancel
2. useDialog() hook — returns { dialog, confirm(msg), select(items) }

Dialog layout:
  ┌─────────────────────────┐
  │ Title                   │
  │ Message                 │
  │ [y] confirm  [n/esc]    │
  └─────────────────────────┘

Features:
- Centered on screen
- Border with brand color
- y/n keyboard shortcuts
- Esc to cancel
- Backdrop dim (if supported)

Import theme from '../theme.ts'
Use OpenTUI React: <box>, <text>
`,
    { label: 'dialog', phase: 'Phase3', mode: 'bypassPermissions' }
  ),
])

// ── Phase 4: Memory Features ──────────────────────────────────────
phase('Phase4')

await parallel([
  // P4-1: MemoryAttribution component (already exists, enhance)
  () => agent(
    `Enhance MemoryAttribution component with better visual design.

File: ${ROOT}/packages/memcode/src/tui/components/messages.tsx

Current MemoryAttribution shows:
  retrieved: project:arch-decision×2  global:style×1

Enhance to:
1. Show memory count in header (e.g., "3 memories retrieved")
2. Each source as a pill/badge with bucket:key format
3. Color coding: project memories in brand, global in info
4. Clickable (future: show detail on click)

Also update the AssistantMessage component to pass attribution data from agent events.
The attribution should come from the memory search results stored in the message metadata.

Import theme from '../theme.ts'
`,
    { label: 'memory-attribution', phase: 'Phase4', mode: 'bypassPermissions' }
  ),

  // P4-2: /memory commands implementation
  () => agent(
    `Implement /memory command handlers.

File: ${ROOT}/packages/memcode/src/tui/commands/memory-commands.ts

Commands to implement:
1. /memory stats — show memory count, bucket distribution, hit rate
2. /memory search <query> — search memories, show results
3. /memory show — list recent memories with picker
4. /memory diff — show memory changes in current session
5. /memory promote — promote last AI response to memory
6. /memory delete — show picker, confirm delete

Each command should:
- Call the appropriate memorix function (compactSearch, storeObservation, etc.)
- Format output for display
- Use Toast for success/error feedback

Export a MEMORY_COMMANDS object with handler functions.

Import from memorix core using importFromMemorix:
import { importFromMemorix } from '../../core/memorix-resolve.ts'
`,
    { label: 'memory-commands', phase: 'Phase4', mode: 'bypassPermissions' }
  ),

  // P4-3: Git integration
  () => agent(
    `Implement git integration for memcode TUI.

File: ${ROOT}/packages/memcode/src/tui/integrations/git.ts

Features:
1. getGitInfo(cwd) — returns { branch, dirty, ahead, behind }
2. getGitDiff(cwd) — returns staged + unstaged diff summary
3. hasDirtyFiles(cwd) — boolean check
4. Auto-inject git diff context when sending messages (if dirty files exist)

Use simple-git library (already installed).

Also create /git commands:
- /git status — show git status
- /git diff — show diff summary
- /git commit — generate commit message via LLM, confirm, execute

Export GIT_COMMANDS object.
`,
    { label: 'git-integration', phase: 'Phase4', mode: 'bypassPermissions' }
  ),
])

// ── Phase 5: Completeness ─────────────────────────────────────────
phase('Phase5')

await parallel([
  // P5-1: Session commands
  () => agent(
    `Implement /session commands.

File: ${ROOT}/packages/memcode/src/tui/commands/session-commands.ts

Commands:
1. /session — show current session info (ID, messages, tokens, file path)
2. /session new — create new session
3. /session load — show session picker, load selected
4. /session delete — show picker, confirm delete
5. /session export — export to markdown file
6. /resume — alias for /session load
7. /tree — show session tree, navigate branches
8. /fork — fork from current node to new session
9. /clone — clone current branch to new session
10. /label <name> — bookmark current position

Use SessionManager API from packages/memcode/src/core/session-manager.ts
Export SESSION_COMMANDS object.
`,
    { label: 'session-commands', phase: 'Phase5', mode: 'bypassPermissions' }
  ),

  // P5-2: InputBar enhancements
  () => agent(
    `Enhance InputBar with advanced features.

File: ${ROOT}/packages/memcode/src/tui/components/inputbar.tsx

Add:
1. Input history — ↑/↓ to navigate previous inputs, Ctrl+R to search
2. @ memory picker — type @ to trigger memory fuzzy search
3. Attachment preview — show attached files
4. Token count display — estimate tokens in current input
5. Multi-line support — Shift+Enter for newline

For @ memory picker:
- When user types @, search memories with compactSearch
- Show results in a dropdown/select
- On select, inject memory context into message

For input history:
- Store last 100 inputs in localStorage or file
- ↑/↓ to navigate
- Ctrl+R for reverse search

Import theme from '../theme.ts'
Use OpenTUI React: <box>, <text>, <input>, <select>
`,
    { label: 'inputbar-enhance', phase: 'Phase5', mode: 'bypassPermissions' }
  ),

  // P5-3: Keyboard shortcuts and vim mode
  () => agent(
    `Implement keyboard shortcuts and vim mode.

File: ${ROOT}/packages/memcode/src/tui/keymap.ts

Global shortcuts:
- Esc — interrupt generation (first Esc: vim normal, second: interrupt)
- Ctrl+C — exit (with dialog confirm)
- ? — show help

Chat area:
- j/k — scroll down/up
- g/G — top/bottom
- PgUp/PgDn — page scroll

Tool call:
- Space/Tab — expand/collapse
- n/N — next/prev tool call

Memory:
- p — promote last AI response to memory

Vim mode:
- /vim or Esc toggle
- States: INSERT, NORMAL, VISUAL
- Display in footer

Export a setupKeymap(app) function that registers all shortcuts.
Use OpenTUI's useKeyboard hook.
`,
    { label: 'keymap-vim', phase: 'Phase5', mode: 'bypassPermissions' }
  ),
])

// ── Phase 6: Verify ───────────────────────────────────────────────
phase('Verify')

await agent(
  `Final verification of TUI Phase 3-5.

Steps:
1. cd ${ROOT}/packages/memcode
2. Build: npx tsc -p tsconfig.build.json
3. Check for TypeScript errors
4. Verify all new files exist:
   - src/tui/components/toolcall.tsx
   - src/tui/components/slash-commands.tsx
   - src/tui/components/toast.tsx
   - src/tui/components/dialog.tsx
   - src/tui/commands/memory-commands.ts
   - src/tui/commands/session-commands.ts
   - src/tui/integrations/git.ts
   - src/tui/keymap.ts
5. Verify App component imports and uses all new components
6. Run build again after any fixes

Report: what compiled, what had errors, what you fixed.
`,
  { label: 'verify-all', phase: 'Verify', mode: 'bypassPermissions' }
)
