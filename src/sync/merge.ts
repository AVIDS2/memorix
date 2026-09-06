/**
 * Merge policy — pure, convergent last-writer-wins.
 *
 * Every row is versioned by a per-row logical clock `(revision, writer)` and
 * merged against the locally recorded `SyncRowState` for its `syncKey`. Because
 * the comparison is a single strict total order, applying a set of changes in
 * any order yields the same final state (CRDT-style convergence). Tombstones
 * are ordinary versioned states, so a stale upsert can never resurrect a row a
 * newer delete removed.
 *
 * Everything here is pure: no I/O, no store access. That keeps the policy
 * unit-testable and identical across every remote backend.
 */
import type { ChangeEntry, RowVersion, SyncDecision, SyncRowState } from './types.js';

/**
 * Compare two row versions. Returns >0 if `a` wins, <0 if `b` wins, 0 if they
 * are the same logical version. Lexicographic over `(revision, writer)`.
 */
export function compareVersion(a: RowVersion, b: RowVersion): number {
  if (a.revision !== b.revision) return a.revision - b.revision;
  if (a.writer === b.writer) return 0;
  return a.writer < b.writer ? -1 : 1;
}

/** The next logical version for a locally originated write. */
export function nextVersion(prior: SyncRowState | undefined, writer: string, at: string): RowVersion {
  const revision = (prior?.revision ?? 0) + 1;
  return { revision, writer, at };
}

export type MergeOutcome = SyncDecision['outcome'];

/** What the engine must do to the local store to realize the merge result. */
export type MergeAction =
  | { type: 'noop' }
  | { type: 'insert'; version: RowVersion; contentHash: string }
  | { type: 'update'; obsId: number; version: RowVersion; contentHash: string }
  | { type: 'remove'; obsId: number; version: RowVersion };

export interface MergeInput {
  incoming: ChangeEntry;
  /** Locally recorded state for this syncKey, or undefined if unknown here. */
  local: SyncRowState | undefined;
  /** Content fingerprint of `incoming.row` (upserts only). */
  incomingHash: string;
}

export interface MergeResult {
  decision: SyncDecision;
  action: MergeAction;
}

/**
 * Decide the fate of one incoming change against local state. Pure LWW: the
 * strictly-newer version wins; ties (same version) are treated as already
 * applied. No lifecycle special-casing — generation/revision ordering alone
 * guarantees a stale write never overrides a newer one.
 */
export function mergeOne(input: MergeInput): MergeResult {
  const { incoming, local, incomingHash } = input;
  const { syncKey, kind, version } = incoming;

  // Nothing known locally: an upsert becomes an insert; a tombstone is still
  // recorded (durably) so a later stale upsert cannot resurrect the row.
  if (!local) {
    if (kind === 'tombstone') {
      return {
        decision: { syncKey, kind, outcome: 'apply', reason: 'record remote tombstone' },
        action: { type: 'noop' },
      };
    }
    return {
      decision: { syncKey, kind, outcome: 'apply', reason: 'new row from remote' },
      action: { type: 'insert', version, contentHash: incomingHash },
    };
  }

  const cmp = compareVersion(version, { revision: local.revision, writer: local.writer });
  if (cmp < 0) {
    return {
      decision: { syncKey, kind, outcome: 'skip-older', reason: 'local version is newer' },
      action: { type: 'noop' },
    };
  }
  if (cmp === 0) {
    return {
      decision: { syncKey, kind, outcome: 'skip-equal', reason: 'identical version' },
      action: { type: 'noop' },
    };
  }

  // Incoming wins.
  if (kind === 'tombstone') {
    // Delete a row we still hold; if already tombstoned locally, just advance.
    const action: MergeAction =
      local.obsId != null ? { type: 'remove', obsId: local.obsId, version } : { type: 'noop' };
    return {
      decision: { syncKey, kind, outcome: 'apply', reason: 'newer tombstone' },
      action,
    };
  }

  // Upsert wins. Update in place if we still have a live row, else re-insert
  // (covers reviving from a local tombstone with a genuinely newer version).
  if (local.obsId != null) {
    return {
      decision: { syncKey, kind, outcome: 'apply', reason: 'newer upsert' },
      action: { type: 'update', obsId: local.obsId, version, contentHash: incomingHash },
    };
  }
  return {
    decision: { syncKey, kind, outcome: 'apply', reason: 'newer upsert after local tombstone' },
    action: { type: 'insert', version, contentHash: incomingHash },
  };
}
