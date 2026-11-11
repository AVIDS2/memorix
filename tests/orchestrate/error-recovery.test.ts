import { describe, it, expect } from 'vitest';
import { classifyError, resetBackoff, getBackoffAttempt } from '../../src/orchestrate/error-recovery.js';

describe('classifyError', () => {
  it('should detect truncated output (no end_turn)', () => {
    const action = classifyError({ exitCode: 1, killed: false, tailOutput: 'partial result', hasEndTurn: false });
    expect(action.category).toBe('truncated');
    expect(action.strategy).toBe('continue');
    expect(action.continuationPrompt).toBeDefined();
  });

  it('should detect truncation from explicit pattern', () => {
    const action = classifyError({ exitCode: 1, killed: false, tailOutput: 'Error: max output limit reached' });
    expect(action.category).toBe('truncated');
    expect(action.strategy).toBe('continue');
  });

  it('should detect context overflow', () => {
    const action = classifyError({ exitCode: 1, killed: false, tailOutput: 'Error: context length exceeded maximum' });
    expect(action.category).toBe('context_overflow');
    expect(action.strategy).toBe('compact_and_retry');
  });

  it('should detect transient errors (rate limit)', () => {
    const action = classifyError({ exitCode: 1, killed: false, tailOutput: '429 Too Many Requests' }, 'task-1');
    expect(action.category).toBe('transient');
    expect(action.strategy).toBe('backoff_and_retry');
    expect(action.delayMs).toBeGreaterThan(0);
    resetBackoff('task-1');
  });

  it('should detect transient errors (server error)', () => {
    const action = classifyError({ exitCode: 1, killed: false, tailOutput: '503 Service Unavailable' }, 'task-2');
    expect(action.category).toBe('transient');
    resetBackoff('task-2');
  });

  it('should return unknown for unrecognized failures', () => {
    const action = classifyError({ exitCode: 1, killed: false, tailOutput: 'some random error' });
    expect(action.category).toBe('unknown');
    expect(action.strategy).toBe('normal_retry');
  });

  it('should return unknown for killed process', () => {
    const action = classifyError({ exitCode: null, killed: true, tailOutput: '' });
    expect(action.category).toBe('unknown');
    expect(action.reason).toContain('killed');
  });

  it('should increase backoff delay on consecutive transient failures', () => {
    const taskId = 'task-backoff';
    resetBackoff(taskId);

    const a1 = classifyError({ exitCode: 1, killed: false, tailOutput: 'rate limit exceeded' }, taskId);
    const a2 = classifyError({ exitCode: 1, killed: false, tailOutput: 'rate limit exceeded' }, taskId);

    expect(a2.delayMs).toBeGreaterThan(0);
    expect(a2.backoffAttempt).toBe(2);
    expect(getBackoffAttempt(taskId)).toBe(2);

    resetBackoff(taskId);
    expect(getBackoffAttempt(taskId)).toBe(0);
  });
});
