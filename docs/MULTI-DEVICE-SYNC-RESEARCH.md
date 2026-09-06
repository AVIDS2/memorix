# Multi-Device Store Sync — Plan and Acceptance Contract

> Status: active implementation plan for the first supported sync slice.
> Scope: keep the existing local-first SQLite runtime; add an optional,
> provider-agnostic replication path so one user can keep the same memory
> across several machines.
> Prior art in this repo: `docs/CLOUD_SYNC_AND_MULTI_AGENT_RESEARCH.md`
> already sketched a "local SQLite + background cloud sync" hybrid but did not
> specify or build it. This document turns that sketch into a concrete,
> reviewable contract.

## Decision Summary

The sync layer must replicate **auditable memory events**, never a live SQLite
file. GitHub can be a low-cost relay for immutable JSONL batches, but GitHub
LFS is not a database merge engine and is not the production default. The
runtime keeps SQLite local and treats each remote as an interchangeable event
transport.

The first supported contract is deliberately narrow:

- **Scope:** the current Git project by default. A remote namespace includes the
  canonical project ID; one project cannot pull another project's events by
  accident.
- **Eligibility:** project-visible, non-ephemeral, qualified/legacy durable
  observations only. Personal, agent-targeted, candidate, and ephemeral records
  are excluded unless a future explicit export policy opts them in.
- **Identity:** every sync key includes the project ID. Unkeyed rows also carry
  origin device and origin ID, so global store IDs can never cross projects.
- **Transport:** immutable per-device event batches, local cursors, checksums,
  bounded pulls, and idempotent replay. Remote cursors are not authoritative.
- **Conflict:** logical version order decides the current visible row, while a
  losing concurrent version remains available as conflict/audit evidence rather
  than disappearing silently.
- **Device safety:** a copied data directory is detected as a clone and must
  rotate its device identity before it can publish new events.
- **User experience:** manual `status`, `push`, `pull`, and `repair` first;
  background sync is a later opt-in once retention and recovery gates pass.

## Implementation Phases

| Phase | Deliverable | Gate |
| --- | --- | --- |
| P0 | Plan, scope, privacy and event contract | docs map updated; no live SQLite sync path |
| P1 | Project-scoped local journal and safe eligibility filter | private/candidate/other-project fixtures never leave the scope |
| P2 | Deterministic merge, tombstones, conflicts, clone detection | permutation, delete, replay, clone and conflict tests pass |
| P3 | Filesystem and GitHub JSONL relays | two real data directories reconcile without DB/WAL files |
| P4 | Bounded S3/Postgres pulls and remote namespace isolation | paged pull, malformed input, retry and large-log tests pass |
| P5 | Snapshot/compaction/retention and CLI repair | no unbounded remote scan; recovery from snapshot is tested |
| P6 | Cross-platform smoke and release review | Windows/macOS/Linux checks, docs, package smoke, contributor credit |

## GitHub Relay Contract

The GitHub adapter uses a private repository as a versioned transport, not as
the canonical database:

```text
events/<project-hash>/<device-id>/<sequence>.jsonl
snapshots/<project-hash>/<snapshot-id>.json.zst
```

Event files are immutable and device-owned. A device never edits another
device's file and never commits `memorix.db`, `memorix.db-wal`, or
`memorix.db-shm`. Each event contains a schema version, project namespace,
device ID, sequence, event ID, entity key, operation, logical version,
visibility decision, content hash, and payload. Payload encryption is required
for private remotes when the user enables the encrypted mode; credentials never
enter project files or event bodies.

Snapshots are normalized, replayable memory state, not a copy of an open
SQLite file. SQLite's Online Backup API may be used for a local backup, but a
backup is not a merge input.

## Acceptance Checklist

- [ ] `memorix sync store status --json` reports scope, eligible/skipped counts,
      remote namespace, cursor, pending batches, and conflicts without sending data.
- [ ] `push` and `pull` are idempotent and resumable after interruption.
- [ ] Two stores with independent local integer IDs converge to the same visible
      records while retaining local IDs locally.
- [ ] A stale upsert cannot revive a newer delete.
- [ ] A concurrent same-key edit keeps both the winner and a reviewable losing
      version/audit record.
- [ ] Personal, agent-targeted, candidate, ephemeral, and other-project rows
      are excluded by default.
- [ ] Copying a data directory produces a clear device-clone error and a
      documented `device rotate` recovery path.
- [ ] GitHub relay smoke proves only JSONL/snapshot artifacts are uploaded;
      no SQLite database or WAL file is present.
- [ ] Pulls are bounded and paged; remote logs have a retention/compaction path.
- [ ] Malformed, foreign-project, unsupported-version, and hash-mismatch input
      fails closed without mutating local memory.
- [ ] Local-only users see no behavior or dependency change when sync is unset.

---

## 1. Problem

A single user commonly runs Memorix on more than one machine — for example a
workstation, a home machine, and a portable laptop. Today each machine keeps
its own independent store at `~/.memorix/data` (`MEMORIX_DATA_DIR`). There is
no supported way to keep those stores current with each other, so the memory a
user sees depends on which machine they happen to open.

Two deployment shapes are sometimes proposed to solve this. Both have real
costs:

1. **Run one central Memorix service and point every machine at it over HTTP.**
   `serve-http` already supports this (see `docs/DOCKER.md`). It gives a single
   shared store, but it trades away the properties that make Memorix useful on
   a workstation:
   - **Project-scoped features degrade.** Git-root detection, project binding,
     project `memorix.toml`/`.env`, and Git Memory require the service to see
     the repository at the path the client reports. A central host usually
     cannot see a laptop's working copy, so project-scoped semantics break
     while only global/shared memory keeps working. `docs/DOCKER.md` documents
     this as a real runtime limitation.
   - **Latency on the hot path.** Every context call, session start, and hook
     becomes a network round trip instead of a local SQLite read.
   - **Offline stops working.** A portable machine with no connectivity has no
     memory at all.
   - **Single-writer contention.** One SQLite file serving several machines
     serializes writes and invites `SQLITE_BUSY`.

2. **Replace SQLite with a central client/server database (e.g. Postgres).**
   This contradicts the stated local-first product boundary in
   `docs/KNOWN_ISSUES_AND_ROADMAP.md`, and would require rewriting the
   synchronous `better-sqlite3` store layer (`src/store/*.ts`) onto an async
   client with a different SQL dialect and a different vector story. It removes
   offline use and adds an always-on infrastructure dependency for what is
   meant to be a local tool.

Neither shape preserves local-first. The gap is a **third shape**: keep the
store local on every machine, and add an **optional replication layer** that
keeps those local stores consistent through an interchangeable remote.

---

## 2. Goals and non-goals

### Goals

- Preserve local-first: reads and writes stay on the local SQLite store; sync
  is asynchronous and off the hot path.
- Keep working offline; reconcile on the next successful sync.
- Be **provider-agnostic**: the remote is an interface, not a specific vendor.
  A local filesystem/rsync target, an object store (S3-compatible), or a small
  edge datastore must all be valid backends behind the same contract.
- Be **opt-in and safe**: sync is disabled by default; enabling it never
  changes local behavior for users who do not use it.
- Deterministic, explainable merge: a user can inspect what would change before
  it is applied, consistent with the preview-first maintenance model.

### Non-goals

- No real-time multi-writer coordination or distributed locking. That is the
  `team`/orchestration surface, not this.
- No requirement to run a central Memorix service.
- No replacement of the SQLite runtime or the retrieval/embedding model.
- No claim of conflict-free collaboration between different users; this targets
  one user's several machines. Multi-user sharing is a separate concern.

---

## 3. Why the current schema already supports this

The canonical store carries most of what a convergent last-writer-wins (LWW)
merge needs, and the small remainder lives in additive side tables so the
`observations` schema never changes:

- **Stable cross-device identity.** The integer `observations.id` is a
  *replica-local* counter (`meta.next_id`) — two machines can mint the same id
  for unrelated rows — so it cannot be the merge key. Sync instead derives a
  stable `syncKey`: `t:<projectId>:<topicKey>` for topic-keyed observations
  (naturally shared across devices) and `u:<originDevice>:<originId>` for
  unkeyed ones, minted once and recorded in `sync_row_state`. Each replica maps
  a `syncKey` to its own local id on import, so id collisions are impossible.
- **Convergent versioning.** Merge uses a per-row logical clock
  `(revision, writer)` — a Lamport counter advanced from the last observed
  revision, tiebroken by the originating device id — persisted verbatim in
  `sync_row_state`. This is a strict total order, so replaying batches in any
  delivery order reaches the same state. `writeGeneration`/`updatedAt` remain a
  local storage watermark and are deliberately *not* used as the comparator
  (they are not comparable across replicas).
- **Durable tombstones.** Deletes are versioned states retained in
  `sync_row_state`, so a stale upsert pulled later cannot resurrect a row a
  newer delete removed.
- **Provenance.** `source`, `sourceDetail`, `createdByAgentId`, `projectId`,
  and `sessionId` let a merge attribute and scope rows.

A first version therefore replicates at the **observation row** granularity
with no migration of existing data: identity, version, and tombstone state all
live in the additive `sync_row_state` / `sync_meta` tables.

---

## 4. Proposed architecture

### 4.1 Two layers

1. **A change journal (local).** A small append-only log of committed mutations
   keyed by table + row id + logical version. This can be derived from existing
   columns for observations in v1, and generalized to other tables later. The
   journal is what gets shipped, so sync never has to diff the whole 900 MB
   database.
2. **A replication transport (remote).** A narrow interface that can `push`
   local journal segments and `pull` remote ones. The store never talks to a
   vendor directly; it talks to this interface.

### 4.2 Transport interface (provider-agnostic)

```ts
// Final interface (src/sync/types.ts). Cursor maps deviceId -> last applied
// sequence, so both sides know what the other has already seen.
interface SyncRemote {
  readonly kind: string;                 // "fs" | "s3" | "postgres"
  init(): Promise<void>;
  getCursor(deviceId: string): Promise<SyncCursor>;
  setCursor(deviceId: string, cursor: SyncCursor): Promise<void>;
  push(batch: ChangeBatch): Promise<void>;            // idempotent by (deviceId, sequence)
  pull(since: Record<string, number>): Promise<ChangeBatch[]>; // newer batches, oldest first
  close(): Promise<void>;
}
```

Concrete adapters implement `SyncRemote` only:

- **`fs`/`rsync`** — a directory the user already syncs by other means; zero
  new infrastructure, good for a first, fully local test.
- **`s3`** — any S3-compatible object store; batches are immutable objects
  under a key prefix, head is a small manifest object.
- **`edge-kv`/`edge-sql`** — a small edge datastore for users who want a
  hosted hop without running a full service.

The point is that no adapter is privileged. Provider choice is configuration,
not code, mirroring how `[memory.llm]`, `[embedding]`, and rerank already
select providers by config.

### 4.3 Merge strategy

- **Row-level last-writer-wins**, merged by the stable `syncKey` and versioned
  by the per-row logical clock `(revision, writer)`. The comparison is a strict
  total order, so the merge is convergent: any delivery/replay order of the
  same batches yields the same final state.
- **No lifecycle special-casing.** An earlier design ordered `status`
  transitions in lifecycle rank; that made the merge order-dependent (applying
  `active`@rev2 then `archived`@rev1 diverged from the reverse). Revision
  ordering alone already prevents a stale `active` copy from overriding a newer
  supersession/archival, so the guard was removed in favour of provable
  convergence.
- **Durable tombstones.** A delete is a versioned state kept in
  `sync_row_state`, so a delete on machine A is never resurrected by machine B's
  stale upsert — even when B pulls the old upsert after the delete.
- **Preview-first:** `sync --dry` reports the exact set of inserts, updates,
  supersessions, and tombstones that would apply, consistent with the existing
  preview-first maintenance actions.

### 4.4 Configuration surface (illustrative)

```toml
[sync]
enabled = false          # opt-in; default off
provider = "fs"          # fs | s3 | edge-kv | ...
mode     = "manual"      # manual | interval
# provider-specific settings live under a provider table, e.g. [sync.s3]
# credentials come from the environment, never from this file
```

Credentials and endpoints are resolved from the environment (as LLM/embedding
keys already are), never written into a config file that could be shared.

### 4.5 CLI surface (illustrative)

- `memorix sync push` / `memorix sync pull` / `memorix sync status`
- `memorix sync --dry` for a preview before applying
- Optional background interval sync gated behind `[sync].mode = "interval"`

> Note: `memorix sync` today handles cross-agent **rules** synchronization
> (`src/cli/commands/sync.ts`). Store replication must not collide with that
> surface; it should live under a clearly separated subcommand namespace
> (for example `memorix sync store ...`) or a new top-level verb, decided by
> the maintainer.

---

## 5. Phasing

1. **Phase 1 — journal + `fs` adapter, observations only.**
   Prove correctness locally with no external service: two data dirs on one
   machine reconcile through a shared directory. Deterministic merge tests.
2. **Phase 2 — object-store adapter + preview.**
   Add an S3-compatible adapter and `sync --dry`. Add the interval mode.
3. **Phase 3 — remaining tables + tombstones + lifecycle ordering.**
   Extend beyond observations (sessions, knowledge, code-state) with the same
   contract; formalize tombstones and lifecycle-aware precedence.
4. **Phase 4 — optional edge adapter.**
   A hosted hop for users who want cross-machine sync without self-hosting.

Each phase is independently useful and independently reviewable.

---

## 6. Compatibility and safety

- **Default off.** Users who never enable `[sync]` see no behavior change.
- **No hot-path cost.** Sync runs asynchronously; local reads/writes are
  unchanged.
- **No new required dependency.** The `fs` adapter needs nothing; object-store
  and edge adapters are optional.
- **Local-first preserved.** Every machine keeps a complete local store and
  works offline.
- **Preview-first and auditable**, matching the existing maintenance model.

---

## 7. Open questions for maintainer direction

1. Subcommand placement: extend `sync` (`sync store ...`) vs. a new top-level
   verb, given `sync` already means rules sync.
2. Journal representation: derive from existing columns for v1, or add an
   explicit change-log table from the start.
3. Which adapters belong in-tree vs. as optional/companion packages.
4. Whether `serve-http` should be able to act as a sync remote for a user's own
   machines, giving a self-hosted option that still keeps each client local.
5. Merge policy defaults: is row-level LWW acceptable as the v1 default, with
   lifecycle-aware overrides, or is a stricter policy preferred?

This document is intentionally a design proposal. Implementation should follow
the maintainer's answers to the questions above rather than presuppose them.
