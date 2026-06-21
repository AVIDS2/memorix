export const meta = {
  name: 'tui-redesign-opencode',
  description: 'TUI visual redesign to opencode-style minimalist aesthetic',
  phases: [
    { title: 'Theme', detail: 'Rewrite theme tokens with muted palette' },
    { title: 'Layout', detail: 'Central logo, centered input, clean status bar' },
    { title: 'Polish', detail: 'Components visual refinement' },
    { title: 'Verify', detail: 'Build, test, visual check' },
  ],
}

const ROOT = 'E:/my_idea_cc/my_copilot/memorix'

// ── Phase 1: Theme tokens ─────────────────────────────────────────
phase('Theme')

await agent(
  `Rewrite the theme tokens for a modern, minimalist, premium developer tool aesthetic.

File: ${ROOT}/packages/memcode/src/tui/theme.ts

Current theme uses high-saturation colors. Replace with a muted, sophisticated palette:

Design principles:
- Muted monochromatic colors (slate gray, dark charcoal, dim white)
- Non-essential text should have low contrast (dimmed)
- Red ONLY for fatal crashes
- Subtle pastel accents for interactive elements

New theme tokens:
  // Brand — subtle, not screaming
  brand:          '#7C8AFF',   // soft indigo, not bright blue
  brandDim:       '#3D4273',   // dark muted indigo

  // Semantic — muted, not neon
  success:        '#6BCB77',   // soft green, not bright
  warning:        '#E8A838',   // warm amber, not neon orange
  error:          '#E85D5D',   // muted red, not screaming
  info:           '#9BA4B5',   // cool gray-blue

  // Text — sophisticated hierarchy
  textPrimary:    '#E2E8F0',   // soft white, not pure white
  textSecondary:  '#8B95A5',   // medium gray
  textMuted:      '#4A5568',   // dim gray for metadata

  // Background — deep, not black
  bgBase:         '#0F1117',   // deep dark blue-black
  bgElevated:     '#1A1D27',   // slightly lighter for header/footer
  bgBorder:       '#2D3148',   // subtle border

  // Git — muted
  gitAdded:       '#6BCB77',
  gitModified:    '#E8A838',
  gitDeleted:     '#E85D5D',
  gitBranch:      '#9BA4B5',

  // Memory — subtle
  memHit:         '#7C8AFF',
  memPromoted:    '#6BCB77',
  memExpired:     '#4A5568',

  // New: surface colors for cards/panels
  bgSurface:      '#151821',   // card background
  bgSurfaceHover: '#1E2233',   // hover state
  borderSubtle:   '#252940',   // very subtle borders

Export the theme object. All components will import from this file.
IMPORTANT: No hardcoded colors anywhere else.
`,
  { label: 'theme-tokens', phase: 'Theme', mode: 'bypassPermissions' }
)

// ── Phase 2: Layout — central logo + centered input ───────────────
phase('Layout')

await parallel([
  // A: Main App layout — centered, breathing room
  () => agent(
    `Rewrite the main App layout to match opencode's minimalist style.

File: ${ROOT}/packages/memcode/src/tui/app.tsx

Current layout: everything crammed against edges, no breathing room.
Target: centered, elegant, with padding and whitespace.

Layout structure:
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│                                                             │
│                    ◆ MEMCODE                                │
│                    current version                           │
│                                                             │
│        ┌────────────────────────────────────────┐          │
│        │ Ask anything...                        │          │
│        └────────────────────────────────────────┘          │
│                                                             │
│   project: memorix · branch: main · 1530 memories          │
│                                                             │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│  DeepSeek-V4 Pro · high                          esc  ctrl+c │
└─────────────────────────────────────────────────────────────┘

Key changes:
1. Full-screen flex column with alignItems: center
2. Central logo section with padding top/bottom (min 20% of height)
3. Input box centered, with subtle border, elegant placeholder
4. Project info line below input (dim, small)
5. Footer: model info left, shortcuts right, both dim
6. NO log dumping in the main view
7. Status messages (thinking, tool use) appear briefly above input, then disappear

The logo should be simple text, not ASCII art:
  ◆ MEMCODE
  current version

Use theme tokens from theme.ts. No hardcoded colors.

Props: { runtime: AgentSessionRuntime }
Import hooks from 'react', OpenTUI hooks from '@opentui/react'
`,
    { label: 'app-layout', phase: 'Layout', mode: 'bypassPermissions' }
  ),

  // B: Header — minimal, elegant
  () => agent(
    `Rewrite the Header component to be minimal and elegant.

File: ${ROOT}/packages/memcode/src/tui/components/header.tsx

Current: dense wall of metadata text.
Target: single line, dim, spaced out.

Layout:
  memorix · main · 1530 memories · session:a3f9k

Rules:
- All text in theme.textMuted color
- Separator: middle dot (·) with spacing
- Git branch in theme.gitBranch (subtle, not screaming)
- Memory count in theme.textMuted (only show if > 0)
- Session ID shortened to last 6 chars
- NO background color, just text on the base background
- Height: 1 line

Props: { cwd: string, memoryCount: number, sessionId: string }
Import theme from '../theme.ts'
`,
    { label: 'header-minimal', phase: 'Layout', mode: 'bypassPermissions' }
  ),

  // C: Footer — clean, split layout
  () => agent(
    `Rewrite the Footer/StatusBar to be clean and split.

File: ${ROOT}/packages/memcode/src/tui/components/statusbar.tsx

Current: dense, unreadable wall of text.
Target: clean split layout.

Layout:
  DeepSeek-V4 Pro · high                    esc  ctrl+c

Rules:
- Left side: model name + thinking level (theme.textSecondary)
- Right side: keyboard shortcuts (theme.textMuted)
- Separator between left and right: flexible space
- NO spinner animation (remove the braille characters)
- Status messages (Thinking..., Using tool...) appear ABOVE the footer, not in it
- Status messages use theme.warning, auto-clear after response arrives
- Height: 1 line

Props: { model?: string, thinkingLevel?: string, status?: string }
Import theme from '../theme.ts'
`,
    { label: 'footer-clean', phase: 'Layout', mode: 'bypassPermissions' }
  ),
])

// ── Phase 3: Components polish ────────────────────────────────────
phase('Polish')

await parallel([
  // A: InputBar — elegant, centered
  () => agent(
    `Rewrite InputBar to be elegant and centered.

File: ${ROOT}/packages/memcode/src/tui/components/inputbar.tsx

Current: functional but ugly.
Target: elegant centered input with subtle styling.

Layout:
  ┌────────────────────────────────────────────────────┐
  │ Ask anything...                           128tok   │
  └────────────────────────────────────────────────────┘

Rules:
- Centered horizontally (max width ~75% of terminal)
- Subtle border (theme.borderSubtle), round corners if supported
- Placeholder text in theme.textMuted
- Token count in theme.textMuted, right-aligned
- NO attachment preview line (keep it simple for now)
- NO slash command suggestions in the input (show as overlay above)
- Input text in theme.textPrimary
- Focus indicator: border changes to theme.brand (subtle)

For slash commands and @ mentions:
- Show as a floating panel ABOVE the input box
- Panel has theme.bgSurface background
- Items in theme.textPrimary
- Selected item highlighted with theme.bgSurfaceHover

Remove all complex state management for now. Keep it simple:
- Input text state
- Slash command detection (/)
- Enter to send

Import hooks from 'react', OpenTUI hooks from '@opentui/react'
Import theme from '../theme.ts'
`,
    { label: 'inputbar-elegant', phase: 'Polish', mode: 'bypassPermissions' }
  ),

  // B: MessageList — clean, with breathing room
  () => agent(
    `Rewrite MessageList and message components for clean rendering.

File: ${ROOT}/packages/memcode/src/tui/components/messages.tsx

Current: functional but needs visual polish.
Target: clean message rendering with proper spacing.

Message layout:
  You
  ┌────────────────────────────────────────────────────┐
  │ What is the tech stack of this project?            │
  └────────────────────────────────────────────────────┘

  memcode
  ┌────────────────────────────────────────────────────┐
  │ This project uses TypeScript with...               │
  │ (markdown rendered content)                         │
  │                                                     │
  │ ─── memory sources ─────────────────────────────── │
  │ project:arch-decision×2  global:style×1            │
  └────────────────────────────────────────────────────┘

Rules:
- User messages: "You" label in theme.brand, content in theme.textPrimary
- Assistant messages: "memcode" label in theme.textSecondary, content via <markdown>
- Message box: subtle border (theme.borderSubtle), rounded
- Padding inside box: 1 top/bottom, 2 left/right
- Spacing between messages: 1 line
- Memory attribution: dim separator line + sources in theme.memHit
- NO ToolCall blocks in message list (remove for now, add back later)
- Auto-scroll to bottom on new messages

Import hooks from 'react'
Import theme from '../theme.ts'
Use OpenTUI <markdown> for assistant content
`,
    { label: 'messages-clean', phase: 'Polish', mode: 'bypassPermissions' }
  ),
])

// ── Phase 4: Verify ───────────────────────────────────────────────
phase('Verify')

await agent(
  `Verify TUI redesign builds correctly.

Steps:
1. cd ${ROOT}/packages/memcode
2. Build: npx tsc -p tsconfig.build.json
3. Check for TypeScript errors
4. Fix any errors
5. cd ${ROOT} && npm run build

Report: what compiled, what had errors, what you fixed.
`,
  { label: 'verify-redesign', phase: 'Verify', mode: 'bypassPermissions' }
)
