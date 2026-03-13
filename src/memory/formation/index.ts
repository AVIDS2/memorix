/**
 * Memory Formation Pipeline — Orchestrator
 *
 * Runs the three-stage pipeline: Extract → Resolve → Evaluate.
 *
 * Supports two execution modes:
 * - **Active mode**: Pipeline output drives storage decisions (replaces compact-on-write)
 * - **Shadow mode**: Pipeline runs in parallel with existing compact-on-write,
 *   producing metrics for comparison without affecting storage
 *
 * Design: Pipeline is a pure function with injected dependencies (search, getObservation).
 * It does not import server.ts or storeObservation directly.
 */

import type {
  FormationInput,
  FormedMemory,
  FormationConfig,
  FormationMetrics,
} from './types.js';
import { runExtract } from './extract.js';
import { runResolve } from './resolve.js';
import { runEvaluate } from './evaluate.js';

// ── Shadow Mode Metrics Collection ──────────────────────────────

/** In-memory metrics buffer for shadow mode analysis */
const metricsBuffer: FormationMetrics[] = [];
const MAX_METRICS_BUFFER = 500;

/**
 * Get collected shadow mode metrics (for analysis/dashboard).
 */
export function getFormationMetrics(): readonly FormationMetrics[] {
  return metricsBuffer;
}

/**
 * Clear metrics buffer.
 */
export function clearFormationMetrics(): void {
  metricsBuffer.length = 0;
}

/**
 * Get aggregated metrics summary.
 */
export function getMetricsSummary(): {
  total: number;
  avgValueScore: number;
  avgExtractedFacts: number;
  titleImprovedRate: number;
  entityResolvedRate: number;
  typeCorectedRate: number;
  resolutionBreakdown: Record<string, number>;
  categoryBreakdown: Record<string, number>;
  avgDurationMs: number;
} {
  const total = metricsBuffer.length;
  if (total === 0) {
    return {
      total: 0,
      avgValueScore: 0,
      avgExtractedFacts: 0,
      titleImprovedRate: 0,
      entityResolvedRate: 0,
      typeCorectedRate: 0,
      resolutionBreakdown: {},
      categoryBreakdown: {},
      avgDurationMs: 0,
    };
  }

  const sum = (fn: (m: FormationMetrics) => number) =>
    metricsBuffer.reduce((s, m) => s + fn(m), 0);

  const resolutionBreakdown: Record<string, number> = {};
  const categoryBreakdown: Record<string, number> = {};
  for (const m of metricsBuffer) {
    resolutionBreakdown[m.resolutionAction] = (resolutionBreakdown[m.resolutionAction] ?? 0) + 1;
    categoryBreakdown[m.valueCategory] = (categoryBreakdown[m.valueCategory] ?? 0) + 1;
  }

  return {
    total,
    avgValueScore: sum(m => m.valueScore) / total,
    avgExtractedFacts: sum(m => m.systemExtractedFacts) / total,
    titleImprovedRate: sum(m => m.titleImproved ? 1 : 0) / total,
    entityResolvedRate: sum(m => m.entityResolved ? 1 : 0) / total,
    typeCorectedRate: sum(m => m.typeCorrected ? 1 : 0) / total,
    resolutionBreakdown,
    categoryBreakdown,
    avgDurationMs: sum(m => m.durationMs) / total,
  };
}

// ── Pipeline Orchestrator ────────────────────────────────────────

/**
 * Run the Memory Formation Pipeline.
 *
 * Three stages:
 * 1. Extract: Enrich with system-extracted facts, normalize title/entity/type
 * 2. Resolve: Compare against existing memories, decide new/merge/evolve/discard
 * 3. Evaluate: Assess knowledge value (core/contextual/ephemeral)
 *
 * In shadow mode, metrics are collected but no storage decisions are enforced.
 */
export async function runFormation(
  input: FormationInput,
  config: FormationConfig,
): Promise<FormedMemory> {
  const startTime = Date.now();
  let stagesCompleted = 0;

  // ── Stage 1: Extract ──
  const existingEntities = config.getEntityNames();
  const extraction = runExtract(input, existingEntities);
  stagesCompleted = 1;

  // ── Stage 2: Resolve ──
  // Skip resolve for topicKey upserts (they have their own resolution via topicKey)
  let resolution;
  if (input.topicKey) {
    resolution = {
      action: 'new' as const,
      reason: 'TopicKey upsert — bypasses resolve stage',
    };
  } else {
    resolution = await runResolve(
      extraction,
      input.projectId,
      config.searchMemories,
      config.getObservation,
    );
  }
  stagesCompleted = 2;

  // ── Stage 3: Evaluate ──
  const evaluation = runEvaluate(extraction);
  stagesCompleted = 3;

  const durationMs = Date.now() - startTime;

  const formed: FormedMemory = {
    // Final enriched data
    entityName: extraction.entityName,
    type: extraction.type,
    title: extraction.title,
    narrative: resolution.mergedNarrative ?? extraction.narrative,
    facts: resolution.mergedFacts ?? extraction.facts,

    // Stage results
    extraction,
    resolution,
    evaluation,

    // Pipeline metadata
    pipeline: {
      mode: 'rules',
      durationMs,
      stagesCompleted,
      shadow: config.shadow,
    },
  };

  // ── Collect metrics ──
  const metrics: FormationMetrics = {
    systemExtractedFacts: extraction.extractedFacts.length,
    titleImproved: extraction.titleImproved,
    entityResolved: extraction.entityResolved,
    typeCorrected: extraction.typeCorrected,
    resolutionAction: resolution.action,
    valueScore: evaluation.score,
    valueCategory: evaluation.category,
    durationMs,
    mode: 'rules',
  };

  if (metricsBuffer.length >= MAX_METRICS_BUFFER) {
    metricsBuffer.shift();
  }
  metricsBuffer.push(metrics);

  return formed;
}

// ── Re-exports for convenience ──────────────────────────────────

export type {
  FormationInput,
  FormedMemory,
  FormationConfig,
  FormationMetrics,
  ExtractResult,
  ResolveResult,
  EvaluateResult,
  ValueCategory,
  ResolutionAction,
  SearchHit,
  ExistingMemoryRef,
} from './types.js';
