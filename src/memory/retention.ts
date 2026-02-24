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
 * Immunity: observations with importance=critical, accessCount>=3, or tagged "keep"/"pinned"
 * are never auto-archived.
 */

import type { MemorixDocument, Observation } from '../types.js';
import { loadObservationsJson, saveObservationsJson, appendArchivedObservations } from '../store/persistence.js';
import { withFileLock } from '../store/file-lock.js';

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
  'problem-solution': 'medium',
  'how-it-works': 'medium',
  'what-changed': 'medium',
  'why-it-exists': 'medium',
  discovery: 'medium',
  'session-request': 'low',
};

// ── Immunity ─────────────────────────────────────────────────────────

const PROTECTED_TAGS = new Set(['keep', 'important', 'pinned', 'critical']);
const MIN_ACCESS_FOR_IMMUNITY = 3;

/**
 * Check if an observation is immune from archiving/decay.
 * Immune observations maintain a minimum relevance score.
 */
export function isImmune(doc: MemorixDocument): boolean {
  const importance = getImportanceLevel(doc);
  if (importance === 'critical' || importance === 'high') return true;
  if ((doc.accessCount ?? 0) >= MIN_ACCESS_FOR_IMMUNITY) return true;

  const concepts = doc.concepts?.split(', ').map((c) => c.toLowerCase()) ?? [];
  return concepts.some((c) => PROTECTED_TAGS.has(c));
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
  const retention = RETENTION_DAYS[importance];

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
  const retention = RETENTION_DAYS[importance];

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

// ── Auto-Archive ────────────────────────────────────────────────────

/**
 * Archive expired observations: move archive-candidates from active
 * storage to observations.archived.json.
 *
 * Returns the count of archived observations.
 * Uses file locking for cross-process safety.
 */
export async function archiveExpired(
  projectDir: string,
  referenceTime?: Date,
): Promise<{ archived: number; remaining: number }> {
  return await withFileLock(projectDir, async () => {
    const allObs = await loadObservationsJson(projectDir) as Observation[];

    // Convert to MemorixDocument-like shape for zone calculation
    const toDoc = (obs: Observation): MemorixDocument => ({
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
      accessCount: 0,
      lastAccessedAt: '',
    });

    const toArchive: Observation[] = [];
    const toKeep: Observation[] = [];

    for (const obs of allObs) {
      const doc = toDoc(obs);
      const zone = getRetentionZone(doc, referenceTime);
      if (zone === 'archive-candidate') {
        toArchive.push(obs);
      } else {
        toKeep.push(obs);
      }
    }

    if (toArchive.length === 0) {
      return { archived: 0, remaining: allObs.length };
    }

    // Move to archive file, then update active file
    await appendArchivedObservations(projectDir, toArchive);
    await saveObservationsJson(projectDir, toKeep);

    return { archived: toArchive.length, remaining: toKeep.length };
  });
}
