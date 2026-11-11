import { describe, expect, it } from 'vitest';
import { CONTEXT_EVALUATION_TASKS } from '../../src/evaluation/context-task-matrix.js';
import {
  formatContextEvaluationReport,
  runContextEvaluation,
} from '../../src/evaluation/context-task-runner.js';

describe('1.10 context evaluation runner', () => {
  it('normalizes complete probe metrics and aggregates timing', async () => {
    const report = await runContextEvaluation(async (task) => ({
      passed: true,
      checks: [`observed ${task.id}`],
      metrics: {
        'first-action-correctness': 1,
        'recovery-success': 1,
        'memory-hit-precision': 1,
        'memory-hit-recall': 1,
        'stale-rejection-rate': 1,
        'conflict-rejection-rate': 1,
        'abstention-precision': 1,
        'fallback-count': 0,
        'degraded-count': 0,
      },
      outputTokens: 24,
      reviewCost: 0,
    }), CONTEXT_EVALUATION_TASKS.slice(0, 2));

    expect(report.summary).toMatchObject({ cases: 2, passed: 2, failed: 0, passRate: 1 });
    expect(report.cases[0].metrics['input-tokens']).toBeGreaterThan(0);
    expect(report.cases[0].metrics['output-tokens']).toBe(24);
    expect(report.cases[0].metrics['latency-p95']).toBeGreaterThanOrEqual(0);
    expect(formatContextEvaluationReport(report)).toContain('2/2 cases passed');
  });

  it('turns a thrown probe into a failed, fully shaped case', async () => {
    const report = await runContextEvaluation(async () => {
      throw new Error('fixture unavailable');
    }, CONTEXT_EVALUATION_TASKS.slice(0, 1));

    expect(report.summary).toMatchObject({ cases: 1, passed: 0, failed: 1, passRate: 0 });
    expect(report.cases[0].error).toBe('fixture unavailable');
    expect(Object.keys(report.cases[0].metrics)).toHaveLength(15);
  });
});
