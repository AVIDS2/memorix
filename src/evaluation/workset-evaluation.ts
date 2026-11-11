import { countTextTokens } from '../compact/token-budget.js';

export const WORKSET_VARIANTS = [
  'memory-only',
  'current-context',
  'candidate-workset',
] as const;

export type WorksetVariant = typeof WORKSET_VARIANTS[number];

/**
 * A normalized result shape for evaluating a task context. The production
 * Workset builder will populate this shape in Phase 5; Phase 0 uses it to
 * establish deterministic baseline fixtures without an LLM dependency.
 */
export interface EvaluatedWorkset {
  variant: WorksetVariant;
  prompt: string;
  startHere: string[];
  evidenceIds: string[];
  cautions: string[];
}

export interface WorksetExpectation {
  requiredStartHere?: string[];
  requiredEvidenceIds?: string[];
  requiredCautions?: string[];
  maxTokens: number;
  maxTokensByVariant?: Partial<Record<WorksetVariant, number>>;
}

export interface WorksetEvaluationFixture {
  id: string;
  title: string;
  task: string;
  expectation: WorksetExpectation;
}

export interface WorksetEvaluationResult {
  fixtureId: string;
  variant: WorksetVariant;
  tokenCount: number;
  tokenBudget: number;
  withinBudget: boolean;
  missingStartHere: string[];
  missingEvidenceIds: string[];
  missingCautions: string[];
  passed: boolean;
}

export interface WorksetComparison {
  fixtureId: string;
  results: WorksetEvaluationResult[];
  byVariant: Partial<Record<WorksetVariant, WorksetEvaluationResult>>;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function missing(required: string[] | undefined, actual: string[]): string[] {
  const available = new Set(actual);
  return unique(required ?? []).filter(value => !available.has(value));
}

function tokenBudgetFor(
  expectation: WorksetExpectation,
  variant: WorksetVariant,
): number {
  return expectation.maxTokensByVariant?.[variant] ?? expectation.maxTokens;
}

/**
 * Evaluate one context against source-backed fixture requirements. This is
 * deliberately mechanical: it reports evidence, safety, and token gaps
 * instead of asking a model to grade another model's answer.
 */
export function evaluateWorkset(
  fixture: WorksetEvaluationFixture,
  workset: EvaluatedWorkset,
): WorksetEvaluationResult {
  const tokenCount = countTextTokens(workset.prompt);
  const missingStartHere = missing(fixture.expectation.requiredStartHere, workset.startHere);
  const missingEvidenceIds = missing(fixture.expectation.requiredEvidenceIds, workset.evidenceIds);
  const missingCautions = missing(fixture.expectation.requiredCautions, workset.cautions);
  const tokenBudget = tokenBudgetFor(fixture.expectation, workset.variant);
  const withinBudget = tokenCount <= tokenBudget;

  return {
    fixtureId: fixture.id,
    variant: workset.variant,
    tokenCount,
    tokenBudget,
    withinBudget,
    missingStartHere,
    missingEvidenceIds,
    missingCautions,
    passed: withinBudget
      && missingStartHere.length === 0
      && missingEvidenceIds.length === 0
      && missingCautions.length === 0,
  };
}

/**
 * Compare memory-only, current-context, and candidate Worksets against the
 * same task requirements. Missing variants are intentionally allowed so a
 * new retrieval implementation can be introduced incrementally.
 */
export function compareWorksets(
  fixture: WorksetEvaluationFixture,
  worksets: EvaluatedWorkset[],
): WorksetComparison {
  const results = worksets.map(workset => evaluateWorkset(fixture, workset));
  const byVariant: Partial<Record<WorksetVariant, WorksetEvaluationResult>> = {};
  for (const result of results) {
    byVariant[result.variant] = result;
  }
  return { fixtureId: fixture.id, results, byVariant };
}
