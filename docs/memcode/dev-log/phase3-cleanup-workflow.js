export const meta = {
  name: 'phase3-cleanup',
  description: 'Phase 3 cleanup: fix tests, session dir auto-create, gitignore, TUI polish',
  phases: [
    { title: 'Fix', detail: 'Test files, session dir, gitignore' },
    { title: 'Polish', detail: 'TUI welcome, interaction experience' },
    { title: 'Verify', detail: 'Build, test suite, Codex review' },
  ],
}

const ROOT = 'E:/my_idea_cc/my_copilot/memorix'

// ── Phase A: Fix (parallel) ───────────────────────────────────────
phase('Fix')

await parallel([
  // A1: Fix test files — PI_* → MEMCODE_*
  () => agent(
    `Fix all test files in packages/memcode/test/ that use old PI_* environment variable names.

The source code now reads MEMCODE_* env vars (with PI_* fallbacks). But test files still set PI_* vars directly. Update them to use MEMCODE_* instead.

Files to fix:
- test/package-manager.test.ts — PI_OFFLINE → MEMCODE_OFFLINE
- test/version-check.test.ts — PI_SKIP_VERSION_CHECK, PI_OFFLINE → MEMCODE_SKIP_VERSION_CHECK, MEMCODE_OFFLINE
- test/rpc.test.ts — PI_CODING_AGENT_DIR → MEMCODE_CODING_AGENT_DIR
- test/theme-picker.test.ts — PI_CODING_AGENT_DIR → MEMCODE_CODING_AGENT_DIR
- test/theme-export.test.ts — PI_CODING_AGENT_DIR → MEMCODE_CODING_AGENT_DIR
- test/session-id-readonly.test.ts — PI_OFFLINE → MEMCODE_OFFLINE
- test/startup-session-name.test.ts — PI_OFFLINE → MEMCODE_OFFLINE
- test/suite/regressions/2791-fswatch-error-crash.test.ts — PI_CODING_AGENT_DIR → MEMCODE_CODING_AGENT_DIR

For each file:
1. Read the file
2. Replace all PI_OFFLINE with MEMCODE_OFFLINE
3. Replace all PI_SKIP_VERSION_CHECK with MEMCODE_SKIP_VERSION_CHECK
4. Replace all PI_CODING_AGENT_DIR with MEMCODE_CODING_AGENT_DIR
5. Replace all PI_TIMING with MEMCODE_TIMING
6. Replace all PI_PACKAGE_DIR with MEMCODE_PACKAGE_DIR
7. Replace all PI_STARTUP_BENCHMARK with MEMCODE_STARTUP_BENCHMARK

Use replace_all: true for each replacement.

IMPORTANT: Also check packages/tui/test/ for any PI_* references and fix them too.
`,
    { label: 'fix-tests', phase: 'Fix', mode: 'bypassPermissions' }
  ),

  // A2: Session directory auto-creation
  () => agent(
    `Ensure the ~/.memorix/sessions/ directory is auto-created when memcode starts.

Check packages/memcode/src/core/session-manager.ts:
1. Find where the session directory is used (getDefaultSessionDirPath or similar)
2. Add mkdirSync with recursive: true before the first write to ensure the directory exists
3. The directory should be created lazily (on first session save), not at startup

Also check packages/memcode/src/config.ts:
1. getSessionsDir() returns the path but doesn't create it
2. Add a ensureSessionsDir() function that creates the directory if it doesn't exist
3. Call it from session-manager before writing the first JSONL file

The pattern should be:
import { mkdirSync } from 'node:fs';
mkdirSync(sessionDir, { recursive: true });
`,
    { label: 'session-dir', phase: 'Fix', mode: 'bypassPermissions' }
  ),

  // A3: .gitignore update
  () => agent(
    `Update .gitignore to include packages/ build artifacts.

Read the current .gitignore at the project root. Add these entries if not already present:

# memcode packages (built from source)
packages/*/dist/
packages/*/.tsbuildinfo

# CodeGraph
.codegraph/

# Session files
*.jsonl

Do NOT add packages/ itself to .gitignore — only the dist/ subdirectories.
`,
    { label: 'gitignore', phase: 'Fix', mode: 'bypassPermissions' }
  ),
])

// ── Phase B: Polish (parallel) ────────────────────────────────────
phase('Polish')

await parallel([
  // B1: TUI welcome message
  () => agent(
    `Improve the memcode TUI welcome experience.

Search packages/memcode/src/modes/interactive/interactive-mode.ts for:
1. The welcome/onboarding message shown when memcode starts
2. The first-run experience
3. Any generic Pi messaging

Update the welcome message to be more helpful and memcode-branded:
- Welcome text should mention that memcode has persistent memory
- Should hint at memorix_search/memorix_store tools
- Should be concise (2-3 lines max)

Example:
"Welcome to memcode — your coding assistant with persistent memory.
Your decisions, fixes, and insights are remembered across sessions.
Type a message to get started."

Also check if there's a help command or /help slash command that lists available tools. Make sure it mentions the memory tools.
`,
    { label: 'tui-welcome', phase: 'Polish', mode: 'bypassPermissions' }
  ),

  // B2: TUI status bar — show memory status
  () => agent(
    `Add memory status to the TUI status bar or info display.

Search packages/memcode/src/modes/interactive/ for where status information is shown:
- Status bar at bottom of TUI
- /session or /status command output
- Any info panel

Add a line showing memory status, like:
"Memory: 1496 observations indexed"

This should be computed once at startup by reading the observation count from the memorix store. Don't make it a blocking call — if it fails, just show "Memory: unavailable".

Look at how other status info (model name, session path, etc.) is displayed and follow the same pattern.
`,
    { label: 'tui-status', phase: 'Polish', mode: 'bypassPermissions' }
  ),
])

// ── Phase C: Verify ───────────────────────────────────────────────
phase('Verify')

await agent(
  `Verify all Phase 3 cleanup changes. Steps:

1. cd ${ROOT}
2. Build all packages:
   cd packages/tui && npx tsc -p tsconfig.build.json && cd ../..
   cd packages/ai && npx tsc -p tsconfig.build.json && cd ../..
   cd packages/agent-core && npx tsc -p tsconfig.build.json && cd ../..
   cd packages/memcode && npx tsc -p tsconfig.build.json && cd ../..
3. Build root: npm run build
4. Run tests: npx vitest --run (in packages/memcode/)
5. Check for errors and fix them

6. Verify:
   - Test files use MEMCODE_* env vars (grep for PI_OFFLINE in test files)
   - Session dir auto-creation works
   - .gitignore includes packages/*/dist/

Report: what compiled, what had errors, what you fixed, test results.
`,
  { label: 'verify-cleanup', phase: 'Verify', mode: 'bypassPermissions' }
)
