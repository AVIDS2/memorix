/**
 * Memory Formation Pipeline — Type Definitions
 *
 * The Formation Pipeline is a middleware layer that processes raw memory input
 * before it reaches storeObservation(). It transforms raw data into high-quality,
 * structured memories through three stages: Extract → Resolve → Evaluate.
 *
 * Design principles:
 * - Each stage has typed input/output
 * - Pipeline produces FormedMemory as its intermediate representation
 * - Supports dual-mode: rules-based (free) + LLM-powered (premium)
 * - Shadow mode: can run alongside existing compact-on-write without side effects
 */

import type { ObservationType } from '../../types.js';

// ============================================================
// Pipeline Input (what comes in from memorix_store or hooks)
// ============================================================

/** Raw input to the Formation Pipeline */
export interface FormationInput {
  entityName: string;
  type: ObservationType;
  title: string;
  narrative: string;
  facts?: string[];
  filesModified?: string[];
  concepts?: string[];
  projectId: string;
  /** Source of this input */
  source: 'explicit' | 'hook';
  /** Topic key for upsert (bypasses resolve stage) */
  topicKey?: string;
}

// ============================================================
// Stage 1: Extract
// ============================================================

/** Output of the Extract stage */
export interface ExtractResult {
  /** Enriched title (may be improved from generic titles) */
  title: string;
  /** Whether title was auto-improved */
  titleImproved: boolean;

  /** Enriched narrative */
  narrative: string;

  /** All facts: caller-provided + system-extracted */
  facts: string[];
  /** Facts extracted by the system (not provided by caller) */
  extractedFacts: string[];

  /** Resolved entity name (may differ from input if matched to existing KG entity) */
  entityName: string;
  /** Whether entity was resolved from Knowledge Graph */
  entityResolved: boolean;

  /** Verified or corrected observation type */
  type: ObservationType;
  /** Whether type was auto-corrected */
  typeCorrected: boolean;
}

// ============================================================
// Stage 2: Resolve
// ============================================================

/** Resolution action — what to do with this memory */
export type ResolutionAction = 'new' | 'merge' | 'evolve' | 'discard';

/** Output of the Resolve stage */
export interface ResolveResult {
  action: ResolutionAction;
  /** ID of existing observation to merge into or evolve from */
  targetId?: number;
  /** Explanation of why this action was chosen */
  reason: string;
  /** Merged narrative (for merge/evolve actions) */
  mergedNarrative?: string;
  /** Merged facts (for merge/evolve actions) */
  mergedFacts?: string[];
}

// ============================================================
// Stage 3: Evaluate
// ============================================================

/** Knowledge value category */
export type ValueCategory = 'core' | 'contextual' | 'ephemeral';

/** Output of the Evaluate stage */
export interface EvaluateResult {
  /** Value score 0-1 */
  score: number;
  /** Classified category */
  category: ValueCategory;
  /** Explanation of assessment */
  reason: string;
}

/** Named Formation pipeline stage. */
export type FormationStage = 'extract' | 'resolve' | 'evaluate';

/** Per-stage diagnostics emitted during pipeline execution. */
export interface FormationStageEvent {
  /** Stage that emitted the event */
  stage: FormationStage;
  /** Lifecycle status for the stage */
  status: 'start' | 'success' | 'skipped';
  /** Duration of the stage when available */
  stageDurationMs?: number;
  /** Total elapsed time for the pipeline at emission time */
  totalElapsedMs: number;
}

// ============================================================
// Pipeline Output: FormedMemory
// ============================================================

/** The complete output of the Formation Pipeline */
export interface FormedMemory {
  // ── Final enriched data (ready for storeObservation) ──
  entityName: string;
  type: ObservationType;
  title: string;
  narrative: string;
  facts: string[];

  // ── Stage results ──
  extraction: ExtractResult;
  resolution: ResolveResult;
  evaluation: EvaluateResult;

  // ── Pipeline metadata ──
  pipeline: {
    /** Which mode was used */
    mode: 'rules' | 'llm';
    /** Total pipeline duration in ms */
    durationMs: number;
    /** Number of stages completed (0-3) */
    stagesCompleted: number;
    /** Whether this was run in shadow mode (no side effects) */
    shadow: boolean;
    /** Per-stage durations in ms for diagnostics */
    stageDurationsMs: Partial<Record<FormationStage, number>>;
  };

  // ── Governance fields (enterprise-grade metadata) ──
  governance?: {
    /** Provenance: source tracking */
    provenance: {
      /** Who created this memory (agent ID, user ID, or system) */
      creator: string;
      /** When this memory was created (ISO 8601 timestamp) */
      createdAt: string;
      /** Source of the memory (explicit, hook, auto, etc.) */
      source: 'explicit' | 'hook' | 'auto' | 'import';
      /** Raw input reference (if applicable) */
      rawInputRef?: string;
    };
    /** Confidence: decision reliability score (0-1) */
    confidence: {
      /** Overall confidence score */
      score: number;
      /** Breakdown by stage */
      breakdown: {
        extractionConfidence: number;
        resolutionConfidence: number;
        evaluationConfidence: number;
      };
      /** Reason for confidence score */
      reason: string;
    };
    /** Supersession: memory replacement relationships */
    supersession?: {
      /** IDs of memories this one replaces */
      replacedIds: number[];
      /** Reason for replacement */
      reason: string;
      /** Whether this is a soft replacement (archived) or hard replacement (deleted) */
      replacementType: 'soft' | 'hard';
    };
  };
}

// ============================================================
// Pipeline Configuration
// ============================================================

/** Formation Pipeline operating mode */
export type FormationMode = 'shadow' | 'active' | 'fallback';

/** Configuration for the Formation Pipeline */
export interface FormationConfig {
  /** Operating mode: shadow (observe only), active (affects storage), fallback (old compact primary) */
  mode: FormationMode;
  /** Run in shadow mode: compute FormedMemory but don't affect storage (deprecated, use mode instead) */
  shadow?: boolean;
  /** Enable LLM-powered stages (requires LLM API key) */
  useLLM: boolean;
  /** Minimum value score to proceed with storage (default: 0.3) */
  minValueScore: number;
  /** Sampling rate for hooks path (0-1). 0 = always shadow, 1 = always full resolve */
  hooksSamplingRate?: number;
  /** Function to search existing memories (injected dependency) */
  searchMemories: (query: string, limit: number, projectId: string) => Promise<SearchHit[]>;
  /** Function to get observation by ID (injected dependency) */
  getObservation: (id: number) => ExistingMemoryRef | null;
  /** Function to list existing entity names (injected dependency) */
  getEntityNames: () => string[];
  /** Optional stage callback for diagnostics/logging */
  onStageEvent?: (event: FormationStageEvent) => void;
}

/** A search hit from existing memories (used by Resolve stage) */
export interface SearchHit {
  id: number;
  observationId: number;
  title: string;
  narrative: string;
  facts: string;
  entityName: string;
  type: string;
  score: number;
}

/** Minimal reference to an existing observation (used by Resolve stage) */
export interface ExistingMemoryRef {
  id: number;
  entityName: string;
  type: ObservationType;
  title: string;
  narrative: string;
  facts: string[];
  topicKey?: string;
}

// ============================================================
// Pipeline Metrics (for shadow mode comparison)
// ============================================================

/** Metrics collected during pipeline execution */
export interface FormationMetrics {
  /** Number of facts extracted by system */
  systemExtractedFacts: number;
  /** Whether title was improved */
  titleImproved: boolean;
  /** Whether entity was resolved to existing KG entity */
  entityResolved: boolean;
  /** Whether type was corrected */
  typeCorrected: boolean;
  /** Resolution action taken */
  resolutionAction: ResolutionAction;
  /** Value score */
  valueScore: number;
  /** Value category */
  valueCategory: ValueCategory;
  /** Total duration ms */
  durationMs: number;
  /** Pipeline mode */
  mode: 'rules' | 'llm';
  
  // ── Before/After Comparison Metrics ─────────────────────────────
  /** What old compact-on-write would have done (for comparison) */
  oldCompactAction?: 'ADD' | 'UPDATE' | 'NONE' | 'DELETE';
  /** ID of target observation old compact would have merged into */
  oldCompactTargetId?: number;
  /** Reason old compact would have given */
  oldCompactReason?: string;
  /** Whether Formation decision differs from old compact */
  decisionDiffers?: boolean;
  /** Which decision is better (formation | compact | equal | unknown) */
  betterDecision?: 'formation' | 'compact' | 'equal' | 'unknown';
}

/** Aggregated before/after comparison metrics */
export interface BeforeAfterMetrics {
  /** Total observations processed */
  totalProcessed: number;
  /** Number where Formation and old compact agreed */
  agreements: number;
  /** Number where Formation and old compact disagreed */
  disagreements: number;
  /** Disagreement breakdown */
  disagreementBreakdown: {
    formationDiscardedCompactAdded: number;
    formationMergedCompactAdded: number;
    formationAddedCompactDiscarded: number;
    formationAddedCompactMerged: number;
    formationEvolvedCompactAdded: number;
    other: number;
  };
  /** Quality metrics */
  quality: {
    /** Formation discarded low-value memories */
    formationDiscardedLowValue: number;
    /** Formation merged duplicates */
    formationMergedDuplicates: number;
    /** Formation evolved outdated memories */
    formationEvolvedOutdated: number;
    /** Old compact missed duplicates */
    compactMissedDuplicates: number;
    /** Old compact kept low-value */
    compactKeptLowValue: number;
  };
  /** Average duration comparison */
  duration: {
    formationAvgMs: number;
    compactAvgMs: number;
    diffMs: number;
  };
}
