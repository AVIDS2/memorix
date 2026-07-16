import { afterEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  MAINTENANCE_RESULT_PREFIX,
  parseMaintenanceRunnerOutput,
  resolveMaintenanceRunnerPath,
  runMaintenanceInChildProcess,
} from '../../src/runtime/isolated-maintenance.js';
import type { MaintenanceJob } from '../../src/runtime/maintenance-jobs.js';

const temporaryPaths: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryPaths.splice(0).map((filePath) => fs.rm(filePath, { recursive: true, force: true })));
});

function makeJob(overrides: Partial<MaintenanceJob> = {}): MaintenanceJob {
  return {
    id: 'job-1',
    projectId: 'project-a',
    kind: 'codegraph-refresh',
    dedupeKey: 'graph',
    payload: {},
    status: 'running',
    attempts: 1,
    maxAttempts: 8,
    runAfter: 0,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

async function createRunner(source: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'memorix-maintenance-runner-'));
  temporaryPaths.push(dir);
  const runner = path.join(dir, 'runner.mjs');
  await fs.writeFile(runner, source, 'utf8');
  return runner;
}

describe('isolated maintenance runner', () => {
  it('resolves the compiled runner from both library and CLI bundles', () => {
    expect(resolveMaintenanceRunnerPath('file:///C:/pkg/dist/index.js')).toBe('C:\\pkg\\dist\\maintenance-runner.js');
    expect(resolveMaintenanceRunnerPath('file:///C:/pkg/dist/cli/index.js')).toBe('C:\\pkg\\dist\\maintenance-runner.js');
  });

  it('parses only the explicit runner result line, ignoring ordinary child output', () => {
    const output = [
      'refreshing 12 files',
      `${MAINTENANCE_RESULT_PREFIX}{"action":"reschedule","delayMs":0,"resetAttempts":true}`,
    ].join('\n');
    expect(parseMaintenanceRunnerOutput(output)).toEqual({
      action: 'reschedule',
      delayMs: 0,
      resetAttempts: true,
    });
  });

  it('does not expose a child credential in a malformed result error', () => {
    expect(() => parseMaintenanceRunnerOutput('api_key=sk-abcdefghijklmnopqrstuvwxyz123456')).toThrow('[REDACTED]');
  });

  it('runs a heavy job in a separate Node process and returns its structured result', async () => {
    const runner = await createRunner([
      'let input = "";',
      'process.stdin.on("data", (chunk) => { input += chunk; });',
      'process.stdin.on("end", () => {',
      '  const request = JSON.parse(input);',
      '  if (request.job.kind !== "codegraph-refresh") process.exit(2);',
      `  process.stdout.write("${MAINTENANCE_RESULT_PREFIX}{\\\"action\\\":\\\"complete\\\"}\\n");`,
      '});',
    ].join('\n'));

    await expect(runMaintenanceInChildProcess({
      job: makeJob(),
      projectRoot: process.cwd(),
      dataDir: process.cwd(),
    }, { runnerPath: runner, timeoutMs: 5_000 })).resolves.toEqual({ action: 'complete' });
  });

  it('refuses vector backfill because it must update the active process index', async () => {
    await expect(runMaintenanceInChildProcess({
      job: makeJob({ kind: 'vector-backfill' }),
      projectRoot: process.cwd(),
      dataDir: process.cwd(),
    }, { runnerPath: 'does-not-matter' })).rejects.toThrow('cannot run in an isolated worker');
  });
});
