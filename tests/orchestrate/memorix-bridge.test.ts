import { beforeEach, describe, expect, it, vi } from 'vitest';

const { storeObservation, searchObservations } = vi.hoisted(() => ({
  storeObservation: vi.fn(),
  searchObservations: vi.fn(),
}));

vi.mock('../../src/memory/observations.js', () => ({ storeObservation }));
vi.mock('../../src/store/orama-store.js', () => ({ searchObservations }));

import {
  hashErrorPattern,
  sanitizeErrorPattern,
  searchKnownFixes,
  searchLessons,
  storeFixExhausted,
  storePipelineSummary,
  storeTaskCompletion,
  storeVerifiedFix,
} from '../../src/orchestrate/memorix-bridge.js';

beforeEach(() => {
  storeObservation.mockReset();
  storeObservation.mockResolvedValue(undefined);
  searchObservations.mockReset();
  searchObservations.mockResolvedValue([]);
});

describe('sanitizeErrorPattern', () => {
  it('should replace Windows absolute paths', () => {
    const input = 'Error in C:\\Users\\dev\\project\\src\\index.ts';
    const result = sanitizeErrorPattern(input);
    expect(result).not.toContain('C:\\Users');
    expect(result).toContain('./');
  });

  it('should replace Unix absolute paths', () => {
    const input = 'Error in /home/user/project/src/index.ts';
    const result = sanitizeErrorPattern(input);
    expect(result).not.toContain('/home/user');
    expect(result).toContain('./');
  });

  it('should strip line:column numbers', () => {
    const input = 'src/file.ts:42:10 - error TS2307';
    const result = sanitizeErrorPattern(input);
    expect(result).toContain(':_:_');
    expect(result).not.toContain(':42:10');
  });

  it('should strip "line N" references', () => {
    const input = 'Error at line 42 in module';
    const result = sanitizeErrorPattern(input);
    expect(result).toContain('line _');
    expect(result).not.toContain('line 42');
  });

  it('should strip deep node_modules paths', () => {
    const input = 'at node_modules/@scope/package/dist/index.js:10:5';
    const result = sanitizeErrorPattern(input);
    expect(result).toContain('node_modules/...');
  });
});

describe('hashErrorPattern', () => {
  it('should generate consistent hash for same error', () => {
    const h1 = hashErrorPattern('Error: Cannot find module foo');
    const h2 = hashErrorPattern('Error: Cannot find module foo');
    expect(h1).toBe(h2);
  });

  it('should generate different hash for different errors', () => {
    const h1 = hashErrorPattern('Error: Cannot find module foo');
    const h2 = hashErrorPattern('Error: Type mismatch in bar');
    expect(h1).not.toBe(h2);
  });

  it('should produce 12-char hex string', () => {
    const h = hashErrorPattern('some error');
    expect(h).toMatch(/^[0-9a-f]{12}$/);
  });

  it('should normalize paths before hashing (same error, different paths)', () => {
    const h1 = hashErrorPattern('Error in C:\\Users\\alice\\project\\src\\file.ts:42:10');
    const h2 = hashErrorPattern('Error in C:\\Users\\bob\\project\\src\\file.ts:99:5');
    expect(h1).toBe(h2);
  });
});

describe('automatic bridge admission', () => {
  it('keeps a verified orchestration fix as a candidate until Code Memory qualifies it', async () => {
    storeVerifiedFix({
      projectId: 'org/repo',
      gate: 'test',
      errorOutput: 'src/auth.ts:42:10 expected 200, received 401',
      fixDescription: 'Updated session validation and reran the focused test.',
      fixAttempt: 1,
      maxAttempts: 3,
      passed: true,
    });

    await vi.waitFor(() => expect(storeObservation).toHaveBeenCalledTimes(1));
    expect(storeObservation).toHaveBeenCalledWith(expect.objectContaining({
      admissionState: 'candidate',
      admissionReason: expect.stringContaining('awaits current Code Memory qualification'),
      visibility: 'personal',
    }));
    const write = storeObservation.mock.calls[0][0];
    expect(write.visibilityReader).toEqual({
      projectId: 'org/repo',
      agentId: write.createdByAgentId,
    });
  });

  it('keeps exhausted fix evidence as a candidate rather than auto-delivering it', async () => {
    storeFixExhausted({
      projectId: 'org/repo',
      gate: 'compile',
      errorOutput: 'src/index.ts:9:3 error TS2304',
      fixDescription: 'Tried the available import paths.',
      fixAttempt: 3,
      maxAttempts: 3,
      passed: false,
    });

    await vi.waitFor(() => expect(storeObservation).toHaveBeenCalledTimes(1));
    expect(storeObservation).toHaveBeenCalledWith(expect.objectContaining({
      admissionState: 'candidate',
      visibility: 'personal',
    }));
    const write = storeObservation.mock.calls[0][0];
    expect(write.visibilityReader).toEqual({
      projectId: 'org/repo',
      agentId: write.createdByAgentId,
    });
  });

  it('keeps task completion as an ephemeral trace and pipeline summary as a candidate', async () => {
    storeTaskCompletion({
      projectId: 'org/repo',
      pipelineId: 'pipeline-1',
      taskId: 'task-1',
      taskDescription: 'Fix session timeout',
      agentName: 'codex',
      durationMs: 1_000,
      tailOutput: 'Focused tests passed.',
    });
    await vi.waitFor(() => expect(storeObservation).toHaveBeenCalledTimes(1));
    expect(storeObservation).toHaveBeenLastCalledWith(expect.objectContaining({
      admissionState: 'ephemeral',
      valueCategory: 'ephemeral',
      visibility: 'personal',
    }));
    let write = storeObservation.mock.calls[0][0];
    expect(write.visibilityReader).toEqual({
      projectId: 'org/repo',
      agentId: write.createdByAgentId,
    });

    storePipelineSummary({
      projectId: 'org/repo',
      pipelineId: 'pipeline-1',
      goal: 'Fix session timeout',
      totalTasks: 2,
      completed: 2,
      failed: 0,
      elapsedMs: 2_000,
    });
    await vi.waitFor(() => expect(storeObservation).toHaveBeenCalledTimes(2));
    expect(storeObservation).toHaveBeenLastCalledWith(expect.objectContaining({
      admissionState: 'candidate',
      visibility: 'personal',
    }));
    write = storeObservation.mock.calls[1][0];
    expect(write.visibilityReader).toEqual({
      projectId: 'org/repo',
      agentId: write.createdByAgentId,
    });
  });

  it('uses an unbound project reader before injecting automatic lessons', async () => {
    searchObservations.mockResolvedValue([
      {
        id: 7,
        title: 'Known fix',
        narrative: 'Use the focused verification command.',
        type: 'problem-solution',
        score: 0.9,
        admissionState: 'qualified',
      },
    ]);

    await expect(searchKnownFixes('test failed', 'org/repo')).resolves.toHaveLength(1);
    expect(searchObservations).toHaveBeenLastCalledWith(expect.objectContaining({
      projectId: 'org/repo',
      reader: { projectId: 'org/repo' },
    }));

    await expect(searchLessons('fix the failing test', 'org/repo')).resolves.toContain('Known fix');
    expect(searchObservations).toHaveBeenLastCalledWith(expect.objectContaining({
      projectId: 'org/repo',
      reader: { projectId: 'org/repo' },
    }));
  });
});
