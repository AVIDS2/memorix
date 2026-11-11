import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { CliFallbackBudget, fallbackRequestKey } from '../../src/cli/fallback-budget.js';
import { closeAllDatabases } from '../../src/store/sqlite-db.js';

let tempDir = '';

afterEach(async () => {
  closeAllDatabases();
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  tempDir = '';
});

describe('CLI fallback budget', () => {
  it('allows one request per task and blocks repeated probes', async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'memorix-fallback-'));
    const budget = new CliFallbackBudget();
    await budget.init(tempDir);
    const first = budget.claim('org/project', 'fix the session bug', 1000);
    const second = budget.claim('org/project', 'fix the session bug', 1001);
    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(false);
    expect(second.reason).toContain('budget exhausted');
    expect(fallbackRequestKey('org/project', 'fix the session bug')).toHaveLength(32);
  });

  it('reopens with the same budget state', async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'memorix-fallback-reopen-'));
    const first = new CliFallbackBudget();
    await first.init(tempDir);
    first.claim('org/project', 'same task', 1000);
    closeAllDatabases();
    const reopened = new CliFallbackBudget();
    await reopened.init(tempDir);
    expect(reopened.claim('org/project', 'same task', 1001).allowed).toBe(false);
  });
});
