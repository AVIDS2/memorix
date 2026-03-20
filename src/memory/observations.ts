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
  makeOramaObservationId,
} from '../store/orama-store.js';
import { saveObservationsJson, loadObservationsJson, saveIdCounter, loadIdCounter } from '../store/persistence.js';
import { withFileLock } from '../store/file-lock.js';
import { countTextTokens } from '../compact/token-budget.js';
import { extractEntities, enrichConcepts } from './entity-extractor.js';
import { isEmbeddingExplicitlyDisabled } from '../embedding/provider.js';

/** In-memory observation list (loaded from persistence on init) */
let observations: Observation[] = [];
let nextId = 1;
let projectDir: string | null = null;

// ── Vector-missing tracking ──────────────────────────────────────
// Tracks observation IDs whose async embedding write failed or was skipped.
// Enables observability ("how many memories lack vectors?") and backfill.
const vectorMissingIds = new Set<number>();
let vectorBackfillRunning = false;

/**
 * Initialize the observations manager with a project directory.
 */
export async function initObservations(dir: string): Promise<void> {
  projectDir = dir;
  const loaded = await loadObservationsJson(dir);
  observations = loaded as Observation[];
  nextId = await loadIdCounter(dir);
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
}): Promise<{ observation: Observation; upserted: boolean }> {
  const now = new Date().toISOString();

  // Topic key upsert: check if an observation with the same topicKey+projectId exists
  if (input.topicKey) {
    const existing = observations.find(
      o => o.topicKey === input.topicKey && o.projectId === input.projectId,
    );
    if (existing) {
      return { observation: await upsertObservation(existing, input, now), upserted: true };
    }
  }

  const id = nextId++;

  // Auto-extract entities from narrative (inspired by MemCP RegexEntityExtractor)
  const contentForExtraction = [input.title, input.narrative, ...(input.facts ?? [])].join(' ');
  const extracted = extractEntities(contentForExtraction);

  // Auto-enrich concepts with extracted entities
  const enrichedConcepts = enrichConcepts(input.concepts ?? [], extracted);

  // Auto-enrich filesModified with extracted file paths
  const userFiles = new Set((input.filesModified ?? []).map((f) => f.toLowerCase()));
  const enrichedFiles = [...(input.filesModified ?? [])];
  for (const f of extracted.files) {
    if (!userFiles.has(f.toLowerCase())) {
      enrichedFiles.push(f);
    }
  }

  // Count tokens for the full observation content
  const fullText = [
    input.title,
    input.narrative,
    ...(input.facts ?? []),
    ...enrichedFiles,
    ...enrichedConcepts,
  ].join(' ');
  const tokens = countTextTokens(fullText);

  const observation: Observation = {
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
  };

  observations.push(observation);

  // Insert into Orama search index WITHOUT embedding first (non-blocking)
  const doc: MemorixDocument = {
    id: makeOramaObservationId(input.projectId, id),
    observationId: id,
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
  };

  await insertObservation(doc);

  // Persist to disk with file lock (cross-process safe)
  if (projectDir) {
    await withFileLock(projectDir, async () => {
      // Re-read from disk to merge changes from other processes
      const diskObs = await loadObservationsJson(projectDir!) as Observation[];
      const diskNextId = await loadIdCounter(projectDir!);

      // Merge: add our new observation if not already present
      const existingIds = new Set(diskObs.map(o => o.id));
      if (!existingIds.has(observation.id)) {
        diskObs.push(observation);
      }

      // Use the higher nextId (ours or disk's)
      const mergedNextId = Math.max(nextId, diskNextId);

      // Update in-memory state with merged data
      observations = diskObs;
      nextId = mergedNextId;

      await saveObservationsJson(projectDir!, observations);
      await saveIdCounter(projectDir!, nextId);
    });
  }

  // Generate embedding async (fire-and-forget) — never blocks MCP response
  // Track in vectorMissingIds until embedding is successfully written.
  vectorMissingIds.add(id);
  const searchableText = [input.title, input.narrative, ...(input.facts ?? [])].join(' ');
  generateEmbedding(searchableText).then(async (embedding) => {
    if (embedding) {
      try {
        const { removeObservation: removeObs } = await import('../store/orama-store.js');
        await removeObs(makeOramaObservationId(input.projectId, id));
        await insertObservation(Object.assign({}, doc, { embedding }));
        vectorMissingIds.delete(id);
      } catch {
        // Embedding index update failed — observation still persisted without vector
        console.error(`[memorix] Embedding index update failed for obs-${id} (kept in backfill queue)`);
      }
    } else if (isEmbeddingExplicitlyDisabled()) {
      // Embedding is explicitly turned off — no provider will ever be available,
      // so remove from the missing set (nothing to backfill from).
      vectorMissingIds.delete(id);
    } else {
      // Provider returned null due to init failure / API error / missing deps.
      // Keep in backfill queue so a future retry can generate the embedding.
      console.error(`[memorix] Embedding provider unavailable for obs-${id} (kept in backfill queue for retry)`);
    }
  }).catch((err) => {
    console.error(`[memorix] Async embedding failed for obs-${id}: ${err instanceof Error ? err.message : err}`);
    // Keep in vectorMissingIds for backfill retry
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
  },
  now: string,
): Promise<Observation> {
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
  };

  // Remove old doc and insert updated one
  try {
    const { removeObservation } = await import('../store/orama-store.js');
    await removeObservation(makeOramaObservationId(existing.projectId, existing.id));
  } catch { /* may not exist in index */ }
  await insertObservation(doc);

  // Persist
  if (projectDir) {
    await withFileLock(projectDir, async () => {
      const diskObs = await loadObservationsJson(projectDir!) as Observation[];
      const idx = diskObs.findIndex(o => o.id === existing.id);
      if (idx >= 0) {
        diskObs[idx] = existing;
      } else {
        diskObs.push(existing);
      }
      observations = diskObs;
      await saveObservationsJson(projectDir!, observations);
    });
  }

  // Generate embedding async (fire-and-forget) — never blocks MCP response
  const searchableText = [input.title, input.narrative, ...(input.facts ?? [])].join(' ');
  const obsId = existing.id;
  generateEmbedding(searchableText).then(async (embedding) => {
    if (embedding) {
      try {
        const { removeObservation: removeObs } = await import('../store/orama-store.js');
        await removeObs(makeOramaObservationId(existing.projectId, obsId));
        await insertObservation(Object.assign({}, doc, { embedding }));
      } catch {
        // Embedding index update failed — observation still persisted without vector
      }
    }
  }).catch((err) => {
    console.error(`[memorix] Async embedding failed for obs-${obsId}: ${err instanceof Error ? err.message : err}`);
  });

  return existing;
}

/**
 * Get an observation by ID.
 */
export function getObservation(id: number): Observation | undefined {
  return observations.find((o) => o.id === id);
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

  // Persist
  if (projectDir && resolved.length > 0) {
    await withFileLock(projectDir, async () => {
      await saveObservationsJson(projectDir!, observations);
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
  for (const obs of observations) {
    if (nonCanonical.has(obs.projectId)) {
      obs.projectId = canonicalId;
      migrated++;
    }
  }

  if (migrated > 0 && projectDir) {
    await withFileLock(projectDir, async () => {
      await saveObservationsJson(projectDir!, observations);
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
 * Reload observations into the Orama index.
 * Called during server startup to restore the search index.
 *
 * Optimization: uses batch embedding (ONNX processes 64 texts at a time)
 * instead of individual embed calls. This reduces startup CPU from minutes
 * to seconds for large observation sets (500+).
 */
export async function reindexObservations(): Promise<number> {
  if (observations.length === 0) return 0;

  // Reset the Orama index to ensure clean reindex (idempotent)
  await resetDb();

  // Batch-generate all embeddings at once (much faster than individual calls)
  let embeddings: (number[] | null)[] = [];
  try {
      const texts = observations.map(obs =>
        [obs.title, obs.narrative, ...obs.facts].join(' '),
      );
      embeddings = await batchGenerateEmbeddings(texts);
      // Batch embedding failed — fall back to no embeddings
  } catch {
    // Batch embedding failed; fall back to no embeddings.
  }

  let count = 0;
  for (let i = 0; i < observations.length; i++) {
    const obs = observations[i];
    try {
      const embedding = embeddings[i] ?? null;
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
        ...(embedding ? { embedding } : {}),
      };
      await insertObservation(doc);
      count++;
    } catch (err) {
      console.error(`[memorix] Failed to reindex observation #${obs.id}: ${err}`);
    }
  }
  return count;
}

// ── Vector-missing observability & backfill ─────────────────────────

/**
 * Get the current set of observation IDs that are missing vector embeddings.
 * Useful for dashboards, health checks, and monitoring search quality degradation.
 */
export function getVectorMissingIds(): number[] {
  return [...vectorMissingIds];
}

/**
 * Get a summary of vector embedding status.
 * Returns total observations, how many have vectors, and how many are missing.
 */
export function getVectorStatus(): {
  total: number;
  missing: number;
  missingIds: number[];
  backfillRunning: boolean;
} {
  return {
    total: observations.length,
    missing: vectorMissingIds.size,
    missingIds: [...vectorMissingIds],
    backfillRunning: vectorBackfillRunning,
  };
}

/**
 * Attempt to backfill missing vector embeddings.
 * Re-generates embeddings for observations in vectorMissingIds.
 * Returns the number successfully backfilled.
 *
 * Safe to call concurrently — only one backfill runs at a time.
 */
export async function backfillVectorEmbeddings(): Promise<{
  attempted: number;
  succeeded: number;
  failed: number;
}> {
  if (vectorBackfillRunning) {
    return { attempted: 0, succeeded: 0, failed: 0 };
  }
  vectorBackfillRunning = true;

  const ids = [...vectorMissingIds];
  let succeeded = 0;
  let failed = 0;

  try {
    for (const id of ids) {
      const obs = observations.find(o => o.id === id);
      if (!obs) {
        vectorMissingIds.delete(id);
        continue;
      }

      const text = [obs.title, obs.narrative, ...obs.facts].join(' ');
      try {
        const embedding = await generateEmbedding(text);
        if (embedding) {
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
          failed++;
        }
      } catch {
        failed++;
      }
    }
  } finally {
    vectorBackfillRunning = false;
  }

  return { attempted: ids.length, succeeded, failed };
}
