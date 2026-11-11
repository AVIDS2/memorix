/**
 * Surfaced-entry registry — session-level "already shown this session" bookkeeping.
 *
 * The retrieval layer can demote entries whose ids are marked as surfaced, so
 * a coding session does not get the same memory rows re-shown for every
 * related question. This registry is the state that remembers which ids have
 * been shown, keyed by session scope.
 *
 * Design boundaries:
 * - In-memory and bounded: at most MAX_KEYS scopes, at most MAX_IDS ids per
 *   scope, oldest evicted first. Restarting the server resets it, which is
 *   correct — "surfaced" only means "shown in this live session".
 * - Best-effort: losing an entry only costs one redundant row, never data.
 * - Scope keys are caller-owned strings (e.g. "session:<id>" or
 *   "project:<id>"); the registry does not interpret them.
 */

const MAX_KEYS = 64;
const MAX_IDS = 200;

const registry = new Map<string, number[]>();

function touch(key: string): number[] {
  const ids = registry.get(key);
  if (!ids) return [];
  // Re-insert so Map iteration order approximates LRU for eviction.
  registry.delete(key);
  registry.set(key, ids);
  return ids;
}

/** Ids already surfaced for this scope, oldest first. Never mutates state. */
export function getSurfacedIds(key: string): number[] {
  return [...touch(key)];
}

/** Mark ids as surfaced for this scope. New ids append; old ids overflow out. */
export function recordSurfacedIds(key: string, ids: number[]): void {
  if (ids.length === 0) return;

  let list = registry.get(key) ?? [];
  const known = new Set(list);
  for (const id of ids) {
    if (known.has(id)) continue;
    known.add(id);
    list.push(id);
  }
  if (list.length > MAX_IDS) {
    list = list.slice(list.length - MAX_IDS);
  }
  registry.set(key, list);

  if (registry.size > MAX_KEYS) {
    const oldestKey = registry.keys().next().value;
    if (oldestKey !== undefined && oldestKey !== key) registry.delete(oldestKey);
  }
}

/** Test/teardown helper — resets all in-memory state. */
export function clearSurfacedRegistry(): void {
  registry.clear();
}
