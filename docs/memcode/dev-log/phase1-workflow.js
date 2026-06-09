export const meta = {
  name: 'phase1-skeleton',
  description: 'Phase 1: Set up packages/ structure, npm workspaces, build config, CLI routing, verify compilation',
  phases: [
    { title: 'Copy', detail: 'Copy Pi source into packages/, rename to @memorix/*' },
    { title: 'Configure', detail: 'Set up npm workspaces, build config, CLI routing' },
    { title: 'Verify', detail: 'Install dependencies, build, fix errors' },
  ],
}

const ROOT = 'E:/my_idea_cc/my_copilot/memorix'
const VENDOR = `${ROOT}/vendor/pi/packages`

// ── Phase A: Copy and setup packages ──────────────────────────────
phase('Copy')

await agent(
  `Copy Pi source into packages/ and rename for memorix monorepo.

Steps:
1. Copy these directories from vendor/pi/packages/ to packages/:
   - vendor/pi/packages/ai/ → packages/ai/
   - vendor/pi/packages/agent/ → packages/agent-core/
   - vendor/pi/packages/tui/ → packages/tui/
   - vendor/pi/packages/coding-agent/ → packages/memcode/

   Use: xcopy /E /I "source" "dest" (Windows)

2. In each copied package's package.json, rename:
   - packages/ai/package.json: name → "@memorix/ai"
   - packages/agent-core/package.json: name → "@memorix/agent-core"
   - packages/tui/package.json: name → "@memorix/tui"
   - packages/memcode/package.json: name → "@memorix/memcode"

3. In packages/memcode/package.json, update dependencies to use workspace refs:
   - "@earendil-works/pi-ai" → "workspace:*"
   - "@earendil-works/pi-agent-core" → "workspace:*"
   - "@earendil-works/pi-tui" → "workspace:*"

4. In packages/agent-core/package.json, update dependencies:
   - "@earendil-works/pi-ai" → "workspace:*"

5. In packages/memcode/package.json, update the bin entry:
   - "pi" → "memcode"

6. Remove vendor-specific files from copied packages:
   - Delete packages/*/CHANGELOG.md if exists
   - Delete any .github/ directories

7. In packages/memcode/package.json, change piConfig.configDir from ".pi" to ".memorix"

IMPORTANT: Do NOT modify vendor/pi/ — keep it as upstream reference.
All paths are absolute: ${ROOT} is the project root.
`,
  { label: 'copy-packages', phase: 'Copy', mode: 'bypassPermissions' }
)

// ── Phase B: Configure (parallel) ─────────────────────────────────
phase('Configure')

await parallel([
  () => agent(
    `Update the root package.json at ${ROOT}/package.json to add npm workspaces.

Read the current package.json, then update it:
1. Add "workspaces" field:
   "workspaces": ["packages/ai", "packages/agent-core", "packages/tui", "packages/memcode"]

2. Make sure "type": "module" is set.

3. Keep all existing fields (name, version, description, bin, main, types, exports, scripts, dependencies, etc.) unchanged.

Do NOT modify any other package.json files — only the root one.
`,
    { label: 'config-workspaces', phase: 'Configure', mode: 'bypassPermissions' }
  ),

  () => agent(
    `Update tsup.config.ts at ${ROOT}/tsup.config.ts to add the memcode package entry.

Read the current tsup.config.ts, then add a new entry for the memcode package:
- entry: ['packages/memcode/src/index.ts']
- format: ['esm']
- dts: true
- clean: false
- outDir: 'dist/memcode'

Keep all existing entries unchanged (src/index.ts and src/cli/index.ts).

If the file uses defineConfig from tsup, add the new entry to the array.
`,
    { label: 'config-tsup', phase: 'Configure', mode: 'bypassPermissions' }
  ),

  () => agent(
    `Update the CLI entry point at ${ROOT}/src/cli/index.ts to route bare "memorix" command to memcode TUI.

Read the current src/cli/index.ts to understand its structure.

The key change: when process.argv has NO subcommand (just "memorix" with no args), instead of showing help or doing nothing, import and start the memcode TUI.

Add this logic near the top of the command routing:
\`\`\`typescript
// If no args provided, enter memcode TUI (native coding agent)
if (args.length === 0) {
  try {
    const { startMemcode } = await import('../memcode/index.js');
    await startMemcode();
    return;
  } catch (err) {
    console.error('Failed to start memcode:', err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
\`\`\`

Also add a new subcommand "memcode" that does the same thing:
\`\`\`typescript
if (args[0] === 'memcode') {
  const { startMemcode } = await import('../memcode/index.js');
  await startMemcode();
  return;
}
\`\`\`

IMPORTANT: Be surgical — only add the routing logic, don't restructure the entire file.
`,
    { label: 'config-cli', phase: 'Configure', mode: 'bypassPermissions' }
  ),
])

// ── Phase C: Verify ───────────────────────────────────────────────
phase('Verify')

await agent(
  `Verify the monorepo setup compiles. Steps:

1. cd ${ROOT}
2. Run: npm install (to link workspaces)
3. Run: npx tsc --noEmit --project packages/tui/tsconfig.json (check tui)
4. Run: npx tsc --noEmit --project packages/ai/tsconfig.json (check ai)
5. Run: npx tsc --noEmit --project packages/agent-core/tsconfig.json (check agent-core)
6. Run: npx tsc --noEmit --project packages/memcode/tsconfig.json (check memcode)
7. Run: npm run build (check full build)

For each step, if there are errors:
- Read the error messages
- Fix the source files
- Retry

Common issues to fix:
- Import paths still referencing old @earendil-works/* package names
- Missing workspace:* dependency resolution
- TypeScript path alias issues

Report: what compiled clean, what had errors, what you fixed.
`,
  { label: 'verify-build', phase: 'Verify', mode: 'bypassPermissions' }
)
