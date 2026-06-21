export const meta = {
  name: 'final-polish',
  description: 'Final polish: fix cross-package imports, rebuild dist, run tests, verify everything',
  phases: [
    { title: 'Fix', detail: 'Cross-package imports, dist rebuild' },
    { title: 'Test', detail: 'Run test suite, verify all green' },
    { title: 'Verify', detail: 'Final build, smoke check, Codex review' },
  ],
}

const ROOT = 'E:/my_idea_cc/my_copilot/memorix'

// ── Phase A: Fix ──────────────────────────────────────────────────
phase('Fix')

await agent(
  `Fix cross-package relative imports in memcode memory tools.

The current code uses fragile relative paths like:
- import("../../../../src/compact/engine.js")
- import("../../../../src/memory/observations.js")
- import("../../../../src/project/detector.js")

These cross package boundaries and will break if directory structure changes.

Fix approach: Use a path resolution helper that finds the memorix src/ directory at runtime.

1. Create packages/memcode/src/core/memorix-resolve.ts with a helper:

import { resolve, join } from "node:path";
import { existsSync } from "node:fs";

let _memorixSrcDir: string | null = null;

export function getMemorixSrcDir(): string {
  if (_memorixSrcDir) return _memorixSrcDir;

  // Walk up from __dirname to find src/memory/observations.ts
  let dir = __dirname;
  for (let i = 0; i < 10; i++) {
    const candidate = join(dir, "src", "memory", "observations.ts");
    if (existsSync(candidate)) {
      _memorixSrcDir = join(dir, "src");
      return _memorixSrcDir;
    }
    const parent = resolve(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("Cannot find memorix src/ directory");
}

2. Update packages/memcode/src/tools/memory-tools.ts:
   - Replace all "../../../../src/compact/engine.js" with dynamic import using getMemorixSrcDir()
   - Replace all "../../../../src/memory/observations.js" with dynamic import using getMemorixSrcDir()
   - Replace all "../../../../src/project/detector.js" with dynamic import using getMemorixSrcDir()

3. Update packages/memcode/src/memory/memory-injection.ts:
   - Replace "../../../../src/compact/engine.js" with dynamic import using getMemorixSrcDir()

4. Update packages/memcode/src/memory/memory-storage.ts:
   - Replace "../../../../src/memory/observations.js" with dynamic import using getMemorixSrcDir()

5. Update packages/memcode/src/extensions/memory-extension.ts:
   - Replace "../../../../src/project/detector.js" with dynamic import using getMemorixSrcDir()

The pattern for each file should be:
import { getMemorixSrcDir } from "../core/memorix-resolve.ts";

// In execute function:
const srcDir = getMemorixSrcDir();
const { compactSearch } = await import(join(srcDir, "compact", "engine.js"));

IMPORTANT: Keep all existing functionality. Only change the import paths.
`,
  { label: 'fix-imports', phase: 'Fix', mode: 'bypassPermissions' }
)

// ── Phase B: Test ─────────────────────────────────────────────────
phase('Test')

await agent(
  `Run the full test suite for memcode and fix any failures.

Steps:
1. cd ${ROOT}
2. Build all packages first:
   cd packages/tui && npx tsc -p tsconfig.build.json && cd ../..
   cd packages/ai && npx tsc -p tsconfig.build.json && cd ../..
   cd packages/agent-core && npx tsc -p tsconfig.build.json && cd ../..
   cd packages/memcode && npx tsc -p tsconfig.build.json && cd ../..
3. Build root: npm run build
4. Run tests: cd packages/memcode && npx vitest --run 2>&1 | head -100

If tests fail:
- Read the error messages
- Fix the source files
- Retry

Common issues:
- MEMCODE_* env vars not matching test expectations
- Import path changes breaking test mocks
- Missing test fixtures

Report: total tests, passed, failed, what you fixed.
`,
  { label: 'run-tests', phase: 'Test', mode: 'bypassPermissions' }
)

// ── Phase C: Verify ───────────────────────────────────────────────
phase('Verify')

await agent(
  `Final verification. Steps:

1. cd ${ROOT}
2. Full rebuild: npm run build
3. Verify dist files exist:
   - dist/cli/index.js (main CLI entry)
   - dist/memcode/index.js (memcode package)
   - dist/memcode/index.d.ts (type declarations)
4. Verify no PI_* references in user-facing code:
   grep -r "PI_" packages/memcode/src/ --include="*.ts" | grep -v "PI_PACKAGE_DIR" | grep -v "node_modules" | grep -v ".d.ts" | head -20
5. Verify .gitignore has packages/*/dist/
6. Verify session dir auto-creation logic exists

Report final status: build OK/FAIL, tests OK/FAIL, issues found.
`,
  { label: 'final-verify', phase: 'Verify', mode: 'bypassPermissions' }
)
