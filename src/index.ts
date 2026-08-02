#!/usr/bin/env node

/**
 * Package entry point.
 *
 * `memorix serve` is the documented MCP command. Keep the historical
 * `node dist/index.js` route working by delegating to that exact runtime,
 * while making a normal package import side-effect free.
 */

import path from 'node:path';
import { pathToFileURL } from 'node:url';

export { createMemorixServer } from './server.js';
export type { CreateMemorixServerOptions } from './server.js';

function isDirectEntrypoint(): boolean {
  const entry = process.argv[1];
  return Boolean(entry && import.meta.url === pathToFileURL(path.resolve(entry)).href);
}

function directServeArgs(argv: string[]): { cwd?: string; mode?: string; 'allow-untracked': boolean } {
  const args: { cwd?: string; mode?: string; 'allow-untracked': boolean } = { 'allow-untracked': false };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--allow-untracked') {
      args['allow-untracked'] = true;
      continue;
    }
    if ((value === '--cwd' || value === '--mode') && argv[index + 1]) {
      args[value.slice(2) as 'cwd' | 'mode'] = argv[index + 1];
      index += 1;
    }
  }
  return args;
}

async function runDirectStdioServer(): Promise<void> {
  const { default: serveCommand } = await import('./cli/commands/serve.js');
  const run = serveCommand.run as ((input: { args: ReturnType<typeof directServeArgs> }) => Promise<void>) | undefined;
  if (!run) throw new Error('Memorix stdio server command is unavailable');
  await run({ args: directServeArgs(process.argv.slice(2)) });
}

if (isDirectEntrypoint()) {
  runDirectStdioServer().catch((error) => {
    console.error('[memorix] Fatal error:', error);
    process.exitCode = 1;
  });
}
