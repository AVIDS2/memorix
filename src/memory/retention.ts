/**
 * Retention & Decay Engine
 *
 * Manages memory relevance over time using exponential decay.
 * Sources:
 *   - mcp-memory-service: ExponentialDecayCalculator (importance × decay × access_boost)
 *   - MemCP: Active → Archive → Purge lifecycle with immunity rules
 *
 * Relevance formula:
 *   score = baseImportance × e^(-ageDays / retentionPeriod) × accessBoost × connectionBoost
 *
 * Immunity: observations with importance=critical, valueCategory=core, accessCount>=3,
 * or tagged "keep"/"pinned" are never auto-archived.
 * High-importance types (gotcha/decision/trade-off/reasoning) retain a long 180-day
 * retention period but are no longer permanently immune — they decay normally.
 */

import type { MemorixDocument, Observation } from '../types.js';
import { getObservationStore } from '../store/obs-store.js';

// ── Importance → Retention Period mapping ────────────────────────────

export type ImportanceLevel = 'critical' | 'high' | 'medium' | 'low';

const RETENTION_DAYS: Record<ImportanceLevel, number> = {
  critical: 365,
  high: 180,
  medium: 90,
  low: 30,
};

const BASE_IMPORTANCE: Record<ImportanceLevel, number> = {
  critical: 1.0,
  high: 0.8,
  medium: 0.5,
  low: 0.3,
};

// ── Observation Type → Default Importance ────────────────────────────

const TYPE_IMPORTANCE: Record<string, ImportanceLevel> = {
  gotcha: 'high',
  decision: 'high',
  'trade-off': 'high',
  reasoning: 'high',
  'problem-solution': 'medium',
  'how-it-works': 'medium',
  'what-changed': 'low',
  'why-it-exists': 'medium',
  discovery: 'low',
  'session-request': 'low',
};

// ── Immunity ─────────────────────────────────────────────────────────

const PROTECTED_TAGS = new Set(['keep', 'important', 'pinned', 'critical']);
const MIN_ACCESS_FOR_IMMUNITY = 3;

/** Minimum effective retention period in days — prevents extreme multiplier combinations
 *  (e.g. hook × ephemeral = 0.25×) from producing unreasonably short windows. */
const MIN_RETENTION_DAYS = 7;

/**
 * Get retention period multiplier based on sourceDetail.
 * Neutral (1.0) for unknown/undefined sourceDetail — backward-compatible.
 */
function getSourceRetentionMultiplier(doc: MemorixDocument): number {
  if (doc.sourceDetail === 'hook') return 0.5;        // hook auto-captures: half the retention period
  if (doc.sourceDetail === 'git-ingest') return 1.5;  // git-backed truth: extend retention
  return 1.0;                                         // explicit/undefined: neutral
}

/**
 * Get retention period multiplier based on valueCategory.
 * Neutral (1.0) for undefined/contextual — backward-compatible.
 */
function getValueCategoryMultiplier(doc: MemorixDocument): number {
  if (doc.valueCategory === 'ephemeral') return 0.5;  // short-lived context: decay faster
  if (doc.valueCategory === 'core')      return 2.0;  // durable knowledge: extend retention
  return 1.0;                                         // contextual/undefined: neutral
}

/**
 * Compute the effective retention period in days, with floor applied.
 * Combines base retention (from importance/type) with source and valueCategory multipliers.
 */
export function getEffectiveRetentionDays(doc: MemorixDocument): number {
  const importance = getImportanceLevel(doc);
  const raw = RETENTION_DAYS[importance] * getSourceRetentionMultiplier(doc) * getValueCategoryMultiplier(doc);
  return Math.max(MIN_RETENTION_DAYS, raw);
}

/**
 * Check if an observation is immune from archiving/decay.
 * Immune observations maintain a minimum relevance score.
 */
export function isImmune(doc: MemorixDocument): boolean {
  // formation-classified core memories are immune regardless of type
  if (doc.valueCategory === 'core') return true;

  const importance = getImportanceLevel(doc);
  // Only 'critical' importance grants type-based immunity.
  // 'high' importance types (gotcha/decision/trade-off/reasoning) keep their long
  // 180-day retention period but are no longer permanently immune — this prevents
  // unbounded growth of never-accessed high-type observations.
  if (importance === 'critical') return true;
  if ((doc.accessCount ?? 0) >= MIN_ACCESS_FOR_IMMUNITY) return true;

  const concepts = doc.concepts?.split(', ').map((c) => c.toLowerCase()) ?? [];
  return concepts.some((c) => PROTECTED_TAGS.has(c));
}

/**
 * Return a human-readable reason for why an observation is immune, or null if not immune.
 */
export function getImmunityReason(doc: MemorixDocument): string | null {
  if (doc.valueCategory === 'core') return 'core valueCategory (formation-classified)';
  const importance = getImportanceLevel(doc);
  if (importance === 'critical') return 'critical importance';
  if ((doc.accessCount ?? 0) >= MIN_ACCESS_FOR_IMMUNITY) return `frequently accessed (${doc.accessCount}×)`;
  const concepts = doc.concepts?.split(', ').map((c) => c.toLowerCase()) ?? [];
  if (concepts.some((c) => PROTECTED_TAGS.has(c))) return 'protected tag';
  return null;
}

// ── Relevance Scoring ────────────────────────────────────────────────

export interface RelevanceScore {
  observationId: number;
  totalScore: number;
  baseImportance: number;
  decayFactor: number;
  accessBoost: number;
  ageDays: number;
  isImmune: boolean;
}

/**
 * Get the importance level for an observation based on its type.
 */
export function getImportanceLevel(doc: MemorixDocument): ImportanceLevel {
  return TYPE_IMPORTANCE[doc.type] ?? 'medium';
}

/**
 * Calculate the relevance score for a single observation.
 *
 * Formula (from mcp-memory-service):
 *   score = baseImportance × e^(-ageDays / retentionPeriod) × accessBoost
 *
 * Access boost (from mcp-memory-service):
 *   1 + 0.1 × accessCount (10% boost per access, capped at 2.0)
 */
export function calculateRelevance(
  doc: MemorixDocument,
  referenceTime?: Date,
): RelevanceScore {
  const now = referenceTime ?? new Date();
  const importance = getImportanceLevel(doc);
  const base = BASE_IMPORTANCE[importance];
  const retention = getEffectiveRetentionDays(doc);

  // Age in days
  const createdAt = new Date(doc.createdAt);
  const ageDays = Math.max(0, (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24));

  // Exponential decay
  const decayFactor = Math.exp(-ageDays / retention);

  // Access boost: 10% per access, capped at 2.0×
  const accessCount = doc.accessCount ?? 0;
  const accessBoost = Math.min(2.0, 1 + 0.1 * accessCount);

  let totalScore = base * decayFactor * accessBoost;

  // Immune observations get minimum 0.5 relevance
  const immune = isImmune(doc);
  if (immune) {
    totalScore = Math.max(totalScore, 0.5);
  }

  return {
    observationId: doc.observationId,
    totalScore,
    baseImportance: base,
    decayFactor,
    accessBoost,
    ageDays,
    isImmune: immune,
  };
}

/**
 * Score and rank observations by relevance.
 * Returns sorted (highest relevance first) with scores.
 */
export function rankByRelevance(
  docs: MemorixDocument[],
  referenceTime?: Date,
): RelevanceScore[] {
  return docs
    .map((doc) => calculateRelevance(doc, referenceTime))
    .sort((a, b) => b.totalScore - a.totalScore);
}

// ── Retention Lifecycle ──────────────────────────────────────────────

export type RetentionZone = 'active' | 'stale' | 'archive-candidate';

/**
 * Classify an observation into a retention zone.
 *
 * Lifecycle (from MemCP):
 *   Active: recently accessed or high importance
 *   Stale: not accessed, beyond 50% of retention period
 *   Archive-candidate: not accessed, beyond 100% of retention period, not immune
 */
export function getRetentionZone(doc: MemorixDocument, referenceTime?: Date): RetentionZone {
  const now = referenceTime ?? new Date();
  const importance = getImportanceLevel(doc);
  const retention = getEffectiveRetentionDays(doc);

  const createdAt = new Date(doc.createdAt);
  const ageDays = (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24);

  // Recently accessed = active regardless of age
  if (doc.lastAccessedAt) {
    const lastAccess = new Date(doc.lastAccessedAt);
    const daysSinceAccess = (now.getTime() - lastAccess.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceAccess < 7) return 'active';
  }

  if (isImmune(doc)) return 'active';
  if (ageDays > retention) return 'archive-candidate';
  if (ageDays > retention * 0.5) return 'stale';
  return 'active';
}

/**
 * Get archive candidates from a list of observations.
 * Returns observations that are beyond their retention period and not immune.
 */
export function getArchiveCandidates(
  docs: MemorixDocument[],
  referenceTime?: Date,
): MemorixDocument[] {
  return docs.filter((doc) => getRetentionZone(doc, referenceTime) === 'archive-candidate');
}

/**
 * Get retention summary statistics.
 */
export function getRetentionSummary(
  docs: MemorixDocument[],
  referenceTime?: Date,
): { active: number; stale: number; archiveCandidates: number; immune: number } {
  let active = 0;
  let stale = 0;
  let archiveCandidates = 0;
  let immune = 0;

  for (const doc of docs) {
    const zone = getRetentionZone(doc, referenceTime);
    if (zone === 'active') active++;
    else if (zone === 'stale') stale++;
    else archiveCandidates++;
    if (isImmune(doc)) immune++;
  }

  return { active, stale, archiveCandidates, immune };
}

// ── Retention Explainability ─────────────────────────────────────────

export interface RetentionExplanation {
  observationId: number;
  importanceLevel: ImportanceLevel;
  baseRetentionDays: number;
  sourceMultiplier: number;
  valueCategoryMultiplier: number;
  effectiveRetentionDays: number;
  zone: RetentionZone;
  immune: boolean;
  /** Human-readable reason for immunity, or null when not immune. */
  immunityReason: string | null;
  ageDays: number;
  /** Short human-readable summary of the retention posture. */
  summary: string;
}

/**
 * Produce a structured explanation of why an observation has its current
 * retention posture.  Designed for operator-facing reporting.
 */
export function explainRetention(
  doc: MemorixDocument,
  referenceTime?: Date,
): RetentionExplanation {
  const importance = getImportanceLevel(doc);
  const baseRetention = RETENTION_DAYS[importance];
  const srcMul = getSourceRetentionMultiplier(doc);
  const vcMul = getValueCategoryMultiplier(doc);
  const effective = getEffectiveRetentionDays(doc);
  const zone = getRetentionZone(doc, referenceTime);
  const immuneFlag = isImmune(doc);
  const immunityReason = getImmunityReason(doc);

  const now = referenceTime ?? new Date();
  const ageDays = Math.max(
    0,
    (now.getTime() - new Date(doc.createdAt).getTime()) / (1000 * 60 * 60 * 24),
  );

  // Build a concise human-readable summary
  const parts: string[] = [];
  parts.push(`${importance} importance (${baseRetention}d base)`);
  if (srcMul !== 1.0) parts.push(`source ${srcMul}×`);
  if (vcMul !== 1.0) parts.push(`valueCategory ${vcMul}×`);
  parts.push(`→ ${effective}d effective`);
  if (immuneFlag) {
    parts.push(`immune: ${immunityReason}`);
  } else {
    parts.push(`zone: ${zone}`);
  }

  return {
    observationId: doc.observationId,
    importanceLevel: importance,
    baseRetentionDays: baseRetention,
    sourceMultiplier: srcMul,
    valueCategoryMultiplier: vcMul,
    effectiveRetentionDays: effective,
    zone,
    immune: immuneFlag,
    immunityReason,
    ageDays: Math.round(ageDays),
    // Summary is rendered inside markdown table cells in memorix_retention output,
    // so avoid pipe separators that would split the row into extra columns.
    summary: parts.join(' ; '),
  };
}

// ── Auto-Archive ────────────────────────────────────────────────────

/**
 * Archive expired observations by setting status='archived' in-place.
 *
 * Phase 2 change: instead of moving observations to a separate
 * observations.archived.json file, we update their status in the
 * canonical store (SQLite or JSON). This eliminates the separate
 * archive file and keeps all observation data in one place.
 *
 * Returns the count of archived observations.
 */
export async function archiveExpired(
  projectDir: string,
  referenceTime?: Date,
  accessMap?: Map<number, { accessCount: number; lastAccessedAt: string }>,
): Promise<{ archived: number; remaining: number }> {
  const store = getObservationStore();
  return await store.atomic(async (tx) => {
    const allObs = await tx.loadAll();

    // Convert to MemorixDocument-like shape for zone calculation
    // Use accessMap (from Orama index) when available for accurate immunity checks
    const toDoc = (obs: Observation): MemorixDocument => {
      const access = accessMap?.get(obs.id);
      return {
        id: `obs-${obs.id}`,
        observationId: obs.id,
        entityName: obs.entityName,
        type: obs.type,
        title: obs.title,
        narrative: obs.narrative,
        facts: obs.facts.join('\n'),
        filesModified: obs.filesModified.join('\n'),
        concepts: obs.concepts.join(', '),
        tokens: obs.tokens,
        createdAt: obs.createdAt,
        projectId: obs.projectId,
        accessCount: access?.accessCount ?? 0,
        lastAccessedAt: access?.lastAccessedAt ?? '',
        status: obs.status ?? 'active',
        source: obs.source ?? 'agent',
        sourceDetail: obs.sourceDetail ?? '',
        valueCategory: obs.valueCategory ?? '',
      };
    };

    // Only consider active observations for archiving
    const activeObs = allObs.filter(o => (o.status ?? 'active') === 'active');
    let archivedCount = 0;

    for (const obs of activeObs) {
      const doc = toDoc(obs);
      const zone = getRetentionZone(doc, referenceTime);
      if (zone === 'archive-candidate') {
        obs.status = 'archived';
        archivedCount++;
      }
    }

    if (archivedCount === 0) {
      return { archived: 0, remaining: activeObs.length };
    }

    // Persist all observations with updated statuses
    await tx.saveAll(allObs);

    return { archived: archivedCount, remaining: activeObs.length - archivedCount };
  });
}
