/**
 * Multi-device store sync — shared contracts.
 *
 * One feature, interchangeable remotes. The merge engine never talks to a
 * vendor; it talks to `SyncRemote`. A remote can be a local directory, an
 * S3-compatible object store, or a Postgres hub — chosen by configuration.
 *
 * Local-first is preserved: the canonical store stays local SQLite on every
 * machine. Sync is opt-in, asynchronous, and off the hot path.
 *
 * Identity & versioning (why this converges):
 *   - Rows are merged by a stable `syncKey`, not by the replica-local integer
 *     id. Two machines that independently insert new rows never collide, and a
 *     topic-keyed observation carries the same key everywhere.
 *   - A row's version is a per-row logical clock `(revision, writer)`. Merge is
 *     a single total order over that tuple, so replaying batches in any order
 *     reaches the same final state (last-writer-wins, convergent).
 */
import type { Observation } from '../types.js';

/** Kind of change carried in the journal. */
export type ChangeKind = 'upsert' | 'tombstone';

/**
 * A per-row logical version. Larger wins under last-writer-wins. Comparison is
 * lexicographic over `(revision, writer)` and is a strict total order, which is
 * what makes replay convergent regardless of delivery order.
 */
export interface RowVersion {
  /** Per-row Lamport counter: max revision observed for this row + 1. */
  revision: number;
  /** Stable id of the device that produced this version (deterministic tiebreak). */
  writer: string;
  /** Informational ISO timestamp; never used in comparison. */
  at?: string;
}

/** One replicated change for a single logical row, addressed by `syncKey`. */
export interface ChangeEntry {
  /** Stable cross-device identity of the row (see module doc). */
  syncKey: string;
  kind: ChangeKind;
  version: RowVersion;
  /** SHA-256 of the canonical row body; empty for tombstones. */
  contentHash: string;
  /** Present when kind === 'upsert'; omitted for tombstones. */
  row?: Observation;
}

/** A batch of changes shipped in one direction. */
export interface ChangeBatch {
  /** Schema version of the batch envelope. */
  formatVersion: 3;
  /** Hash-like remote namespace for one canonical Git project. */
  namespace: string;
  /** Canonical Memorix project ID. */
  projectId: string;
  /** Device that produced the batch. */
  deviceId: string;
  /** Monotonic sequence for this device; lets remotes dedupe/order. */
  sequence: number;
  /** ISO timestamp the batch was produced. */
  producedAt: string;
  entries: ChangeEntry[];
}

/**
 * Authoritative local record of the version we currently hold for a row,
 * keyed by `syncKey`. It serves double duty: change-detection basis for push
 * and the merge basis for pull, so a locally applied remote row is never
 * re-shipped in a loop. Persisted in the additive `sync_row_state` table.
 */
export interface SyncRowState {
  /** Canonical project that owns this row. */
  projectId: string;
  syncKey: string;
  /** Local integer id of the row, or null once tombstoned. */
  obsId: number | null;
  revision: number;
  writer: string;
  kind: ChangeKind;
  /** Content fingerprint of the row body (excludes replica-local fields). */
  contentHash: string;
  /** Sequence of the batch that last shipped this state locally. */
  shippedSeq: number;
}

/**
 * Opaque per-remote cursor. Maps deviceId -> last applied sequence, so both
 * sides know what the other has already seen. Remotes persist and return it.
 */
export interface SyncCursor {
  /** deviceId -> highest applied sequence from that device. */
  applied: Record<string, number>;
}

export function emptyCursor(): SyncCursor {
  return { applied: {} };
}

/**
 * The only surface the engine uses to reach a backend. Every adapter (fs,
 * object-store, postgres, ...) implements exactly this. No adapter is
 * privileged; provider choice is configuration, not code.
 */
export interface SyncRemote {
  /** Namespace this remote instance is allowed to read and write. */
  readonly namespace: string;
  /** Human-readable id for logs and status (e.g. "fs", "s3", "postgres"). */
  readonly kind: string;
  /** Open connections / ensure containers exist. Safe to call repeatedly. */
  init(options?: { create?: boolean }): Promise<void>;
  /** Upload one batch of local changes. Idempotent by (deviceId, sequence). */
  push(batch: ChangeBatch): Promise<void>;
  /**
   * Download batches this device has not applied yet. `since` maps
   * deviceId -> highest sequence already applied locally; the remote returns
   * only newer batches, oldest first.
   */
  pull(since: Record<string, number>, limit: number, pageToken?: string): Promise<SyncPullPage>;
  /** Explicitly remove events that every operator-supplied device cursor passed. */
  compact(through: Record<string, number>, options?: { dryRun?: boolean }): Promise<SyncCompactReport>;
  /** Release connections / flush. Safe to call when never initialized. */
  close(): Promise<void>;
}

export interface SyncCompactReport {
  candidates: number;
  deleted: number;
}

export interface SyncPullPage {
  batches: ChangeBatch[];
  hasMore: boolean;
  /** Opaque provider page token for the next call in the same run. */
  nextPageToken?: string;
}

export interface SyncPendingBatch {
  batch: ChangeBatch;
  states: SyncRowState[];
}

export interface SyncConflict {
  id: string;
  projectId: string;
  syncKey: string;
  winner: RowVersion;
  loser: RowVersion;
  loserKind: ChangeKind;
  loserRow?: Observation;
  createdAt: string;
  reason: string;
}

/** Result of a push/pull/status run, for CLI reporting. */
export interface SyncReport {
  remote: string;
  namespace: string;
  projectId: string;
  deviceId: string;
  pushed: number;
  pulledBatches: number;
  applied: number;
  skipped: number;
  tombstoned: number;
  eligible: number;
  excluded: number;
  conflicts: number;
  pending: number;
  dryRun: boolean;
  /** Per-change decisions, populated on dry runs and verbose runs. */
  decisions: SyncDecision[];
}

export type SyncOutcome = 'apply' | 'skip-older' | 'skip-equal';

export interface SyncDecision {
  syncKey: string;
  kind: ChangeKind;
  outcome: SyncOutcome;
  reason: string;
}
