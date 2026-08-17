/**
 * CLI Command: memorix hook
 *
 * Entry point called by agent hooks via stdin/stdout.
 * Reads agent's JSON from stdin, normalizes, auto-stores, outputs response.
 *
 * This command is short-lived. A leftover `memorix hook` process is a bug:
 * hosts invoke it on every event, and hung copies exhaust RAM.
 *
 * Usage (called by agent hook configs, not by users directly):
 *   memorix hook
 *
 * Env:
 *   MEMORIX_HOOK_TIMEOUT_MS — wall-clock budget (default 20000)
 *   MEMORIX_HOOK_STDIN_TIMEOUT_MS — stdin idle budget (default 3000)
 *   MEMORIX_HOOK_HEAP_MB — V8 heap for this command only (default 512)
 */

import { defineCommand } from 'citty';

export default defineCommand({
  meta: {
    name: 'hook',
    description: 'Handle agent hook event (called by agent hook configs)',
  },
  args: {
    agent: {
      type: 'string',
      description: 'Source agent identifier (e.g. gemini-cli). Injected by generated hook configs for reliable agent detection.',
      required: false,
    },
    event: {
      type: 'string',
      description: 'Source hook event name when the host does not include it in stdin.',
      required: false,
    },
  },
  run: async ({ args }) => {
    const { runHook } = await import('../../hooks/handler.js');
    const { resolveHookTimeoutMs, runHookWithDeadline } = await import('../../hooks/lifecycle.js');
    await runHookWithDeadline({
      timeoutMs: resolveHookTimeoutMs(),
      run: () => runHook(args.agent as string | undefined, args.event as string | undefined),
    });
  },
});
