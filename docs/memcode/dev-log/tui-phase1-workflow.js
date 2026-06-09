export const meta = {
  name: 'tui-phase1',
  description: 'TUI Phase 1: OpenTUI + React foundation, theme, header, inputbar',
  phases: [
    { title: 'Setup', detail: 'Install OpenTUI, create theme, setup entry' },
    { title: 'Components', detail: 'Header, InputBar, MessageList, StatusBar' },
    { title: 'Verify', detail: 'Build, test, Codex review' },
  ],
}

const ROOT = 'E:/my_idea_cc/my_copilot/memorix'

// ── Phase A: Setup ────────────────────────────────────────────────
phase('Setup')

await agent(
  `Set up OpenTUI + React foundation for memcode TUI.

Working directory: ${ROOT}/packages/memcode

1. Install dependencies (use bun):
   cd ${ROOT}/packages/memcode
   bun add @opentui/core @opentui/react simple-git nanoid

2. Create packages/memcode/src/tui/theme.ts with the complete theme token system:
   Export a 'theme' object with all color tokens from the design doc:
   - brand: '#4A9EFF', brandDim: '#1e3a5f'
   - success: '#22C55E', warning: '#F97316', error: '#EF4444', info: '#818CF8'
   - textPrimary: '#F1F5F9', textSecondary: '#94A3B8', textMuted: '#475569'
   - bgBase: '#0D1117', bgElevated: '#161B22', bgBorder: '#30363D'
   - gitAdded/Modified/Deleted/Branch colors
   - memHit: '#4A9EFF', memPromoted: '#22C55E', memExpired: '#475569'

3. Create packages/memcode/src/tui/app.tsx — the main App component:
   Import from @opentui/core and @opentui/react
   Use createCliRenderer and createRoot for entry
   Render a simple box with "memcode" text to verify it works

4. Create packages/memcode/src/tui/index.tsx — entry point:
   Export a startTui() function that:
   - Creates the CLI renderer
   - Creates the React root
   - Renders the App component

5. Update packages/memcode/src/main.ts:
   - In the interactive mode branch, import and call startTui() instead of the old InteractiveMode
   - Keep the old code as fallback (comment it out, don't delete)

IMPORTANT: Use bun for package management, not npm. The OpenTUI packages require Bun runtime.
`,
  { label: 'setup-opentui', phase: 'Setup', mode: 'bypassPermissions' }
)

// ── Phase B: Components ───────────────────────────────────────────
phase('Components')

await parallel([
  // B1: Header component
  () => agent(
    `Create the Header component for memcode TUI.

File: packages/memcode/src/tui/components/header.tsx

The header shows 1 line of meta info:
◆ memcode  memorix  main±3  BM25  1222mem  sess:a3f9k  [bg]

Color scheme:
- ◆ memcode → theme.brand bold
- memorix (project name) → theme.textPrimary
- main (git branch) → theme.gitBranch, ±3 (dirty count) → theme.gitModified
- BM25 (retrieval mode) → theme.textMuted
- 1222mem → theme.success (if memories exist) / theme.textMuted (if none)
- sess:a3f9k → theme.textMuted
- [bg] → theme.warning (show only when background tasks running)

Use simple-git to get branch and dirty count:
import simpleGit from 'simple-git'
const git = simpleGit(cwd)
const branch = await git.revparse(['--abbrev-ref', 'HEAD'])
const status = await git.status()

Component should accept props: { cwd: string, memoryCount: number, sessionId: string }

Use OpenTUI React components: <box>, <text>
Import theme from '../theme.ts'
`,
    { label: 'header', phase: 'Components', mode: 'bypassPermissions' }
  ),

  // B2: InputBar component
  () => agent(
    `Create the InputBar component for memcode TUI.

File: packages/memcode/src/tui/components/inputbar.tsx

Fixed at bottom of screen. Layout:
[📎 attachment]  › type here...  128tok  [esc]

Features:
- Text input area with placeholder
- Token count display (estimate ~4 chars per token)
- Attachment preview line (when files attached)
- Slash command suggestions (when typing /)
- @ memory picker (when typing @)

Use OpenTUI React:
- <box> for layout (flexDirection: row)
- <text> for labels
- Input handling via useKeyboard from @opentui/core

Import theme from '../theme.ts'

Props: { onSend: (text: string) => void, attachments?: string[] }
`,
    { label: 'inputbar', phase: 'Components', mode: 'bypassPermissions' }
  ),

  // B3: MessageList + basic message components
  () => agent(
    `Create MessageList and basic message components.

File: packages/memcode/src/tui/components/messages.tsx

Components:
1. MessageList — scrollbox container for all messages
   - Uses <scrollbox> from OpenTUI
   - Auto-scrolls to bottom on new messages
   - paddingBottom to avoid overlap with InputBar

2. UserMessage — user's input display
   - "You" label in theme.brand bold
   - Content in theme.textPrimary
   - Attachment preview if any

3. AssistantMessage — AI response display
   - "memcode" label in theme.textMuted bold
   - Content rendered with <markdown> from OpenTUI (native markdown!)
   - MemoryAttribution at bottom (if memories were used)

4. MemoryAttribution — memcode unique feature
   - Shows "retrieved: project:arch-decision×2  global:style×1"
   - Each source in theme.memHit color

Import theme from '../theme.ts'

Props:
- MessageList: { messages: Message[] }
- UserMessage: { content: string, attachments?: string[] }
- AssistantMessage: { content: string, attribution?: MemorySource[] }
`,
    { label: 'messages', phase: 'Components', mode: 'bypassPermissions' }
  ),

  // B4: StatusBar component
  () => agent(
    `Create the StatusBar component.

File: packages/memcode/src/tui/components/statusbar.tsx

Shows dynamic thinking/status info between messages:
⠋ Searching 1222 memories...
⠋ Found 3 relevant memories
⠋ Thinking...

Rules:
- Only visible when status is non-empty
- First token arrives → immediately hide
- Spinner animation (⠋⠋⠋ cycle)
- Text in theme.warning color

Use OpenTUI React:
- <box> for layout
- <text> for status text

Import theme from '../theme.ts'

Props: { status: string }
`,
    { label: 'statusbar', phase: 'Components', mode: 'bypassPermissions' }
  ),
])

// ── Phase C: Verify ───────────────────────────────────────────────
phase('Verify')

await agent(
  `Verify TUI Phase 1 implementation.

Steps:
1. cd ${ROOT}/packages/memcode
2. Check that @opentui/core and @opentui/react are in package.json dependencies
3. Verify theme.ts exists with all tokens
4. Verify components exist: header.tsx, inputbar.tsx, messages.tsx, statusbar.tsx
5. Verify app.tsx and index.tsx exist
6. Try to build: bun build src/tui/index.tsx --outdir dist/tui --target bun
7. Check for TypeScript errors

Report: what files were created, what compiled, what had errors.
`,
  { label: 'verify-tui', phase: 'Verify', mode: 'bypassPermissions' }
)
