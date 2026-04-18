import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Split into two projects:
    // 1. "main" — default parallel pool for unit/store/memory/orchestrate tests
    // 2. "sequential" — single-worker pool for heavy integration tests that
    //    spawn real HTTP servers / CLI subprocesses, and TUI tests with
    //    Ink async rendering timing sensitivity. These flake under parallel
    //    load because they compete for CPU, ports, and temp directories.
    projects: [
      {
        test: {
          name: 'main',
          globals: true,
          environment: 'node',
          include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
          exclude: [
            'tests/e2e/**',
            'tests/integration/formation-llm-quality.test.ts',
            // Heavy tests run in the "sequential" project instead
            'tests/integration/release-blockers.test.ts',
            'tests/integration/serve-http.test.ts',
            'tests/integration/http-embedding-fallback.test.ts',
            'tests/tui/interaction.test.tsx',
            // Hooks tests share global ~/.memorix/audit.json — must run sequentially
            'tests/hooks/install-uninstall.test.ts',
            'tests/hooks/opencode-compaction.test.ts',
            'tests/hooks/copilot-paths.test.ts',
            'tests/hooks/copilot-windows-compat.test.ts',
          ],
        },
      },
      {
        test: {
          name: 'sequential',
          globals: true,
          environment: 'node',
          include: [
            'tests/integration/release-blockers.test.ts',
            'tests/integration/serve-http.test.ts',
            'tests/integration/http-embedding-fallback.test.ts',
            'tests/tui/interaction.test.tsx',
            // Hooks tests share global ~/.memorix/audit.json
            'tests/hooks/install-uninstall.test.ts',
            'tests/hooks/opencode-compaction.test.ts',
            'tests/hooks/copilot-paths.test.ts',
            'tests/hooks/copilot-windows-compat.test.ts',
          ],
          // Run one file at a time — no parallelism, no port/CPU races
          // @ts-expect-error — fileParallelism is valid at project level per vitest docs
          fileParallelism: false,
        },
      },
    ],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
    },
  },
});
