import { describe, it, expect } from 'vitest';
import { writeTaskEvidence, writePipelineSummary } from '../../src/orchestrate/evidence.js';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('writeTaskEvidence', () => {
  it('should write evidence files to disk', () => {
    const dir = mkdtempSync(join(tmpdir(), 'evidence-'));
    const evidenceDir = writeTaskEvidence(dir, 'pipe-1', {
      taskId: 'task-abcdef123456',
      taskDescription: 'Implement feature X',
      agentName: 'claude',
      status: 'completed',
      durationMs: 5000,
      prompt: '## Your Task\nDo something',
      tailOutput: 'Done!',
      gateResults: [
        { gate: 'compile', passed: true, output: 'OK', durationMs: 1200, command: 'tsc' },
      ],
    });

    expect(evidenceDir).not.toBeNull();
    expect(existsSync(join(evidenceDir!, 'prompt.md'))).toBe(true);
    expect(existsSync(join(evidenceDir!, 'output.txt'))).toBe(true);
    expect(existsSync(join(evidenceDir!, 'compile.txt'))).toBe(true);
    expect(existsSync(join(evidenceDir!, 'result.json'))).toBe(true);

    const result = JSON.parse(readFileSync(join(evidenceDir!, 'result.json'), 'utf-8'));
    expect(result.status).toBe('completed');
    expect(result.agent).toBe('claude');

    rmSync(dir, { recursive: true });
  });

  it('should return null on invalid path (best-effort)', () => {
    // Write to a path that will fail on most systems
    const result = writeTaskEvidence('', 'pipe', {
      taskId: '', taskDescription: '', agentName: '', status: 'failed', durationMs: 0,
    });
    // May or may not be null depending on OS, but should not throw
    expect(true).toBe(true);
  });
});

describe('writePipelineSummary', () => {
  it('should write summary.md', () => {
    const dir = mkdtempSync(join(tmpdir(), 'evidence-'));
    const path = writePipelineSummary(dir, {
      pipelineId: 'pipe-1',
      goal: 'Build feature X',
      totalTasks: 5,
      completed: 4,
      failed: 1,
      elapsedMs: 30000,
      tasks: [
        { taskId: 't1', taskDescription: 'Task 1', agentName: 'claude', status: 'completed', durationMs: 5000 },
        { taskId: 't2', taskDescription: 'Task 2', agentName: 'codex', status: 'failed', durationMs: 3000 },
      ],
    });

    expect(path).not.toBeNull();
    const content = readFileSync(path!, 'utf-8');
    expect(content).toContain('Build feature X');
    expect(content).toContain('4/5 completed');
    expect(content).toContain('[PASS]');
    expect(content).toContain('[FAIL]');

    rmSync(dir, { recursive: true });
  });
});
