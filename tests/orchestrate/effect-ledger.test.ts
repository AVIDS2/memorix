import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { acquireDatabase, closeAllDatabases } from '../../src/store/sqlite-db.js';
import { AgentEffectLedger } from '../../src/orchestrate/effect-ledger.js';

const roots: string[] = [];

afterEach(async () => {
  closeAllDatabases();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe('agent effect ledger', () => {
  it('records privacy-safe replay policy and settles observed effects', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'memorix-effect-ledger-'));
    roots.push(root);
    const lease = acquireDatabase(root);
    const ledger = new AgentEffectLedger(lease.db);

    const effect = ledger.observe({
      pipelineId: 'pipe-1',
      taskId: 'task-1',
      attempt: 1,
      effectKey: 'call-1',
      callId: 'call-1',
      tool: 'run_command',
      input: { token: 'super-secret-value', command: 'npm test' },
    });
    expect(effect).toMatchObject({
      status: 'observed',
      riskTier: 'dangerous',
      replayPolicy: 'requires-idempotency-key',
    });
    expect(JSON.stringify(effect)).not.toContain('super-secret-value');

    const settled = ledger.settle({
      pipelineId: 'pipe-1', taskId: 'task-1', attempt: 1,
      effectKey: 'call-1', status: 'succeeded', detail: 'exit=0 token=hidden-value',
    });
    expect(settled).toMatchObject({ status: 'succeeded', detail: 'exit=0 token=[REDACTED]' });

    lease.release();
  });

  it('marks effects without a tool result as unknown after a crashed attempt', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'memorix-effect-ledger-'));
    roots.push(root);
    const lease = acquireDatabase(root);
    const ledger = new AgentEffectLedger(lease.db);
    ledger.observe({ pipelineId: 'pipe-2', taskId: 'task-2', attempt: 1, effectKey: 'call-1', tool: 'edit' });

    expect(ledger.markAttemptUnknown('pipe-2', 'task-2', 1)).toBe(1);
    expect(ledger.list('pipe-2', 'task-2')[0]).toMatchObject({ status: 'unknown' });
    lease.release();
  });
});
