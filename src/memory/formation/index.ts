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
  BeforeAfterMetrics,
  FormationStage,
} from './types.js';
import { runExtract } from './extract.js';
import { runResolve } from './resolve.js';
import { runEvaluate } from './evaluate.js';

// ── Shadow Mode Metrics Collection ──────────────────────────────

/** In-memory metrics buffer for shadow mode analysis */
const metricsBuffer: FormationMetrics[] = [];
const MAX_METRICS_BUFFER = 500;

/** In-memory before/after comparison metrics buffer */
const beforeAfterBuffer: Array<{
  formationAction: string;
  formationTargetId?: number;
  oldCompactAction: 'ADD' | 'UPDATE' | 'NONE' | 'DELETE';
  oldCompactTargetId?: number;
  oldCompactReason?: string;
  formationValueScore: number;
  formationValueCategory: string;
  formationDurationMs: number;
  compactDurationMs?: number;
}> = [];
const MAX_BEFORE_AFTER_BUFFER = 500;

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
 * Record before/after comparison metrics.
 */
export function recordBeforeAfterMetrics(data: {
  formationAction: string;
  formationTargetId?: number;
  oldCompactAction: 'ADD' | 'UPDATE' | 'NONE' | 'DELETE';
  oldCompactTargetId?: number;
  oldCompactReason?: string;
  formationValueScore: number;
  formationValueCategory: string;
  formationDurationMs: number;
  compactDurationMs?: number;
}): void {
  if (beforeAfterBuffer.length >= MAX_BEFORE_AFTER_BUFFER) {
    beforeAfterBuffer.shift();
  }
  beforeAfterBuffer.push(data);
}

/**
 * Get before/after comparison metrics.
 */
export function getBeforeAfterMetrics(): BeforeAfterMetrics {
  const totalProcessed = beforeAfterBuffer.length;
  if (totalProcessed === 0) {
    return {
      totalProcessed: 0,
      agreements: 0,
      disagreements: 0,
      disagreementBreakdown: {
        formationDiscardedCompactAdded: 0,
        formationMergedCompactAdded: 0,
        formationAddedCompactDiscarded: 0,
        formationAddedCompactMerged: 0,
        formationEvolvedCompactAdded: 0,
        other: 0,
      },
      quality: {
        formationDiscardedLowValue: 0,
        formationMergedDuplicates: 0,
        formationEvolvedOutdated: 0,
        compactMissedDuplicates: 0,
        compactKeptLowValue: 0,
      },
      duration: {
        formationAvgMs: 0,
        compactAvgMs: 0,
        diffMs: 0,
      },
    };
  }

  let agreements = 0;
  let disagreements = 0;
  const disagreementBreakdown = {
    formationDiscardedCompactAdded: 0,
    formationMergedCompactAdded: 0,
    formationAddedCompactDiscarded: 0,
    formationAddedCompactMerged: 0,
    formationEvolvedCompactAdded: 0,
    other: 0,
  };
  const quality = {
    formationDiscardedLowValue: 0,
    formationMergedDuplicates: 0,
    formationEvolvedOutdated: 0,
    compactMissedDuplicates: 0,
    compactKeptLowValue: 0,
  };
  let formationTotalDuration = 0;
  let compactTotalDuration = 0;
  let compactDurationCount = 0;
  
  for (const data of beforeAfterBuffer) {
    formationTotalDuration += data.formationDurationMs;
    if (data.compactDurationMs !== undefined) {
      compactTotalDuration += data.compactDurationMs;
      compactDurationCount++;
    }

    // Determine if decisions agree
    const formationAction = data.formationAction;
    const oldCompactAction = data.oldCompactAction;

    // Map Formation actions to old compact actions for comparison
    let formationMapped: 'ADD' | 'UPDATE' | 'NONE' | 'DELETE' = 'ADD';
    if (formationAction === 'merge' || formationAction === 'evolve') {
      formationMapped = 'UPDATE';
    } else if (formationAction === 'discard') {
      formationMapped = 'NONE';
    }

    if (formationMapped === oldCompactAction) {
      agreements++;
    } else {
      disagreements++;
      // Track disagreement breakdown
      if (formationAction === 'discard' && oldCompactAction === 'ADD') {
        disagreementBreakdown.formationDiscardedCompactAdded++;
        if (data.formationValueCategory === 'ephemeral') {
          quality.formationDiscardedLowValue++;
        }
      } else if (formationAction === 'merge' && oldCompactAction === 'ADD') {
        disagreementBreakdown.formationMergedCompactAdded++;
        quality.formationMergedDuplicates++;
      } else if (formationAction === 'new' && oldCompactAction === 'NONE') {
        disagreementBreakdown.formationAddedCompactDiscarded++;
        quality.compactMissedDuplicates++;
      } else if (formationAction === 'new' && oldCompactAction === 'UPDATE') {
        disagreementBreakdown.formationAddedCompactMerged++;
      } else if (formationAction === 'evolve' && oldCompactAction === 'ADD') {
        disagreementBreakdown.formationEvolvedCompactAdded++;
        quality.formationEvolvedOutdated++;
      } else if (formationAction === 'new' && oldCompactAction === 'ADD') {
        // Formation decided to add, but compact also decided to add (should be rare)
        // This might indicate compact missed a duplicate or Formation was too conservative
        if (data.formationValueCategory === 'ephemeral') {
          quality.compactKeptLowValue++;
        }
      } else {
        disagreementBreakdown.other++;
      }
    }
  }

  const compactAvgMs = compactDurationCount > 0 ? compactTotalDuration / compactDurationCount : 0;
  const formationAvgMs = totalProcessed > 0 ? formationTotalDuration / totalProcessed : 0;

  return {
    totalProcessed,
    agreements,
    disagreements,
    disagreementBreakdown,
    quality,
    duration: {
      formationAvgMs,
      compactAvgMs,
      diffMs: compactAvgMs - formationAvgMs,
    },
  };
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
  const stageDurationsMs: Partial<Record<FormationStage, number>> = {};
  const emitStageEvent = (
    stage: FormationStage,
    status: 'start' | 'success' | 'skipped',
    stageDurationMs?: number,
  ): void => {
    try {
      config.onStageEvent?.({
        stage,
        status,
        stageDurationMs,
        totalElapsedMs: Date.now() - startTime,
      });
    } catch {
      // Diagnostics hooks must never break the formation pipeline.
    }
  };

  // ── Stage 1: Extract ──
  const existingEntities = config.getEntityNames();
  const extractStartTime = Date.now();
  emitStageEvent('extract', 'start');
  const extraction = await runExtract(input, existingEntities, config.useLLM);
  stageDurationsMs.extract = Date.now() - extractStartTime;
  emitStageEvent('extract', 'success', stageDurationsMs.extract);
  stagesCompleted = 1;

  // ── Stage 2: Resolve ──
  // Skip resolve for topicKey upserts (they have their own resolution via topicKey)
  let resolution;
  if (input.topicKey) {
    stageDurationsMs.resolve = 0;
    emitStageEvent('resolve', 'skipped', 0);
    resolution = {
      action: 'new' as const,
      reason: 'TopicKey upsert — bypasses resolve stage',
    };
  } else {
    const resolveStartTime = Date.now();
    emitStageEvent('resolve', 'start');
    resolution = await runResolve(
      extraction,
      input.projectId,
      config.searchMemories,
      config.getObservation,
      config.useLLM,
    );
    stageDurationsMs.resolve = Date.now() - resolveStartTime;
    emitStageEvent('resolve', 'success', stageDurationsMs.resolve);
  }
  stagesCompleted = 2;

  // ── Stage 3: Evaluate ──
  const evaluateStartTime = Date.now();
  emitStageEvent('evaluate', 'start');
  const evaluation = runEvaluate(extraction);
  stageDurationsMs.evaluate = Date.now() - evaluateStartTime;
  emitStageEvent('evaluate', 'success', stageDurationsMs.evaluate);
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
      mode: config.useLLM ? 'llm' : 'rules',
      durationMs,
      stagesCompleted,
      shadow: config.mode === 'shadow',
      stageDurationsMs,
    },

    // Governance fields
    governance: {
      provenance: {
        creator: input.source === 'explicit' ? 'user' : 'system',
        createdAt: new Date().toISOString(),
        source: input.source,
      },
      confidence: {
        score: evaluation.score,
        breakdown: {
          extractionConfidence: extraction.extractedFacts.length > 0 ? 0.8 : 0.5,
          resolutionConfidence: resolution.action === 'new' ? 0.7 : 0.9,
          evaluationConfidence: evaluation.score,
        },
        reason: `Value score ${evaluation.score.toFixed(2)} in ${evaluation.category} category`,
      },
      supersession: (resolution.action === 'merge' || resolution.action === 'evolve') && resolution.targetId ? {
        replacedIds: [resolution.targetId],
        reason: resolution.reason,
        replacementType: resolution.action === 'evolve' ? 'hard' : 'soft',
      } : undefined,
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
