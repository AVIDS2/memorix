import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  compareWorksets,
  type EvaluatedWorkset,
  type WorksetVariant,
} from '../../src/evaluation/workset-evaluation.js';
import {
  WORKSET_EVALUATION_FIXTURES,
  type WorksetEvaluationFixtureCase,
} from './workset-fixtures.js';

const fixtureRoot = path.resolve(process.cwd(), 'tests/fixtures/workset-evaluation');

function completeWorkset(
  fixture: WorksetEvaluationFixtureCase,
  variant: WorksetVariant,
): EvaluatedWorkset {
  const startHere = fixture.expectation.requiredStartHere ?? [];
  const evidenceIds = fixture.expectation.requiredEvidenceIds ?? [];
  const cautions = fixture.expectation.requiredCautions ?? [];
  const prompt = [
    'Task: ' + fixture.task,
    'Start here: ' + (startHere.join(', ') || 'none'),
    'Evidence: ' + (evidenceIds.join(', ') || 'none'),
    'Cautions: ' + (cautions.join(', ') || 'none'),
    'Verify the current source before making a change.',
  ].join('\n');

  return { variant, prompt, startHere, evidenceIds, cautions };
}

describe('1.2 Workset evaluation harness', () => {
  it('covers the promised repository and state boundary fixtures', () => {
    expect(WORKSET_EVALUATION_FIXTURES.map(fixture => fixture.id)).toEqual([
      'typescript-auth',
      'python-worker',
      'go-service',
      'docs-only',
      'dirty-worktree',
      'deleted-symbol',
      'incomplete-scan',
    ]);

    for (const fixture of WORKSET_EVALUATION_FIXTURES) {
      for (const file of fixture.requiredFiles) {
        const absolute = path.join(fixtureRoot, fixture.repositoryPath, file);
        expect(existsSync(absolute), fixture.id + ' is missing ' + file).toBe(true);
        expect(readFileSync(absolute, 'utf8').trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('seeds observations, Git, tests, skills, and explicit relations across the corpus', () => {
    const kinds = new Set(
      WORKSET_EVALUATION_FIXTURES.flatMap(fixture => fixture.evidence.map(evidence => evidence.kind)),
    );

    expect(kinds).toEqual(new Set([
      'observation',
      'git',
      'test',
      'mini-skill',
      'graph-relation',
    ]));
  });

  it('shows the source and safety gaps of a memory-only answer', () => {
    const fixture = WORKSET_EVALUATION_FIXTURES.find(item => item.id === 'deleted-symbol')!;
    const memoryOnly: EvaluatedWorkset = {
      variant: 'memory-only',
      prompt: 'Task: ' + fixture.task + '\nMemory: legacy router used to exist.',
      startHere: [],
      evidenceIds: ['obs:legacy-router'],
      cautions: [],
    };

    const result = compareWorksets(fixture, [memoryOnly]).byVariant['memory-only']!;
    expect(result.passed).toBe(false);
    expect(result.missingStartHere).toEqual(['src/router.ts']);
    expect(result.missingCautions).toEqual(['deleted-symbol']);
    expect(result.withinBudget).toBe(true);
  });

  it('compares memory-only, current context, and candidate Worksets deterministically', () => {
    const fixture = WORKSET_EVALUATION_FIXTURES.find(item => item.id === 'dirty-worktree')!;
    const memoryOnly: EvaluatedWorkset = {
      variant: 'memory-only',
      prompt: 'Task: ' + fixture.task + '\nMemory: configuration migration is in progress.',
      startHere: [],
      evidenceIds: ['obs:config-migration'],
      cautions: [],
    };
    const currentContext = completeWorkset(fixture, 'current-context');
    const candidateWorkset = completeWorkset(fixture, 'candidate-workset');

    const comparison = compareWorksets(fixture, [memoryOnly, currentContext, candidateWorkset]);

    expect(comparison.results).toHaveLength(3);
    expect(comparison.byVariant['memory-only']?.passed).toBe(false);
    expect(comparison.byVariant['current-context']?.passed).toBe(true);
    expect(comparison.byVariant['candidate-workset']?.passed).toBe(true);
    expect(comparison.byVariant['candidate-workset']?.tokenCount).toBeLessThanOrEqual(180);
    expect(comparison.byVariant['current-context']?.tokenBudget).toBe(320);
    expect(comparison.byVariant['candidate-workset']?.tokenBudget).toBe(180);
  });

  it('fails an otherwise complete Workset that exceeds its token budget', () => {
    const fixture = WORKSET_EVALUATION_FIXTURES.find(item => item.id === 'typescript-auth')!;
    const oversized = completeWorkset(fixture, 'candidate-workset');
    oversized.prompt = oversized.prompt + ' source'.repeat(500);

    const result = compareWorksets(fixture, [oversized]).byVariant['candidate-workset']!;
    expect(result.passed).toBe(false);
    expect(result.withinBudget).toBe(false);
  });

  it('requires state cautions instead of hiding dirty, deleted, or incomplete evidence', () => {
    for (const id of ['dirty-worktree', 'deleted-symbol', 'incomplete-scan']) {
      const fixture = WORKSET_EVALUATION_FIXTURES.find(item => item.id === id)!;
      const result = compareWorksets(fixture, [
        completeWorkset(fixture, 'candidate-workset'),
      ]).byVariant['candidate-workset']!;

      expect(result.passed, id).toBe(true);
      expect(result.missingCautions, id).toEqual([]);
    }
  });
});
