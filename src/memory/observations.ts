/**
 * Observations Manager
 *
 * Manages rich observation records with auto-classification and token counting.
 * Source: claude-mem's observation data model with structured fields.
 *
 * Each observation is stored both in the knowledge graph (as entity observation)
 * and in the Orama search index (for full-text + vector search).
 */

import type { Observation, ObservationType, ObservationStatus, MemorixDocument, ProgressInfo } from '../types.js';
import { TOPIC_KEY_FAMILIES } from '../types.js';
import {
  insertObservation,
  removeObservation,
  resetDb,
  generateEmbedding,
  batchGenerateEmbeddings,
  getVectorDimensions,
  hydrateIndex,
  isEmbeddingEnabled,
  makeOramaObservationId,
  getLastSearchMode,
  searchObservations,
} from '../store/orama-store.js';
import { getObservationStore, initObservationStore } from '../store/obs-store.js';
import { countTextTokens } from '../compact/token-budget.js';
import { extractEntities, enrichConcepts } from './entity-extractor.js';
import { getEmbeddingProvider, isEmbeddingExplicitlyDisabled } from '../embedding/provider.js';
import { sanitizeCredentials } from './secret-filter.js';

/** In-memory observation list (loaded from persistence on init) */
let observations: Observation[] = [];
let nextId = 1;
let projectDir: string | null = null;
let searchIndexPrepared = false;

// ── Vector-missing tracking ──────────────────────────────────────
// Tracks observation IDs whose async embedding write failed or was skipped.
// Enables observability ("how many memories lack vectors?") and backfill.
const vectorMissingIds = new Set<number>();
let vectorBackfillRunning = false;
let lastVectorBackfill: {
  attempted: number;
  succeeded: number;
  failed: number;
  lastError?: string;
  finishedAt: string;
} | null = null;
const embeddingFailureLogTimestamps = new Map<string, number>();
const EMBEDDING_FAILURE_LOG_COOLDOWN_MS = 30_000;

function logEmbeddingFailureOnce(key: string, message: string): void {
  const now = Date.now();
  const last = embeddingFailureLogTimestamps.get(key) ?? 0;
  if (now - last < EMBEDDING_FAILURE_LOG_COOLDOWN_MS) return;
  embeddingFailureLogTimestamps.set(key, now);
  console.error(message);
}

function normalizeEmbeddingFailure(error: unknown): { key: string; message: string } {
  const raw = error instanceof Error ? error.message : String(error);

  if (
    /embedding api error \(401\)/i.test(raw) ||
    /invalid_api_key/i.test(raw) ||
    /incorrect api key/i.test(raw) ||
    /unauthorized/i.test(raw)
  ) {
    return {
      key: 'embedding-auth',
      message: 'Embedding API returned an invalid API key response; using BM25 until embedding recovers',
    };
  }

  if (/embedding api timeout/i.test(raw)) {
    return {
      key: 'embedding-timeout',
      message: 'Embedding API timed out; using BM25 until embedding recovers',
    };
  }

  return {
    key: raw,
    message: raw,
  };
}

function queueVectorBackfill(projectId: string): void {
  const dataDir = projectDir;
  if (!dataDir) return;
  void import('../runtime/maintenance-jobs.js')
    .then(({ MaintenanceJobStore }) => {
      new MaintenanceJobStore(dataDir).enqueue({
        projectId,
        kind: 'vector-backfill',
        dedupeKey: 'vector-backfill',
        payload: { limit: 12 },
      });
    })
    .catch(() => {
      // Memory writes remain durable even when the optional maintenance queue is unavailable.
    });
}

async function bindObservationCodeRefsBestEffort(observation: Observation): Promise<void> {
  if (!projectDir) return;
  try {
    const { CodeGraphStore } = await import('../codegraph/store.js');
    const { bindObservationToCode } = await import('../codegraph/binder.js');
    const codeStore = new CodeGraphStore();
    await codeStore.init(projectDir);
    await bindObservationToCode(codeStore, observation);
  } catch {
    // Code refs enrich memory retrieval, but memory writes must remain durable without them.
  }
}

function isVectorCompatibleWithCurrentIndex(embedding: number[] | null): boolean {
  if (!embedding) return false;
  const vectorDimensions = getVectorDimensions();
  return vectorDimensions === null || embedding.length === vectorDimensions;
}

/**
 * Initialize the observations manager with a project directory.
 * Auto-initializes the ObservationStore if not already set.
 */
export async function initObservations(dir: string): Promise<void> {
  if (projectDir === dir) return;
  await initObservationStore(dir);
  const store = getObservationStore();
  observations = await store.loadAll();
  nextId = await store.loadIdCounter();
  projectDir = dir;
  searchIndexPrepared = false;
}

/**
 * Check cross-process freshness and reload if another process has written.
 *
 * Call this at every read boundary (MCP tool handler, dashboard API, etc.)
 * BEFORE reading observations[] via getObservation / getAllObservations /
 * getProjectObservations / getObservationCount.
 *
 * When the SQLite storage_generation has advanced beyond our local snapshot:
 *   1. Reloads observations[] from the store
 *   2. Updates nextId from the store
 *   3. Rebuilds the Orama search index (so vector + BM25 search stay in sync)
 *
 * For DegradedBackend this is a no-op (always returns false).
 */
export async function ensureFreshObservations(): Promise<boolean> {
  if (!projectDir) return false;
  try {
    const store = getObservationStore();
    const wasStale = await store.ensureFresh();
    if (wasStale) {
      observations = await store.loadAll();
      nextId = await store.loadIdCounter();
      await reindexObservations();
      searchIndexPrepared = true;
      return true;
    }
  } catch {
    // Best-effort — don't crash the read path on freshness failure
  }
  return false;
}

/**
 * @internal Observation-only freshness gate.
 *
 * Public callers should use `withFreshIndex()` from freshness.ts instead,
 * which also covers mini-skills. This function remains for internal use
 * by the freshness module and legacy test code only.
 */
export async function withFreshObservations<T>(fn: () => T | Promise<T>): Promise<T> {
  await ensureFreshObservations();
  return fn();
}

/**
 * Store a new observation.
 *
 * This is the primary write API — called by the `memorix_store` MCP tool.
 * Automatically:
 *   1. Assigns an incremental ID
 *   2. Counts tokens for the observation content
 *   3. Inserts into Orama for full-text search
 *   4. Persists to disk
 */
export async function storeObservation(input: {
  entityName: string;
  type: ObservationType;
  title: string;
  narrative: string;
  facts?: string[];
  filesModified?: string[];
  concepts?: string[];
  projectId: string;
  topicKey?: string;
  sessionId?: string;
  progress?: ProgressInfo;
  source?: 'agent' | 'git' | 'manual';
  commitHash?: string;
  relatedCommits?: string[];
  relatedEntities?: string[];
  sourceDetail?: 'explicit' | 'hook' | 'git-ingest';
  valueCategory?: 'core' | 'contextual' | 'ephemeral';
  createdByAgentId?: string;
}): Promise<{ observation: Observation; upserted: boolean }> {
  const now = new Date().toISOString();

  // ── Central secret sanitization — strip credential values before any persistence ──
  // Covers all write paths: hooks, git-ingest, CLI, reasoning, compact-on-write, etc.
  input = { ...input, title: sanitizeCredentials(input.title), narrative: sanitizeCredentials(input.narrative), facts: input.facts?.map(sanitizeCredentials) };

  // Sync the local cache before using it as the topicKey fast path. This costs a
  // generation read in the normal case and only reloads when another process wrote.
  await ensureFreshObservations();

  // Topic key upsert: fast-path check in-memory (optimistic, may be stale).
  // A second authoritative check happens inside the file lock to prevent TOCTOU races
  // where two concurrent calls with the same topicKey both miss this check.
  if (input.topicKey) {
    const existing = observations.find(
      o => o.topicKey === input.topicKey && o.projectId === input.projectId,
    );
    if (existing) {
      return { observation: await upsertObservation(existing, input, now), upserted: true };
    }
  }

  // ── Pre-compute enrichments (pure, no side-effects) ──
  const contentForExtraction = [input.title, input.narrative, ...(input.facts ?? [])].join(' ');
  const extracted = extractEntities(contentForExtraction);
  const enrichedConcepts = enrichConcepts(input.concepts ?? [], extracted);
  const userFiles = new Set((input.filesModified ?? []).map((f) => f.toLowerCase()));
  const enrichedFiles = [...(input.filesModified ?? [])];
  for (const f of extracted.files) {
    if (!userFiles.has(f.toLowerCase())) {
      enrichedFiles.push(f);
    }
  }
  const fullText = [
    input.title, input.narrative,
    ...(input.facts ?? []), ...enrichedFiles, ...enrichedConcepts,
  ].join(' ');
  const tokens = countTextTokens(fullText);

  // ── Atomic write: ID allocation + persist + in-memory push inside lock ──
  // This prevents concurrent calls from getting duplicate IDs or silently
  // losing observations due to stale in-memory state.
  let observation!: Observation;
  let doc!: MemorixDocument;

  let upsertedInsideLock = false;
  let reloadCacheAfterCommit = false;
  const assignAndPersist = async () => {
    if (projectDir) {
      const store = getObservationStore();
      const cachedGeneration = store.getGeneration();
      await store.atomic(async (tx) => {
        const transactionGeneration = await tx.getGeneration();
        const diskNextId = await tx.loadIdCounter();

        // A different writer committed after the cache freshness check but before
        // this transaction acquired its lock. Keep the cache coherent after commit.
        reloadCacheAfterCommit = transactionGeneration !== cachedGeneration;

        // ── Atomic topicKey re-check inside lock (prevents TOCTOU race) ──
        // Two concurrent calls with the same topicKey may both pass the fast-path
        // check above, but here we re-check against the authoritative disk state.
        if (input.topicKey) {
          const diskExisting = await tx.findByTopicKey(input.projectId, input.topicKey);
          if (diskExisting) {
            // Switch to upsert path — update the existing observation after this
            // short transaction has released its lock.
            upsertedInsideLock = true;
            observation = diskExisting;
            return; // Exit atomic — upsert will be handled after assignAndPersist
          }
        }

        // Use the higher of in-memory vs disk counter (handles multi-process)
        const id = Math.max(nextId, diskNextId);

        observation = {
          id,
          entityName: input.entityName,
          type: input.type,
          title: input.title,
          narrative: input.narrative,
          facts: input.facts ?? [],
          filesModified: enrichedFiles,
          concepts: enrichedConcepts,
          tokens,
          createdAt: now,
          projectId: input.projectId,
          hasCausalLanguage: extracted.hasCausalLanguage,
          topicKey: input.topicKey,
          revisionCount: 1,
          sessionId: input.sessionId,
          status: 'active',
          progress: input.progress,
          source: input.source,
          commitHash: input.commitHash,
          relatedCommits: input.relatedCommits,
          relatedEntities: input.relatedEntities,
          sourceDetail: input.sourceDetail,
          valueCategory: input.valueCategory,
          createdByAgentId: input.createdByAgentId,
          // Predict the generation that atomic() will commit after this callback.
          // bumpGeneration() runs after fn(tx) returns, incrementing by 1.
          writeGeneration: transactionGeneration + 1,
        };

        await tx.insert(observation);
        await tx.saveIdCounter(id + 1);
      });

      // Phase 4a: confirm writeGeneration matches actual post-bump value
      observation.writeGeneration = store.getGeneration();

      if (upsertedInsideLock || reloadCacheAfterCommit) {
        observations = await store.loadAll();
        nextId = await store.loadIdCounter();
        if (upsertedInsideLock) {
          observation = observations.find((candidate) => candidate.id === observation.id)
            ?? observation;
        }
      } else {
        observations.push(observation);
        nextId = observation.id + 1;
      }

      // If the atomic block detected a topicKey duplicate, skip Orama insert — upsert handles it
      if (upsertedInsideLock) return;
    } else {
      // No projectDir (e.g., tests) — just use in-memory counter
      const id = nextId++;
      observation = {
        id,
        entityName: input.entityName,
        type: input.type,
        title: input.title,
        narrative: input.narrative,
        facts: input.facts ?? [],
        filesModified: enrichedFiles,
        concepts: enrichedConcepts,
        tokens,
        createdAt: now,
        projectId: input.projectId,
        hasCausalLanguage: extracted.hasCausalLanguage,
        topicKey: input.topicKey,
        revisionCount: 1,
        sessionId: input.sessionId,
        status: 'active',
        progress: input.progress,
        source: input.source,
        commitHash: input.commitHash,
        relatedCommits: input.relatedCommits,
        relatedEntities: input.relatedEntities,
        sourceDetail: input.sourceDetail,
        valueCategory: input.valueCategory,
        createdByAgentId: input.createdByAgentId,
        writeGeneration: 0,
      };
      observations.push(observation);
    }

    // Build Orama doc AFTER id is assigned
    doc = {
      id: makeOramaObservationId(input.projectId, observation.id),
      observationId: observation.id,
      entityName: input.entityName,
      type: input.type,
      title: input.title,
      narrative: input.narrative,
      facts: (input.facts ?? []).join('\n'),
      filesModified: enrichedFiles.join('\n'),
      concepts: enrichedConcepts.map(c => c.replace(/-/g, ' ')).join(', '),
      tokens,
      createdAt: now,
      projectId: input.projectId,
      accessCount: 0,
      lastAccessedAt: '',
      status: 'active',
      source: input.source ?? 'agent',
      sourceDetail: input.sourceDetail ?? '',
      valueCategory: input.valueCategory ?? '',
    };

    await insertObservation(doc);
  };

  await assignAndPersist();

  // If the lock discovered a topicKey duplicate on disk, delegate to upsert
  if (upsertedInsideLock) {
    return { observation: await upsertObservation(observation, input, now), upserted: true };
  }

  await bindObservationCodeRefsBestEffort(observation);

  // Generate embedding async (fire-and-forget) — never blocks MCP response
  // Track in vectorMissingIds until embedding is successfully written.
  const obsId = observation.id;
  vectorMissingIds.add(obsId);
  const searchableText = [input.title, input.narrative, ...(input.facts ?? [])].join(' ');
  generateEmbedding(searchableText).then(async (embedding) => {
    if (embedding) {
      if (!isVectorCompatibleWithCurrentIndex(embedding)) {
        const vectorDimensions = getVectorDimensions();
        console.error(
          `[memorix] Embedding dimension mismatch for obs-${obsId}: provider returned ${embedding.length}d, index expects ${vectorDimensions ?? 'unknown'}d (kept in backfill queue)`,
        );
        queueVectorBackfill(input.projectId);
        return;
      }
      try {
        const { removeObservation: removeObs } = await import('../store/orama-store.js');
        await removeObs(makeOramaObservationId(input.projectId, obsId));
        await insertObservation(Object.assign({}, doc, { embedding }));
        vectorMissingIds.delete(obsId);
      } catch {
        console.error(`[memorix] Embedding index update failed for obs-${obsId} (kept in backfill queue)`);
        queueVectorBackfill(input.projectId);
      }
    } else if (isEmbeddingExplicitlyDisabled()) {
      vectorMissingIds.delete(obsId);
    } else {
      queueVectorBackfill(input.projectId);
      logEmbeddingFailureOnce(
        'provider-unavailable',
        `[memorix] Embedding provider unavailable (using BM25 until embedding recovers; queued obs-${obsId} for retry)`,
      );
    }
  }).catch((err) => {
    queueVectorBackfill(input.projectId);
    const failure = normalizeEmbeddingFailure(err);
    logEmbeddingFailureOnce(
      failure.key,
      `[memorix] Async embedding failed (using BM25 until embedding recovers; queued obs-${obsId} for retry): ${failure.message}`,
    );
  });

  return { observation, upserted: false };
}

/**
 * Update an existing observation via topic key upsert.
 * Replaces content but preserves the original ID and createdAt.
 */
async function upsertObservation(
  existing: Observation,
  input: {
    entityName: string;
    type: ObservationType;
    title: string;
    narrative: string;
    facts?: string[];
    filesModified?: string[];
    concepts?: string[];
    projectId: string;
    topicKey?: string;
    sessionId?: string;
    progress?: ProgressInfo;
    sourceDetail?: 'explicit' | 'hook' | 'git-ingest';
    valueCategory?: 'core' | 'contextual' | 'ephemeral';
  },
  now: string,
): Promise<Observation> {
  // ── Central secret sanitization ──
  input = { ...input, title: sanitizeCredentials(input.title), narrative: sanitizeCredentials(input.narrative), facts: input.facts?.map(sanitizeCredentials) };

  // Auto-extract and enrich (same as storeObservation)
  const contentForExtraction = [input.title, input.narrative, ...(input.facts ?? [])].join(' ');
  const extracted = extractEntities(contentForExtraction);
  const enrichedConcepts = enrichConcepts(input.concepts ?? [], extracted);
  const userFiles = new Set((input.filesModified ?? []).map((f) => f.toLowerCase()));
  const enrichedFiles = [...(input.filesModified ?? [])];
  for (const f of extracted.files) {
    if (!userFiles.has(f.toLowerCase())) enrichedFiles.push(f);
  }
  const fullText = [input.title, input.narrative, ...(input.facts ?? []), ...enrichedFiles, ...enrichedConcepts].join(' ');
  const tokens = countTextTokens(fullText);

  // Mark old observation as resolved (superseded by new version)
  // Note: topicKey upsert replaces in-place, so we just bump revision

  // Update in-place
  existing.entityName = input.entityName;
  existing.type = input.type;
  existing.title = input.title;
  existing.narrative = input.narrative;
  existing.facts = input.facts ?? [];
  existing.filesModified = enrichedFiles;
  existing.concepts = enrichedConcepts;
  existing.tokens = tokens;
  existing.updatedAt = now;
  existing.hasCausalLanguage = extracted.hasCausalLanguage;
  existing.revisionCount = (existing.revisionCount ?? 1) + 1;
  existing.status = 'active';
  if (input.sessionId) existing.sessionId = input.sessionId;
  if (input.progress) existing.progress = input.progress;
  if (input.sourceDetail !== undefined) existing.sourceDetail = input.sourceDetail;
  if (input.valueCategory !== undefined) existing.valueCategory = input.valueCategory;

  // Re-index in Orama WITHOUT embedding first (non-blocking)
  const doc: MemorixDocument = {
    id: makeOramaObservationId(existing.projectId, existing.id),
    observationId: existing.id,
    entityName: existing.entityName,
    type: existing.type,
    title: existing.title,
    narrative: existing.narrative,
    facts: existing.facts.join('\n'),
    filesModified: enrichedFiles.join('\n'),
    concepts: enrichedConcepts.map(c => c.replace(/-/g, ' ')).join(', '),
    tokens,
    createdAt: existing.createdAt,
    projectId: existing.projectId,
    accessCount: 0,
    lastAccessedAt: '',
    status: 'active',
    source: existing.source ?? 'agent',
    sourceDetail: existing.sourceDetail ?? '',
    valueCategory: existing.valueCategory ?? '',
  };

  // Remove old doc and insert updated one (with retry for concurrent upsert race)
  const oramaId = makeOramaObservationId(existing.projectId, existing.id);
  try {
    const { removeObservation } = await import('../store/orama-store.js');
    await removeObservation(oramaId);
  } catch { /* may not exist in index */ }
  try {
    await insertObservation(doc);
  } catch {
    // Concurrent upsert may have already re-inserted — retry remove+insert once
    try {
      const { removeObservation: removeObs } = await import('../store/orama-store.js');
      await removeObs(oramaId);
      await insertObservation(doc);
    } catch { /* best effort — file persistence is the source of truth */ }
  }

  // Persist via ObservationStore
  if (projectDir) {
    const store = getObservationStore();
    await store.update(existing);
  }

  await bindObservationCodeRefsBestEffort(existing);

  // Generate embedding async (fire-and-forget) — never blocks MCP response
  const searchableText = [input.title, input.narrative, ...(input.facts ?? [])].join(' ');
  const obsId = existing.id;
  vectorMissingIds.add(obsId);
  generateEmbedding(searchableText).then(async (embedding) => {
    if (embedding) {
      try {
        const { removeObservation: removeObs } = await import('../store/orama-store.js');
        await removeObs(makeOramaObservationId(existing.projectId, obsId));
        await insertObservation(Object.assign({}, doc, { embedding }));
        vectorMissingIds.delete(obsId);
      } catch {
        // Embedding index update failed — observation still persisted without vector
        queueVectorBackfill(existing.projectId);
      }
    } else if (isEmbeddingExplicitlyDisabled()) {
      vectorMissingIds.delete(obsId);
    } else {
      queueVectorBackfill(existing.projectId);
    }
  }).catch((err) => {
    queueVectorBackfill(existing.projectId);
    const failure = normalizeEmbeddingFailure(err);
    logEmbeddingFailureOnce(
      failure.key,
      `[memorix] Async embedding failed (using BM25 until embedding recovers; queued obs-${obsId} for retry): ${failure.message}`,
    );
  });

  return existing;
}

/**
 * Get an observation by ID.
 */
export function getObservation(id: number, projectId?: string): Observation | undefined {
  return observations.find((o) => o.id === id && (projectId ? o.projectId === projectId : true));
}

/**
 * Resolve observations — mark them as resolved (completed/no longer active).
 * This prevents resolved memories from appearing in default search results.
 */
export async function resolveObservations(
  ids: number[],
  status: ObservationStatus = 'resolved',
): Promise<{ resolved: number[]; notFound: number[] }> {
  const resolved: number[] = [];
  const notFound: number[] = [];
  const changed: Observation[] = [];
  const now = new Date().toISOString();

  for (const id of ids) {
    const obs = observations.find(o => o.id === id);
    if (!obs) {
      notFound.push(id);
      continue;
    }
    obs.status = status;
    obs.updatedAt = now;
    if (obs.progress) {
      obs.progress.status = status === 'resolved' ? 'completed' : obs.progress.status;
    }
    resolved.push(id);
    changed.push(obs);

    // Update Orama index (without blocking on embedding)
    try {
      const { removeObservation: removeObs } = await import('../store/orama-store.js');
      await removeObs(makeOramaObservationId(obs.projectId, id));
      const doc: MemorixDocument = {
        id: makeOramaObservationId(obs.projectId, obs.id),
        observationId: obs.id,
        entityName: obs.entityName,
        type: obs.type,
        title: obs.title,
        narrative: obs.narrative,
        facts: obs.facts.join('\n'),
        filesModified: obs.filesModified.join('\n'),
        concepts: obs.concepts.map(c => c.replace(/-/g, ' ')).join(', '),
        tokens: obs.tokens,
        createdAt: obs.createdAt,
        projectId: obs.projectId,
        accessCount: 0,
        lastAccessedAt: '',
        status,
        source: obs.source ?? 'agent',
        sourceDetail: obs.sourceDetail ?? '',
        valueCategory: obs.valueCategory ?? '',
      };
      await insertObservation(doc);
      // Async embedding update (fire-and-forget)
      const obsId = obs.id;
      generateEmbedding([obs.title, obs.narrative, ...obs.facts].join(' ')).then(async (embedding) => {
        if (embedding) {
          try {
            await removeObs(`obs-${obsId}`);
            await insertObservation(Object.assign({}, doc, { embedding }));
          } catch { /* best effort */ }
        }
      }).catch(() => {});
    } catch { /* best effort */ }
  }

  // Persist via ObservationStore
  if (projectDir && resolved.length > 0) {
    const store = getObservationStore();
    await store.atomic(async (tx) => {
      await Promise.all(changed.map((observation) => tx.update(observation)));
    });
  }

  return { resolved, notFound };
}

/**
 * Get all observations for a project.
 * Supports alias expansion: if projectIds is an array, matches any of them.
 */
export function getProjectObservations(projectId: string | string[]): Observation[] {
  if (Array.isArray(projectId)) {
    const idSet = new Set(projectId);
    return observations.filter((o) => idSet.has(o.projectId));
  }
  return observations.filter((o) => o.projectId === projectId);
}

/**
 * Migrate observations from non-canonical project IDs to the canonical ID.
 *
 * Called once during server startup after alias registration.
 * Rewrites in-memory observations and persists changes to disk.
 *
 * @param aliasIds - All known alias IDs for this project (including canonical)
 * @param canonicalId - The canonical project ID to normalize to
 * @returns Number of observations migrated
 */
export async function migrateProjectIds(
  aliasIds: string[],
  canonicalId: string,
): Promise<number> {
  const nonCanonical = new Set(aliasIds.filter(id => id !== canonicalId));
  if (nonCanonical.size === 0) return 0;

  let migrated = 0;
  const changed: Observation[] = [];
  for (const obs of observations) {
    if (nonCanonical.has(obs.projectId)) {
      obs.projectId = canonicalId;
      migrated++;
      changed.push(obs);
    }
  }

  if (migrated > 0 && projectDir) {
    const store = getObservationStore();
    await store.atomic(async (tx) => {
      await Promise.all(changed.map((observation) => tx.update(observation)));
    });
  }

  return migrated;
}

/**
 * Get all observations (in-memory copy).
 * Used by timeline and retention to avoid unreliable Orama empty-term queries.
 */
export function getAllObservations(): Observation[] {
  return [...observations];
}

/**
 * Get the total number of stored observations.
 */
export function getObservationCount(): number {
  return observations.length;
}

/**
 * Suggest a stable topic key from type + title.
 * Uses family heuristics (architecture/*, bug/*, decision/*, etc.)
 * Inspired by Engram's mem_suggest_topic_key.
 */
export function suggestTopicKey(type: string, title: string): string {
  // Determine family from type
  let family = 'general';
  const typeLower = type.toLowerCase();
  for (const [fam, keywords] of Object.entries(TOPIC_KEY_FAMILIES)) {
    if (keywords.some(k => typeLower.includes(k))) {
      family = fam;
      break;
    }
  }

  // Normalize title to slug
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff\s-]/g, '') // keep letters, digits, CJK, spaces, hyphens
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 60);

  if (!slug) return '';
  return `${family}/${slug}`;
}

/**
 * Reload observations into the Orama index with full corpus embeddings.
 * Intended for explicit heavy rebuilds, not normal MCP startup.
 *
 * Optimization: uses batch embedding (ONNX processes 64 texts at a time)
 * instead of individual embed calls. This reduces startup CPU from minutes
 * to seconds for large observation sets (500+).
 */
export async function reindexObservations(): Promise<number> {
  if (observations.length === 0) return 0;

  // Reset the Orama index to ensure clean reindex (idempotent)
  await resetDb();
  searchIndexPrepared = false;
  vectorMissingIds.clear();

  // Batch-generate all embeddings at once (much faster than individual calls)
  let embeddings: (number[] | null)[] = observations.map(() => null);
  const provider = await getEmbeddingProvider();
  const canBatchEmbedAtStartup = provider !== null && !provider.name.startsWith('api-');

  if (provider && !canBatchEmbedAtStartup) {
    console.error('[memorix] Startup reindex: skipping synchronous API embeddings; background backfill will hydrate vectors');
  }

  if (canBatchEmbedAtStartup) {
    try {
      const texts = observations.map(obs =>
        [obs.title, obs.narrative, ...obs.facts].join(' '),
      );
      embeddings = await batchGenerateEmbeddings(texts);
      // Batch embedding failed — fall back to no embeddings
    } catch {
      // Batch embedding failed; fall back to no embeddings.
    }
  }

  let count = 0;
  for (let i = 0; i < observations.length; i++) {
    const obs = observations[i];
    try {
      const embedding = embeddings[i] ?? null;
      const compatibleEmbedding = isVectorCompatibleWithCurrentIndex(embedding) ? embedding : null;
      if (embedding && !compatibleEmbedding) {
        const vectorDimensions = getVectorDimensions();
        console.error(
          `[memorix] Startup reindex embedding mismatch for obs-${obs.id}: provider returned ${embedding.length}d, index expects ${vectorDimensions ?? 'unknown'}d (queued for backfill)`,
        );
      }
      const docId = makeOramaObservationId(obs.projectId, obs.id);
      const doc: MemorixDocument = {
        id: docId,
        observationId: obs.id,
        entityName: obs.entityName,
        type: obs.type,
        title: obs.title,
        narrative: obs.narrative,
        facts: obs.facts.join('\n'),
        filesModified: obs.filesModified.join('\n'),
        concepts: obs.concepts.map((c: string) => c.replace(/-/g, ' ')).join(', '),
        tokens: obs.tokens,
        createdAt: obs.createdAt,
        projectId: obs.projectId,
        accessCount: 0,
        lastAccessedAt: '',
        status: obs.status ?? 'active',
        source: obs.source ?? 'agent',
        sourceDetail: obs.sourceDetail ?? '',
        valueCategory: obs.valueCategory ?? '',
        ...(compatibleEmbedding ? { embedding: compatibleEmbedding } : {}),
      };
      await insertObservation(doc);
      if (!compatibleEmbedding && !isEmbeddingExplicitlyDisabled()) {
        vectorMissingIds.add(obs.id);
      }
      count++;
    } catch (err) {
      console.error(`[memorix] Failed to reindex observation #${obs.id}: ${err}`);
    }
  }
  searchIndexPrepared = true;
  return count;
}

/**
 * Prepare the search index for startup and hot-reload without blocking on
 * corpus-wide embedding generation.
 *
 * This hydrates the lexical/BM25 index immediately so MCP availability is not
 * coupled to embedding provider throughput. Missing vectors are queued for the
 * existing background backfill cycle.
 */
export async function prepareSearchIndex(): Promise<number> {
  if (searchIndexPrepared) return 0;

  const count = await hydrateIndex(observations as unknown as any[]);
  if (count === 0) {
    searchIndexPrepared = true;
    return 0;
  }

  vectorMissingIds.clear();
  if (isEmbeddingEnabled()) {
    for (const obs of observations) {
      // Queue ALL statuses for vector backfill — status filtering happens at query time,
      // not at index time. Omitting non-active observations here would permanently
      // exclude resolved/archived memories from hybrid search after restart.
      vectorMissingIds.add(obs.id);
    }
  }

  searchIndexPrepared = true;
  return count;
}

// ── Vector-missing observability & backfill ─────────────────────────

/**
 * Get the current set of observation IDs that are missing vector embeddings.
 * Useful for dashboards, health checks, and monitoring search quality degradation.
 */
export function getVectorMissingIds(projectId?: string): number[] {
  if (!projectId) return [...vectorMissingIds];
  const observationById = new Map(observations.map((observation) => [observation.id, observation]));
  return [...vectorMissingIds].filter((id) => observationById.get(id)?.projectId === projectId);
}

/**
 * Get a summary of vector embedding status.
 * Returns total observations, how many have vectors, and how many are missing.
 */
export function getVectorStatus(projectId?: string): {
  total: number;
  missing: number;
  missingIds: number[];
  backfillRunning: boolean;
  lastBackfill: typeof lastVectorBackfill;
} {
  const missingIds = getVectorMissingIds(projectId);
  return {
    total: projectId ? observations.filter((observation) => observation.projectId === projectId).length : observations.length,
    missing: missingIds.length,
    missingIds,
    backfillRunning: vectorBackfillRunning,
    lastBackfill: lastVectorBackfill,
  };
}

/**
 * Return search-index state from the same module graph that owns the hydrated
 * Orama instance. This avoids split singleton state when tools load Memorix
 * TypeScript sources through runtime loaders.
 */
export function getSearchIndexStatus(projectId?: string): {
  embeddingEnabled: boolean;
  vectorDimensions: number | null;
  lastSearchMode: string;
  prepared: boolean;
} {
  return {
    embeddingEnabled: isEmbeddingEnabled(),
    vectorDimensions: getVectorDimensions(),
    lastSearchMode: getLastSearchMode(projectId),
    prepared: searchIndexPrepared,
  };
}

/**
 * Observability-only semantic probe. It intentionally disables access tracking
 * so status checks do not mutate retention/access metadata.
 */
export async function probeSearchIndex(projectId: string): Promise<string> {
  await searchObservations({
    query: 'semantic memory retrieval status',
    projectId,
    limit: 1,
    status: 'all',
    trackAccess: false,
  });
  return getLastSearchMode(projectId);
}

/**
 * Attempt to backfill missing vector embeddings.
 * Re-generates embeddings for observations in vectorMissingIds.
 * Returns the number successfully backfilled.
 *
 * Safe to call concurrently — only one backfill runs at a time.
 */
export async function backfillVectorEmbeddings(options: {
  projectId?: string;
  limit?: number;
} = {}): Promise<{
  attempted: number;
  succeeded: number;
  failed: number;
}> {
  if (vectorBackfillRunning) {
    return { attempted: 0, succeeded: 0, failed: 0 };
  }
  vectorBackfillRunning = true;

  const observationById = new Map(observations.map((observation) => [observation.id, observation]));
  const limit = Number.isFinite(options.limit)
    ? Math.max(1, Math.floor(options.limit!))
    : Number.POSITIVE_INFINITY;
  const ids = [...vectorMissingIds]
    .filter((id) => !options.projectId || observationById.get(id)?.projectId === options.projectId)
    .slice(0, limit);
  let succeeded = 0;
  let failed = 0;
  let lastFailure: string | undefined;

  try {
    for (const id of ids) {
      const obs = observationById.get(id);
      if (!obs) {
        vectorMissingIds.delete(id);
        continue;
      }

      const text = [obs.title, obs.narrative, ...obs.facts].join(' ');
      try {
        const embedding = await generateEmbedding(text);
        if (embedding) {
          if (!isVectorCompatibleWithCurrentIndex(embedding)) {
            const vectorDimensions = getVectorDimensions();
            console.error(
              `[memorix] Backfill embedding mismatch for obs-${id}: provider returned ${embedding.length}d, index expects ${vectorDimensions ?? 'unknown'}d (kept in queue)`,
            );
            lastFailure = `dimension mismatch: provider returned ${embedding.length}d, index expects ${vectorDimensions ?? 'unknown'}d`;
            failed++;
            continue;
          }
          const oramaId = makeOramaObservationId(obs.projectId, obs.id);
          try {
            const { removeObservation: removeObs } = await import('../store/orama-store.js');
            await removeObs(oramaId);
          } catch { /* may not exist */ }
          const doc: MemorixDocument = {
            id: oramaId,
            observationId: obs.id,
            entityName: obs.entityName,
            type: obs.type,
            title: obs.title,
            narrative: obs.narrative,
            facts: obs.facts.join('\n'),
            filesModified: obs.filesModified.join('\n'),
            concepts: obs.concepts.map(c => c.replace(/-/g, ' ')).join(', '),
            tokens: obs.tokens,
            createdAt: obs.createdAt,
            projectId: obs.projectId,
            accessCount: 0,
            lastAccessedAt: '',
            status: obs.status ?? 'active',
            source: obs.source ?? 'agent',
            sourceDetail: obs.sourceDetail ?? '',
            valueCategory: obs.valueCategory ?? '',
            embedding,
          };
          await insertObservation(doc);
          vectorMissingIds.delete(id);
          succeeded++;
        } else if (isEmbeddingExplicitlyDisabled()) {
          // Embedding explicitly off — nothing to backfill from
          vectorMissingIds.delete(id);
        } else {
          // Provider temporarily unavailable — keep in queue for next backfill cycle
          lastFailure = 'embedding provider unavailable';
          failed++;
        }
      } catch (err) {
        lastFailure = err instanceof Error ? err.message : String(err);
        failed++;
      }
    }
  } finally {
    vectorBackfillRunning = false;
    lastVectorBackfill = {
      attempted: ids.length,
      succeeded,
      failed,
      ...(lastFailure ? { lastError: lastFailure } : {}),
      finishedAt: new Date().toISOString(),
    };
  }

  return { attempted: ids.length, succeeded, failed };
}
