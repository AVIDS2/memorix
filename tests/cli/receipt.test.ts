import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';

import receiptCommand from '../../src/cli/commands/receipt.js';
import doctorCommand from '../../src/cli/commands/doctor.js';
import memoryCommand from '../../src/cli/commands/memory.js';
import { closeAllDatabases } from '../../src/store/sqlite-db.js';
import { resetObservationStore } from '../../src/store/obs-store.js';
import { resetSessionStore } from '../../src/store/session-store.js';
import { resetTeamStore } from '../../src/team/team-store.js';
import { resetMiniSkillStore } from '../../src/store/mini-skill-store.js';
import { resetMiniSkillFreshness } from '../../src/memory/freshness.js';
import { resetDb } from '../../src/store/orama-store.js';

async function runCommand(command: any, args: Record<string, unknown>) {
  const logs: string[] = [];
  const errors: string[] = [];
  const logSpy = vi.spyOn(console, 'log').mockImplementation((...parts) => {
    logs.push(parts.map(String).join(' '));
  });
  const errSpy = vi.spyOn(console, 'error').mockImplementation((...parts) => {
    errors.push(parts.map(String).join(' '));
  });
  const originalExitCode = process.exitCode;
  process.exitCode = undefined;

  try {
    await command.run?.({ args, rawArgs: [], cmd: command } as any);
    return {
      stdout: logs.join('\n'),
      stderr: errors.join('\n'),
      exitCode: process.exitCode ?? 0,
    };
  } finally {
    process.exitCode = originalExitCode;
    logSpy.mockRestore();
    errSpy.mockRestore();
  }
}

describe('privacy-safe handoff receipt', () => {
  const originalCwd = process.cwd();
  const originalDataDir = process.env.MEMORIX_DATA_DIR;
  const originalEmbedding = process.env.MEMORIX_EMBEDDING;
  let sandboxRoot = '';
  let repoDir = '';
  let dataDir = '';

  beforeEach(() => {
    sandboxRoot = mkdtempSync(path.join(tmpdir(), 'memorix-receipt-'));
    repoDir = path.join(sandboxRoot, 'repo');
    dataDir = path.join(sandboxRoot, 'data');
    mkdirSync(repoDir, { recursive: true });
    writeFileSync(path.join(repoDir, 'README.md'), '# receipt test\n', 'utf8');
    execSync('git init', { cwd: repoDir, stdio: 'ignore' });
    process.chdir(repoDir);
    process.env.MEMORIX_DATA_DIR = dataDir;
    process.env.MEMORIX_EMBEDDING = 'off';
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    if (originalDataDir === undefined) {
      delete process.env.MEMORIX_DATA_DIR;
    } else {
      process.env.MEMORIX_DATA_DIR = originalDataDir;
    }
    if (originalEmbedding === undefined) {
      delete process.env.MEMORIX_EMBEDDING;
    } else {
      process.env.MEMORIX_EMBEDDING = originalEmbedding;
    }
    resetObservationStore();
    resetSessionStore();
    resetTeamStore();
    resetMiniSkillStore();
    resetMiniSkillFreshness();
    await resetDb();
    closeAllDatabases();
    rmSync(sandboxRoot, { recursive: true, force: true });
  });

  it('emits hashes and counts without leaking raw memory or query text', async () => {
    const secretText = 'The payment retry bug is fixed by checking order status before capture.';
    const probe = 'payment retry bug';
    await runCommand(memoryCommand, {
      _: ['store'],
      text: secretText,
      title: 'Payment retry fix',
      entity: 'payments',
      type: 'problem-solution',
      json: true,
    });

    const result = await runCommand(receiptCommand, {
      json: true,
      probe,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).not.toContain(secretText);
    expect(result.stdout).not.toContain(probe);
    expect(result.stdout).not.toContain(repoDir);

    const parsed = JSON.parse(result.stdout);
    expect(parsed['project.has_git']).toBe(true);
    expect(parsed['project.identity_hash']).toMatch(/^sha256:/);
    expect(parsed['memory.write.count']).toBe(1);
    expect(parsed['memory.write.ids_hash'][0]).toMatch(/^sha256:/);
    expect(parsed['memory.search.query_hash']).toMatch(/^sha256:/);
    expect(parsed['memory.search.result_count']).toBeGreaterThanOrEqual(1);
    expect(parsed.privacy.omitted).toContain('raw_memory_text');
    expect(parsed.boundary).toContain('stored memories are searchable');
  });

  it('reports no-git as a receipt diagnostic instead of inventing a project identity', async () => {
    const plainDir = path.join(sandboxRoot, 'plain');
    mkdirSync(plainDir, { recursive: true });
    process.chdir(plainDir);

    const result = await runCommand(receiptCommand, {
      json: true,
    });

    expect(result.exitCode).toBe(1);
    const parsed = JSON.parse(result.stderr);
    expect(parsed.error).toMatch(/git/i);
  });

  it('adds the receipt section to doctor JSON on request', async () => {
    await runCommand(memoryCommand, {
      _: ['store'],
      text: 'Receipt doctor integration should only expose hashes and counts.',
      title: 'Receipt doctor integration',
      entity: 'diagnostics',
      type: 'discovery',
      json: true,
    });

    const result = await runCommand(doctorCommand, {
      json: true,
      receipt: true,
    });

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.receipt['memory.write.count']).toBe(1);
    expect(parsed.receipt['project.identity_hash']).toMatch(/^sha256:/);
    expect(result.stdout).not.toContain('Receipt doctor integration should only expose');
  });
});
