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
}
