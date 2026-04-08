/**
 * Unified Freshness Gate (Phase 3a)
 *
 * Replaces withFreshObservations() as the public API for all retrieval
 * surfaces. Checks both observation and mini-skill generation counters
 * to ensure the Orama index is fully up-to-date before any read.
 *
 * withFreshObservations() remains in observations.ts as @internal —
 * only called by this module and legacy test code.
 */

import { ensureFreshObservations } from './observations.js';
import { getMiniSkillStore, isMiniSkillStoreInitialized } from '../store/mini-skill-store.js';
import { miniSkillToDocument } from '../skills/mini-skills.js';
import { insert, remove } from '@orama/orama';

// ── Mini-skill index state ──────────────────────────────────────

let lastMiniSkillGeneration = -1;

/**
 * Check if mini-skills have changed since our last index sync.
 * If stale, reindex all mini-skills in Orama.
 *
 * Returns true if the index was refreshed.
 */
export async function ensureFreshMiniSkills(): Promise<boolean> {
  // Skip silently when the store has not been initialized yet —
  // observation-only paths never call initMiniSkillStore().
  if (!isMiniSkillStoreInitialized()) return false;

  try {
    const store = getMiniSkillStore();
    const wasStale = await store.ensureFresh();
    const currentGen = store.getGeneration();

    if (wasStale || currentGen !== lastMiniSkillGeneration) {
      await reindexMiniSkills();
      lastMiniSkillGeneration = currentGen;
      return true;
    }
  } catch (err) {
    // Best-effort — don't crash the read path, but log for diagnostics
    console.warn(`[memorix] ensureFreshMiniSkills failed: ${err instanceof Error ? err.message : err}`);
  }
  return false;
}

// Deterministic tracking of indexed mini-skill doc IDs — avoids empty-term search
const indexedSkillDocIds = new Set<string>();

/**
 * Reindex all mini-skills into the Orama database.
 * Uses deterministic doc ID tracking instead of empty-term search to ensure
 * all stale documents are removed reliably.
 */
export async function reindexMiniSkills(): Promise<number> {
  // Lazy import to avoid circular dependency
  const { getDb } = await import('../store/orama-store.js');
  const database = await getDb();

  // Remove previously tracked mini-skill documents by their known IDs
  for (const docId of indexedSkillDocIds) {
    try { await remove(database, docId); } catch { /* already removed or never existed */ }
  }
  indexedSkillDocIds.clear();

  // Load and index all current mini-skills
  const store = getMiniSkillStore();
  const skills = await store.loadAll();
  let indexed = 0;

  for (const skill of skills) {
    try {
      const doc = miniSkillToDocument(skill);
      await insert(database, doc);
      indexedSkillDocIds.add(doc.id);
      indexed++;
    } catch (err) {
      console.error(`[memorix] Failed to index mini-skill ${skill.id}: ${err instanceof Error ? err.message : err}`);
    }
  }

  return indexed;
}

// ── Unified gate ────────────────────────────────────────────────

/**
 * Ensure both observations and mini-skills are fresh in the Orama index.
 * Returns true if any data source was refreshed.
 */
export async function ensureFreshIndex(): Promise<boolean> {
  let anyStale = false;
  const obsStale = await ensureFreshObservations();
  if (obsStale) anyStale = true;
  const skillsStale = await ensureFreshMiniSkills();
  if (skillsStale) anyStale = true;
  return anyStale;
}

/**
 * Centralized freshness gate — wraps a read-facing function with
 * ensureFreshIndex() so callers cannot forget the freshness check.
 *
 * Usage:
 *   return withFreshIndex(async () => { ... read from Orama ... });
 *
 * Phase 3a: replaces withFreshObservations() at all retrieval call sites.
 */
export async function withFreshIndex<T>(fn: () => T | Promise<T>): Promise<T> {
  await ensureFreshIndex();
  return fn();
}

/**
 * Reset mini-skill freshness tracking. Used in tests.
 */
export function resetMiniSkillFreshness(): void {
  lastMiniSkillGeneration = -1;
  indexedSkillDocIds.clear();
}
