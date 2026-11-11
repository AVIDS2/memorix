/**
 * Direct memcode CLI entry for users who want the native coding agent without
 * typing `memorix memcode`.
 */

import { importBundledMemcode } from './memcode-bootstrap.js';
import { installCliPipeErrorGuard } from './pipe-errors.js';

installCliPipeErrorGuard();

async function main(): Promise<void> {
  try {
    const { runCli } = await importBundledMemcode();
    await runCli(process.argv.slice(2));
  } catch (err) {
    console.error('Failed to start memcode:', err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

void main();
