/**
 * Memorix CLI
 *
 * Command-line interface for Memorix management.
 * Built with: citty (1.1K stars, zero-deps) + @clack/prompts (7.4K stars)
 *
 * Commands:
 *   memorix serve   — Start MCP Server on stdio
 *   memorix status  — Show project info + rules sync status
 *   memorix sync    — Interactive cross-agent rule sync
 */

import { defineCommand, runMain } from 'citty';

// ============================================================
// Main command
// ============================================================

const main = defineCommand({
  meta: {
    name: 'memorix',
    version: '0.3.7',
    description: 'Cross-Agent Memory Bridge — Universal memory layer for AI coding agents via MCP',
  },
  subCommands: {
    serve: () => import('./commands/serve.js').then(m => m.default),
    status: () => import('./commands/status.js').then(m => m.default),
    sync: () => import('./commands/sync.js').then(m => m.default),
    hook: () => import('./commands/hook.js').then(m => m.default),
    hooks: () => import('./commands/hooks.js').then(m => m.default),
  },
  run() {
    // Default: show help (citty handles this automatically)
  },
});

runMain(main);
