/**
 * Coordinator integration tests — Phase 4c.
 *
 * Uses a MockAdapter that simulates agent behavior by directly
 * manipulating TeamStore (completing/failing tasks), then exiting.
 * This tests the full coordination loop without real CLI processes.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TeamStore } from '../../src/team/team-store.js';
import { closeDatabase } from '../../src/store/sqlite-db.js';
import { runCoordinationLoop, type CoordinatorEvent } from '../../src/orchestrate/coordinator.js';
import type { AgentAdapter, AgentProcess, SpawnOptions, AgentProcessResult } from '../../src/orchestrate/adapters/types.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'memorix-coord-test-'));
}

function cleanup(dir: string): void {
  closeDatabase(dir);
  fs.rmSync(dir, { recursive: true, force: true });
}

/**
 * Mock adapter — 方案 A: agent does NOT touch TeamStore.
 * Returns exit code only. Orchestrator owns task lifecycle.
 */
function createMockAdapter(opts: {
  name?: string;
  /** 'complete' → exit 0, 'fail' → exit 1, 'timeout' → never resolve */
  behavior?: 'complete' | 'fail' | 'timeout';
  delayMs?: number;
}): AgentAdapter {
  const { name = 'mock', behavior = 'complete', delayMs = 10 } = opts;

  return {
    name,
    async available() { return true; },
    spawn(_prompt: string, _spawnOpts: SpawnOptions): AgentProcess {
      let aborted = false;

      const completion = new Promise<AgentProcessResult>(async (resolve) => {
        await new Promise(r => setTimeout(r, delayMs));

        if (aborted) {
          resolve({ exitCode: null, signal: 'SIGTERM', tailOutput: 'aborted', killed: true });
          return;
        }

        if (behavior === 'timeout') {
          // Never resolve — let timeout kill us
          return;
        }

        // Agent just exits — orchestrator determines task outcome from exit code
        resolve({
          exitCode: behavior === 'fail' ? 1 : 0,
          signal: null,
          tailOutput: `${name} output`,
          killed: false,
        });
      });

      return {
        pid: 99999,
        completion,
        abort() { aborted = true; },
      };
    },
  };
}

describe('Coordinator', () => {
  let store: TeamStore;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = makeTmpDir();
    store = new TeamStore();
    await store.init(tmpDir);
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  it('should complete a single task with mock adapter', async () => {
    // Create a task
    store.createTask({ projectId: 'proj1', description: 'Task A' });

    const events: CoordinatorEvent[] = [];
    const result = await runCoordinationLoop({
      projectDir: tmpDir,
      projectId: 'proj1',
      adapters: [createMockAdapter({})],
      teamStore: store,
      maxRetries: 0,
      pollIntervalMs: 50,
      taskTimeoutMs: 5_000,
      onProgress: (e) => events.push(e),
    });

    expect(result.completed).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.aborted).toBe(false);
    expect(events.some(e => e.type === 'task:completed')).toBe(true);
    expect(events.some(e => e.type === 'finished')).toBe(true);
  });

  it('should complete a 3-task dependency chain in order', async () => {
    const t1 = store.createTask({ projectId: 'proj1', description: 'Base layer' });
    const t2 = store.createTask({ projectId: 'proj1', description: 'Middle layer', deps: [t1.task_id] });
    const t3 = store.createTask({ projectId: 'proj1', description: 'Top layer', deps: [t2.task_id] });

    const completionOrder: string[] = [];
    const result = await runCoordinationLoop({
      projectDir: tmpDir,
      projectId: 'proj1',
      adapters: [createMockAdapter({})],
      teamStore: store,
      pollIntervalMs: 50,
      taskTimeoutMs: 5_000,
      onProgress: (e) => {
        if (e.type === 'task:completed' && e.taskId) completionOrder.push(e.taskId);
      },
    });

    expect(result.completed).toBe(3);
    expect(result.failed).toBe(0);
    // Verify dependency order
    expect(completionOrder[0]).toBe(t1.task_id);
    expect(completionOrder[1]).toBe(t2.task_id);
    expect(completionOrder[2]).toBe(t3.task_id);
  });

  it('should retry failed task (exit 1 then exit 0)', async () => {
    store.createTask({ projectId: 'proj1', description: 'Flaky task' });

    let callCount = 0;
    const flakyAdapter: AgentAdapter = {
      name: 'flaky',
      async available() { return true; },
      spawn(_prompt: string, _opts: SpawnOptions): AgentProcess {
        callCount++;
        const attempt = callCount;
        const completion = new Promise<AgentProcessResult>(async (resolve) => {
          await new Promise(r => setTimeout(r, 10));
          // First attempt fails (exit 1), second succeeds (exit 0)
          resolve({
            exitCode: attempt === 1 ? 1 : 0,
            signal: null,
            tailOutput: `attempt ${attempt}`,
            killed: false,
          });
        });
        return { pid: 99999, completion, abort() {} };
      },
    };

    const result = await runCoordinationLoop({
      projectDir: tmpDir,
      projectId: 'proj1',
      adapters: [flakyAdapter],
      teamStore: store,
      maxRetries: 2,
      pollIntervalMs: 50,
      taskTimeoutMs: 5_000,
    });

    expect(result.completed).toBe(1);
    expect(result.retries).toBe(1);
  });

  it('should run parallel agents on independent tasks', async () => {
    store.createTask({ projectId: 'proj1', description: 'Task A' });
    store.createTask({ projectId: 'proj1', description: 'Task B' });

    const dispatched: string[] = [];
    const result = await runCoordinationLoop({
      projectDir: tmpDir,
      projectId: 'proj1',
      adapters: [createMockAdapter({ name: 'agent1' })],
      teamStore: store,
      parallel: 2,
      pollIntervalMs: 50,
      taskTimeoutMs: 5_000,
      onProgress: (e) => {
        if (e.type === 'task:dispatched') dispatched.push(e.message);
      },
    });

    expect(result.completed).toBe(2);
    expect(result.failed).toBe(0);
  });

  it('should show plan in dry-run mode without spawning', async () => {
    store.createTask({ projectId: 'proj1', description: 'Task DryRun' });

    const events: CoordinatorEvent[] = [];
    const result = await runCoordinationLoop({
      projectDir: tmpDir,
      projectId: 'proj1',
      adapters: [createMockAdapter({})],
      teamStore: store,
      dryRun: true,
      onProgress: (e) => events.push(e),
    });

    // Should finish immediately without dispatching
    expect(events.some(e => e.type === 'finished' && e.message.includes('dry-run'))).toBe(true);
    expect(events.some(e => e.type === 'task:dispatched')).toBe(false);
    expect(result.aborted).toBe(false);
  });

  it('should detect stale agents and release their tasks', async () => {
    // Register a fake agent and claim a task
    const fakeAgent = store.registerAgent({
      projectId: 'proj1', agentType: 'stale-test', instanceId: 'stale-1',
    });
    const task = store.createTask({ projectId: 'proj1', description: 'Stale task' });
    store.claimTask(task.task_id, fakeAgent.agent_id);

    // Manually set heartbeat to the past to simulate staleness
    store.getDb().prepare(
      'UPDATE team_agents SET last_heartbeat = ? WHERE agent_id = ?',
    ).run(Date.now() - 999_999, fakeAgent.agent_id);

    const events: CoordinatorEvent[] = [];
    const result = await runCoordinationLoop({
      projectDir: tmpDir,
      projectId: 'proj1',
      adapters: [createMockAdapter({})],
      teamStore: store,
      staleTtlMs: 1_000, // 1 second — our fake is 999s old
      pollIntervalMs: 50,
      taskTimeoutMs: 5_000,
      onProgress: (e) => events.push(e),
    });

    expect(events.some(e => e.type === 'agent:stale')).toBe(true);
    expect(result.completed).toBe(1); // rescued and completed
  });

  it('should fail task when agent exits non-zero (方案 A)', async () => {
    store.createTask({ projectId: 'proj1', description: 'Failing task' });

    const result = await runCoordinationLoop({
      projectDir: tmpDir,
      projectId: 'proj1',
      adapters: [createMockAdapter({ behavior: 'fail' })],
      teamStore: store,
      maxRetries: 0,
      pollIntervalMs: 50,
      taskTimeoutMs: 5_000,
    });

    expect(result.failed).toBe(1);
    expect(result.completed).toBe(0);
  });

  it('should exit with all tasks done when no tasks exist initially', async () => {
    // No tasks created
    const result = await runCoordinationLoop({
      projectDir: tmpDir,
      projectId: 'proj1',
      adapters: [createMockAdapter({})],
      teamStore: store,
      pollIntervalMs: 50,
    });

    expect(result.totalTasks).toBe(0);
    expect(result.completed).toBe(0);
    expect(result.aborted).toBe(false);
  });

  it('should use round-robin adapter selection', async () => {
    store.createTask({ projectId: 'proj1', description: 'Task 1' });
    store.createTask({ projectId: 'proj1', description: 'Task 2' });

    const adapterCalls: string[] = [];
    const makeTracked = (adapterName: string): AgentAdapter => ({
      name: adapterName,
      async available() { return true; },
      spawn(_prompt: string, _opts: SpawnOptions): AgentProcess {
        adapterCalls.push(adapterName);
        // Agent just exits 0 — orchestrator handles completion
        const completion = new Promise<AgentProcessResult>(async (resolve) => {
          await new Promise(r => setTimeout(r, 10));
          resolve({ exitCode: 0, signal: null, tailOutput: '', killed: false });
        });
        return { pid: 99999, completion, abort() {} };
      },
    });

    await runCoordinationLoop({
      projectDir: tmpDir,
      projectId: 'proj1',
      adapters: [makeTracked('alpha'), makeTracked('beta')],
      teamStore: store,
      parallel: 1, // sequential to test round-robin
      pollIntervalMs: 50,
      taskTimeoutMs: 5_000,
    });

    expect(adapterCalls).toEqual(['alpha', 'beta']);
  });

  // ═══════════════════════════════════════════════════════════════
  // Blocker 1: Orchestrator self-heartbeat
  // ═══════════════════════════════════════════════════════════════

  it('should NOT self-stale when task runs longer than staleTtlMs', async () => {
    store.createTask({ projectId: 'proj1', description: 'Long running task' });

    // staleTtlMs = 50ms, but task takes 200ms to complete
    // Without heartbeat fix, orchestrator would stale itself
    const events: CoordinatorEvent[] = [];
    const result = await runCoordinationLoop({
      projectDir: tmpDir,
      projectId: 'proj1',
      adapters: [createMockAdapter({ delayMs: 200 })],
      teamStore: store,
      staleTtlMs: 50,
      pollIntervalMs: 30,
      taskTimeoutMs: 5_000,
      maxRetries: 0,
      onProgress: (e) => events.push(e),
    });

    // Task should complete, not be released by self-stale
    expect(result.completed).toBe(1);
    expect(result.failed).toBe(0);
    // No stale event should fire for the orchestrator itself
    // (stale events are only for external agents)
    const staleEvents = events.filter(e => e.type === 'agent:stale');
    expect(staleEvents.length).toBe(0);
  });

  // ═══════════════════════════════════════════════════════════════
  // Blocker 2: Orchestrator owns task lifecycle (方案 A)
  // ═══════════════════════════════════════════════════════════════

  it('should complete task when agent exits 0 (方案 A: orchestrator writes state)', async () => {
    const task = store.createTask({ projectId: 'proj1', description: 'Orchestrator-owned task' });

    await runCoordinationLoop({
      projectDir: tmpDir,
      projectId: 'proj1',
      adapters: [createMockAdapter({})], // exits 0
      teamStore: store,
      maxRetries: 0,
      pollIntervalMs: 50,
      taskTimeoutMs: 5_000,
    });

    // Verify orchestrator wrote the completion (not the agent)
    const finalTask = store.getTask(task.task_id);
    expect(finalTask?.status).toBe('completed');
    expect(finalTask?.result).toBeTruthy();
  });

  it('should fail task when agent exits non-zero (方案 A: orchestrator writes state)', async () => {
    const task = store.createTask({ projectId: 'proj1', description: 'Will fail task' });

    await runCoordinationLoop({
      projectDir: tmpDir,
      projectId: 'proj1',
      adapters: [createMockAdapter({ behavior: 'fail' })], // exits 1
      teamStore: store,
      maxRetries: 0,
      pollIntervalMs: 50,
      taskTimeoutMs: 5_000,
    });

    const finalTask = store.getTask(task.task_id);
    expect(finalTask?.status).toBe('failed');
    expect(finalTask?.result).toContain('Exit code 1');
  });

  // ═══════════════════════════════════════════════════════════════
  // Fix 2: Coordinator config validation (PR #76 round 3)
  // ═══════════════════════════════════════════════════════════════

  it('should throw on empty adapters array', async () => {
    store.createTask({ projectId: 'proj1', description: 'Task' });
    await expect(runCoordinationLoop({
      projectDir: tmpDir,
      projectId: 'proj1',
      adapters: [],
      teamStore: store,
    })).rejects.toThrow('adapters must be a non-empty array');
  });

  it('should throw on invalid numeric config values', async () => {
    store.createTask({ projectId: 'proj1', description: 'Task' });
    const base = {
      projectDir: tmpDir,
      projectId: 'proj1',
      adapters: [createMockAdapter({})],
      teamStore: store,
    };

    await expect(runCoordinationLoop({ ...base, parallel: 0 }))
      .rejects.toThrow('parallel must be >= 1');
    await expect(runCoordinationLoop({ ...base, parallel: NaN }))
      .rejects.toThrow('parallel must be >= 1');
    await expect(runCoordinationLoop({ ...base, taskTimeoutMs: -1 }))
      .rejects.toThrow('taskTimeoutMs must be > 0');
    await expect(runCoordinationLoop({ ...base, taskTimeoutMs: 0 }))
      .rejects.toThrow('taskTimeoutMs must be > 0');
    await expect(runCoordinationLoop({ ...base, maxRetries: -1 }))
      .rejects.toThrow('maxRetries must be >= 0');
    await expect(runCoordinationLoop({ ...base, pollIntervalMs: -5 }))
      .rejects.toThrow('pollIntervalMs must be >= 0');
  });

  // ═══════════════════════════════════════════════════════════════
  // Fix 4a: retry reset clears stale result (PR #76 round 3)
  // ═══════════════════════════════════════════════════════════════

  it('should clear stale result on retry reset', async () => {
    let callCount = 0;
    // First call fails, second call succeeds
    const flakyAdapter: AgentAdapter = {
      name: 'flaky',
      async available() { return true; },
      spawn(_prompt: string, _opts: SpawnOptions): AgentProcess {
        callCount++;
        const exitCode = callCount === 1 ? 1 : 0;
        const completion = new Promise<AgentProcessResult>(r =>
          setTimeout(() => r({ exitCode, signal: null, tailOutput: `attempt ${callCount}`, killed: false }), 10),
        );
        return { pid: 99999, completion, abort() {} };
      },
    };

    const task = store.createTask({ projectId: 'proj1', description: 'Flaky task' });

    await runCoordinationLoop({
      projectDir: tmpDir,
      projectId: 'proj1',
      adapters: [flakyAdapter],
      teamStore: store,
      maxRetries: 1,
      pollIntervalMs: 50,
      taskTimeoutMs: 5_000,
    });

    // After retry+success, result should reflect the second attempt, not the first failure
    const finalTask = store.getTask(task.task_id);
    expect(finalTask?.status).toBe('completed');
    // The result should NOT contain the first failure's error message
    expect(finalTask?.result).not.toContain('Exit code 1');
  });

  // ═══════════════════════════════════════════════════════════════
  // Fix 4b: resolveHandoffs failure fallback (PR #76 round 3)
  // ═══════════════════════════════════════════════════════════════

  it('should not crash when resolveHandoffs throws', async () => {
    store.createTask({ projectId: 'proj1', description: 'Task A' });

    const result = await runCoordinationLoop({
      projectDir: tmpDir,
      projectId: 'proj1',
      adapters: [createMockAdapter({})],
      teamStore: store,
      maxRetries: 0,
      pollIntervalMs: 50,
      taskTimeoutMs: 5_000,
      resolveHandoffs: async () => { throw new Error('handoff DB exploded'); },
    });

    // Should still complete successfully — handoff is enhancement, not critical
    expect(result.completed).toBe(1);
    expect(result.failed).toBe(0);
  });

  // ═══════════════════════════════════════════════════════════════
  // Blocker 3: Stranded pending tasks with failed deps
  // ═══════════════════════════════════════════════════════════════

  it('should fail stranded task B when dep task A fails (not report as success)', async () => {
    // A → B dependency chain. A fails → B should be marked failed too.
    const tA = store.createTask({ projectId: 'proj1', description: 'Task A (will fail)' });
    const tB = store.createTask({ projectId: 'proj1', description: 'Task B (depends on A)', deps: [tA.task_id] });

    const events: CoordinatorEvent[] = [];
    const result = await runCoordinationLoop({
      projectDir: tmpDir,
      projectId: 'proj1',
      adapters: [createMockAdapter({ behavior: 'fail' })], // A exits 1
      teamStore: store,
      maxRetries: 0,
      pollIntervalMs: 50,
      taskTimeoutMs: 5_000,
      onProgress: (e) => events.push(e),
    });

    // Both tasks must be failed
    expect(result.completed).toBe(0);
    expect(result.failed).toBe(2);

    // Verify task B was marked failed with dependency reason
    const finalB = store.getTask(tB.task_id);
    expect(finalB?.status).toBe('failed');
    expect(finalB?.result).toContain('upstream dependency failed');

    // Verify the event was emitted for the stranded task
    expect(events.some(e => e.type === 'task:failed' && e.message.includes('blocked by failed dependency'))).toBe(true);
  });
});
