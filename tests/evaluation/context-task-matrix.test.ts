import { describe, expect, it } from 'vitest';
import {
  CONTEXT_EVALUATION_METRICS,
  CONTEXT_EVALUATION_TASKS,
  validateContextEvaluationMatrix,
} from '../../src/evaluation/context-task-matrix.js';

describe('1.10 context evaluation matrix', () => {
  it('defines twenty task-shaped cases across retrieval, safety, runtime, and integration boundaries', () => {
    expect(CONTEXT_EVALUATION_TASKS).toHaveLength(20);
    expect(validateContextEvaluationMatrix()).toEqual([]);

    const categories = new Set(CONTEXT_EVALUATION_TASKS.map(task => task.category));
    expect(categories).toEqual(new Set([
      'continuity',
      'retrieval',
      'safety',
      'runtime',
      'integration',
    ]));
  });

  it('requires every case to record the full 1.10 metric contract', () => {
    for (const task of CONTEXT_EVALUATION_TASKS) {
      expect(task.metrics).toEqual(CONTEXT_EVALUATION_METRICS);
      expect(task.acceptance.length).toBeGreaterThan(0);
      expect(task.surfaces.length).toBeGreaterThan(0);
    }
  });

  it('fails validation for duplicate or incomplete task matrices', () => {
    const duplicate = [CONTEXT_EVALUATION_TASKS[0], CONTEXT_EVALUATION_TASKS[0]];
    expect(validateContextEvaluationMatrix(duplicate)).toEqual([
      'duplicate task id: first-project-setup',
      'expected 20 task cases, found 2',
    ]);
  });
});
