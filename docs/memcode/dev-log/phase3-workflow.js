export const meta = {
  name: 'phase3-polish',
  description: 'Phase 3: Polish — embedding auto, TUI branding, session index, documentation',
  phases: [
    { title: 'Config', detail: 'Embedding auto, session path fix, de-Pi cleanup' },
    { title: 'TUI', detail: 'TUI branding, welcome message, status bar' },
    { title: 'Verify', detail: 'Build, real test, Codex review' },
  ],
}

const ROOT = 'E:/my_idea_cc/my_copilot/memorix'

// ── Phase A: Config (parallel) ────────────────────────────────────
phase('Config')

await parallel([
  // A1: Embedding default → auto
  () => agent(
    `Change the embedding default from "off" to "auto" in memcode.

Search packages/memcode/src/config.ts for the embedding configuration. Look for:
- "embedding" or "embeddingMode" or "embeddingProvider"
- Default values like "off" or false

Change the default to "auto" so that:
- If fastembed is available locally, use it
- Otherwise, fall back to pure BM25 (no embedding)

Also check if there's a setting in the Memorix core (src/config.ts or src/embedding/) that controls the default. If so, note it but don't change the core — only change the memcode package's default.

The goal: memcode should automatically use local embedding if available, without requiring manual configuration.
`,
    { label: 'embedding-auto', phase: 'Config', mode: 'bypassPermissions' }
  ),

  // A2: De-Pi cleanup — remaining "pi" references in user-facing code
  () => agent(
    `Clean up remaining "pi" references in memcode user-facing code.

Search packages/memcode/src/ for strings containing "pi" that are user-facing:
1. Error messages mentioning "pi" (e.g., "PI_OFFLINE", "PI_SKIP_VERSION_CHECK")
2. Log messages mentioning "pi"
3. Help text mentioning "pi"
4. Default config values mentioning "pi"

Replace with "memcode" or "memorix" as appropriate.

Do NOT change:
- Internal variable names (piConfig, PI_PACKAGE_DIR, etc.) — those are code
- Package names in package.json
- Import paths
- The vendor/pi/ directory

Focus on USER-FACING strings only. Check:
- src/config.ts (env var names like PI_OFFLINE → MEMCODE_OFFLINE)
- src/main.ts (help text, error messages)
- src/cli/ (command descriptions)
- src/modes/ (TUI messages)
`,
    { label: 'depi-cleanup', phase: 'Config', mode: 'bypassPermissions' }
  ),
])

// ── Phase B: TUI (parallel) ───────────────────────────────────────
phase('TUI')

await parallel([
  // B1: TUI welcome message and branding
  () => agent(
    `Update the memcode TUI welcome message and branding.

Search packages/memcode/src/modes/interactive/ for:
1. Welcome messages, greetings, or splash text
2. The TUI header/title that shows the agent name
3. Status bar text
4. Any "Pi" or "pi" branding in the interactive mode

Replace with memcode branding:
- "Pi" → "memcode"
- "Pi v0.79.0" → "memcode v1.0.11"
- Any Pi-specific messaging → memorix-themed messaging

Also check if there's a logo or ASCII art. If so, consider replacing with a simple "memcode" text banner.

Be surgical — only change display strings, not internal logic.
`,
    { label: 'tui-welcome', phase: 'TUI', mode: 'bypassPermissions' }
  ),

  // B2: Session path verification
  () => agent(
    `Verify that the session path is correctly set to ~/.memorix/sessions/.

Check packages/memcode/src/config.ts:
1. ENV_SESSION_DIR should point to ~/.memorix/sessions/
2. getAgentDir() should return ~/.memorix/
3. Any other path references should use .memorix, not .pi

Also check packages/memcode/src/core/session-manager.ts:
1. The default session directory should be ~/.memorix/sessions/
2. The session file naming should work correctly

If any .pi references remain in path configuration, change them to .memorix.

Note: There may be migration code that reads from .pi/ for backward compatibility — that's fine, leave it.
`,
    { label: 'session-verify', phase: 'TUI', mode: 'bypassPermissions' }
  ),
])

// ── Phase C: Verify ───────────────────────────────────────────────
phase('Verify')

await agent(
  `Verify Phase 3 changes. Steps:

1. cd ${ROOT}
2. Build all packages: cd packages/tui && npx tsc -p tsconfig.build.json && cd ../ai && npx tsc -p tsconfig.build.json && cd ../agent-core && npx tsc -p tsconfig.build.json && cd ../memcode && npx tsc -p tsconfig.build.json && cd ../..
3. Build root: npm run build
4. Check for errors and fix them

5. Verify:
   - No "pi" in user-facing strings (grep for "pi" in display text)
   - Session path is .memorix
   - Embedding default is auto

Report: what compiled, what had errors, what you fixed.
`,
  { label: 'verify-p3', phase: 'Verify', mode: 'bypassPermissions' }
)
