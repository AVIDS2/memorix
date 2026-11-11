import { describe, it, expect } from 'vitest';
import {
  runFormation,
  getFormationMetrics,
  clearFormationMetrics,
  getMetricsSummary,
} from '../../../src/memory/formation/index.js';
import type { FormationInput, FormationConfig, SearchHit, ExistingMemoryRef } from '../../../src/memory/formation/types.js';

function makeInput(overrides: Partial<FormationInput> = {}): FormationInput {
  return {
    entityName: 'auth-module',
    type: 'decision',
    title: 'Chose PostgreSQL over MySQL',
    narrative: 'We decided to use PostgreSQL because of better JSON support and JSONB indexing. MySQL was considered but rejected due to lack of native JSON column indexing.',
    facts: ['Database: PostgreSQL', 'Rejected: MySQL'],
    projectId: 'test-project',
    source: 'explicit',
    ...overrides,
  };
}

function makeConfig(overrides: Partial<FormationConfig> = {}): FormationConfig {
  return {
    mode: 'shadow',
    useLLM: false,
    minValueScore: 0.3,
    searchMemories: async () => [],
    getObservation: () => null,
    getEntityNames: () => [],
    ...overrides,
  };
}

describe('Formation Pipeline', () => {
  it('should produce a complete FormedMemory with all stages', async () => {
    const result = await runFormation(makeInput(), makeConfig());

    expect(result.extraction).toBeDefined();
    expect(result.resolution).toBeDefined();
    expect(result.evaluation).toBeDefined();
    expect(result.pipeline.stagesCompleted).toBe(3);
    expect(result.pipeline.mode).toBe('rules');
    expect(result.pipeline.shadow).toBe(true);
  });

  it('should enrich facts from narrative', async () => {
    const result = await runFormation(
      makeInput({
        narrative: 'Server runs on Port: 5432 with Timeout: 30s. Using react@18.2.0.',
        facts: [],
      }),
      makeConfig(),
    );
    expect(result.facts.length).toBeGreaterThan(0);
    expect(result.extraction.extractedFacts.length).toBeGreaterThan(0);
  });

  it('should resolve entity against existing KG entities', async () => {
    const result = await runFormation(
      makeInput({ entityName: 'auth' }),
      makeConfig({ getEntityNames: () => ['auth-module', 'database', 'server'] }),
    );
    expect(result.entityName).toBe('auth-module');
    expect(result.extraction.entityResolved).toBe(true);
  });

  it('should bypass resolve stage for topicKey inputs', async () => {
    const result = await runFormation(
      makeInput({ topicKey: 'architecture/database' }),
      makeConfig(),
    );
    expect(result.resolution.action).toBe('new');
    expect(result.resolution.reason).toContain('TopicKey');
  });

  it('should emit stage events and record per-stage durations', async () => {
    const events: string[] = [];
    const result = await runFormation(
      makeInput(),
      makeConfig({
        onStageEvent: (event) => {
          events.push(`${event.stage}:${event.status}`);
        },
      }),
    );

    expect(events).toEqual([
      'extract:start',
      'extract:success',
      'resolve:start',
      'resolve:success',
      'evaluate:start',
      'evaluate:success',
    ]);
    expect(result.pipeline.stageDurationsMs.extract).toBeGreaterThanOrEqual(0);
    expect(result.pipeline.stageDurationsMs.resolve).toBeGreaterThanOrEqual(0);
    expect(result.pipeline.stageDurationsMs.evaluate).toBeGreaterThanOrEqual(0);
  });

  it('should emit a skipped resolve event for topicKey inputs', async () => {
    const events: string[] = [];
    const result = await runFormation(
      makeInput({ topicKey: 'architecture/database' }),
      makeConfig({
        onStageEvent: (event) => {
          events.push(`${event.stage}:${event.status}`);
        },
      }),
    );

    expect(events).toContain('resolve:skipped');
    expect(result.pipeline.stageDurationsMs.resolve).toBe(0);
  });

  it('should ignore errors thrown by stage observers', async () => {
    const result = await runFormation(
      makeInput(),
      makeConfig({
        onStageEvent: () => {
          throw new Error('observer failed');
        },
      }),
    );

    expect(result.pipeline.stagesCompleted).toBe(3);
    expect(result.pipeline.stageDurationsMs.extract).toBeGreaterThanOrEqual(0);
  });

  it('should return "discard" resolution for near-duplicates', async () => {
    const result = await runFormation(
      makeInput({ narrative: 'Short note.' }),
      makeConfig({
        searchMemories: async () => [{
          id: 1,
          observationId: 100,
          title: 'Chose PostgreSQL over MySQL',
          narrative: 'Detailed analysis of PostgreSQL vs MySQL covering JSON support, indexing, and performance benchmarks.',
          facts: 'Database: PostgreSQL\nRejected: MySQL',
          entityName: 'auth-module',
          type: 'decision',
          score: 0.95,
        }],
        getObservation: () => ({
          id: 100,
          entityName: 'auth-module',
          type: 'decision',
          title: 'Chose PostgreSQL',
          narrative: 'Detailed analysis of PostgreSQL vs MySQL covering JSON support, indexing, and performance benchmarks.',
          facts: ['Database: PostgreSQL', 'Rejected: MySQL'],
        }),
      }),
    );
    expect(result.resolution.action).toBe('discard');
  });

  it('should evaluate high-value content as core', async () => {
    const result = await runFormation(
      makeInput({
        type: 'gotcha',
        title: 'Docker OOM crash on large files',
        narrative: 'Critical: the Docker container crashes because of OOM when processing files > 2GB. Fixed by setting --memory=4g flag.',
        facts: ['Memory limit: 4GB', 'Threshold: 2GB files'],
      }),
      makeConfig(),
    );
    expect(result.evaluation.category).toBe('core');
    expect(result.evaluation.score).toBeGreaterThanOrEqual(0.55);
  });

  it('should evaluate low-value content as ephemeral', async () => {
    const result = await runFormation(
      makeInput({
        type: 'what-changed',
        title: 'Updated readme.md',
        narrative: 'Minor typo fix.',
        facts: [],
      }),
      makeConfig(),
    );
    expect(result.evaluation.category).toBe('ephemeral');
  });

  describe('Metrics collection', () => {
    it('should collect metrics after pipeline run', async () => {
      clearFormationMetrics();
      await runFormation(makeInput(), makeConfig());
      const metrics = getFormationMetrics();
      expect(metrics.length).toBe(1);
      expect(metrics[0].mode).toBe('rules');
      expect(metrics[0].durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should provide aggregated summary', async () => {
      clearFormationMetrics();
      await runFormation(makeInput(), makeConfig());
      await runFormation(
        makeInput({ type: 'gotcha', title: 'Critical bug', narrative: 'Server crashes due to memory leak caused by unclosed connections.' }),
        makeConfig(),
      );
      const summary = getMetricsSummary();
      expect(summary.total).toBe(2);
      expect(summary.avgValueScore).toBeGreaterThan(0);
      expect(summary.avgDurationMs).toBeGreaterThanOrEqual(0);
    });

    it('should cap metrics buffer at 500', async () => {
      clearFormationMetrics();
      for (let i = 0; i < 510; i++) {
        await runFormation(makeInput({ title: `Obs ${i}` }), makeConfig());
      }
      expect(getFormationMetrics().length).toBe(500);
    });
  });

  describe('Pipeline duration tracking', () => {
    it('should track non-negative duration', async () => {
      const result = await runFormation(makeInput(), makeConfig());
      expect(result.pipeline.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Shadow mode', () => {
    it('should mark output as shadow mode', async () => {
      const result = await runFormation(makeInput(), makeConfig({ mode: 'shadow' }));
      expect(result.pipeline.shadow).toBe(true);
    });

    it('should mark output as active mode', async () => {
      const result = await runFormation(makeInput(), makeConfig({ mode: 'active' }));
      expect(result.pipeline.shadow).toBe(false);
    });
  });
});
