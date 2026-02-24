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
import { insertObservation, generateEmbedding, isEmbeddingEnabled } from '../store/orama-store.js';
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
}): Promise<Observation> {
  const id = nextId++;
  const now = new Date().toISOString();

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

  return observation;
}

/**
 * Get an observation by ID.
 */
export function getObservation(id: number): Observation | undefined {
  return observations.find((o) => o.id === id);
}

/**
 * Get all observations for a project.
 */
export function getProjectObservations(projectId: string): Observation[] {
  return observations.filter((o) => o.projectId === projectId);
}

/**
 * Get the total number of stored observations.
 */
export function getObservationCount(): number {
  return observations.length;
}

/**
 * Reload observations into the Orama index.
 * Called during server startup to restore the search index.
 */
export async function reindexObservations(): Promise<number> {
  let count = 0;
  for (const obs of observations) {
    try {
      // Generate embedding during reindex if provider is available
      let embedding: number[] | null = null;
      if (isEmbeddingEnabled()) {
        try {
          const searchableText = [obs.title, obs.narrative, ...obs.facts].join(' ');
          embedding = await generateEmbedding(searchableText);
        } catch {
          // Embedding generation failed for this observation — skip vector, use fulltext
        }
      }

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
