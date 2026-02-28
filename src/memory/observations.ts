/**
 * Observations Manager
 *
 * Manages rich observation records with auto-classification and token counting.
 * Source: claude-mem's observation data model with structured fields.
 *
 * Each observation is stored both in the knowledge graph (as entity observation)
 * and in the Orama search index (for full-text + vector search).
 */

import type { Observation, ObservationType, MemorixDocument } from '../types.js';
import { TOPIC_KEY_FAMILIES } from '../types.js';
import { insertObservation, generateEmbedding, batchGenerateEmbeddings, isEmbeddingEnabled } from '../store/orama-store.js';
import { saveObservationsJson, loadObservationsJson, saveIdCounter, loadIdCounter } from '../store/persistence.js';
import { withFileLock } from '../store/file-lock.js';
import { countTextTokens } from '../compact/token-budget.js';
import { extractEntities, enrichConcepts } from './entity-extractor.js';

/** In-memory observation list (loaded from persistence on init) */
let observations: Observation[] = [];
let nextId = 1;
let projectDir: string | null = null;

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
  };

  observations.push(observation);

  // Generate embedding if provider is available (graceful degradation)
  const searchableText = [input.title, input.narrative, ...(input.facts ?? [])].join(' ');
  const embedding = await generateEmbedding(searchableText);

  // Insert into Orama search index
  const doc: MemorixDocument = {
    id: `obs-${id}`,
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
    ...(embedding ? { embedding } : {}),
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
  if (input.sessionId) existing.sessionId = input.sessionId;

  // Re-index in Orama
  const searchableText = [input.title, input.narrative, ...(input.facts ?? [])].join(' ');
  const embedding = await generateEmbedding(searchableText);

  const doc: MemorixDocument = {
    id: `obs-${existing.id}`,
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
    ...(embedding ? { embedding } : {}),
  };

  // Remove old doc and insert updated one
  try {
    const { removeObservation } = await import('../store/orama-store.js');
    await removeObservation(`obs-${existing.id}`);
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

  return existing;
}

/**
 * Get an observation by ID.
 */
export function getObservation(id: number): Observation | undefined {
  return observations.find((o) => o.id === id);
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

  // Batch-generate all embeddings at once (much faster than individual calls)
  let embeddings: (number[] | null)[] = [];
  if (isEmbeddingEnabled()) {
    try {
      const texts = observations.map(obs =>
        [obs.title, obs.narrative, ...obs.facts].join(' '),
      );
      embeddings = await batchGenerateEmbeddings(texts);
    } catch {
      // Batch embedding failed — fall back to no embeddings
    }
  }

  let count = 0;
  for (let i = 0; i < observations.length; i++) {
    const obs = observations[i];
    try {
      const embedding = embeddings[i] ?? null;
      const doc: MemorixDocument = {
        id: `obs-${obs.id}`,
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
