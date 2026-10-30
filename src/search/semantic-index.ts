import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { EmbeddingProvider } from '../embedding/provider.js';

export interface SemanticIndexProfile {
  key: string;
  provider: string;
  dimensions: number;
}

export interface SemanticVectorRecord {
  observationId: number;
  projectId: string;
  status: string;
  visibility?: string;
  vector: number[];
}

export interface SemanticVectorHit {
  observationId: number;
  projectId: string;
  status?: string;
  visibility?: string;
  distance: number;
}

const SEMANTIC_INDEX_DIR = 'semantic-index';
const TABLE_PREFIX = 'observations_';
const DEFAULT_INDEX_THRESHOLD = 10_000;
const MAX_INDEX_PARTITIONS = 32;
const DEFAULT_WRITE_BATCH_SIZE = 100;
const DEFAULT_WRITE_FLUSH_MS = 50;
const DEFAULT_OPTIMIZE_EVERY = 20;
const DEFAULT_VERSION_RETENTION_MS = 24 * 60 * 60 * 1000;

type SemanticIndexState = {
  key: string;
  dataDir: string;
  profile: SemanticIndexProfile;
  connection: any;
  table: any | null;
};

const statePromises = new Map<string, Promise<SemanticIndexState | null>>();
const writeQueues = new Map<string, Promise<void>>();
const indexBuilds = new Map<string, Promise<boolean>>();
const mutationCounts = new Map<string, number>();
type PendingVectorBatch = {
  dataDir: string;
  profile: SemanticIndexProfile;
  records: Map<string, SemanticVectorRecord>;
  waiters: Array<{ resolve: () => void; reject: (error: unknown) => void }>;
  timer?: ReturnType<typeof setTimeout>;
};
const pendingVectorBatches = new Map<string, PendingVectorBatch>();
let availability: boolean | undefined;
const requireFromHere = createRequire(import.meta.url);

export function createSemanticIndexProfile(provider: Pick<EmbeddingProvider, 'name' | 'dimensions'>): SemanticIndexProfile {
  return {
    key: `${provider.name}:${provider.dimensions}`,
    provider: provider.name,
    dimensions: provider.dimensions,
  };
}

function stateKey(dataDir: string, profile: SemanticIndexProfile): string {
  return `${path.resolve(dataDir)}::${profile.key}`;
}

function tableName(profile: SemanticIndexProfile): string {
  const digest = createHash('sha256').update(profile.key).digest('hex').slice(0, 20);
  return `${TABLE_PREFIX}${digest}`;
}

function indexRoot(dataDir: string): string {
  return path.join(dataDir, SEMANTIC_INDEX_DIR);
}

async function loadLanceDb(): Promise<any | null> {
  if (availability === false) return null;
  try {
    // Keep the native optional dependency out of the main tsup bundle. The
    // package is resolved only on the machine that actually opts into the
    // persistent semantic accelerator.
    let load: NodeRequire;
    try {
      load = requireFromHere;
      load.resolve('@lancedb/lancedb');
    } catch {
      // Vite/Vitest virtual modules have no normal file URL. Resolve from the
      // package cwd as a test/runtime fallback.
      load = createRequire(path.join(process.cwd(), 'package.json'));
      load.resolve('@lancedb/lancedb');
    }
    // Use the runtime require handle rather than a static import: LanceDB ships
    // platform-specific native files and must remain outside the main bundle.
    const module = load('@lancedb/lancedb');
    availability = true;
    return module;
  } catch (error) {
    availability = false;
    if (process.env.MEMORIX_SEMANTIC_INDEX === 'lancedb') {
      console.warn(
        `[memorix] LanceDB semantic index unavailable; falling back to Orama: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return null;
  }
}

export async function isSemanticIndexAvailable(): Promise<boolean> {
  return (await loadLanceDb()) !== null;
}

function semanticIndexEnabled(): boolean {
  return process.env.MEMORIX_SEMANTIC_INDEX !== 'off' && process.env.MEMORIX_SEMANTIC_INDEX !== 'orama';
}

async function openState(dataDir: string, profile: SemanticIndexProfile): Promise<SemanticIndexState | null> {
  if (!semanticIndexEnabled()) return null;
  const lance = await loadLanceDb();
  if (!lance) return null;

  const connection = await lance.connect(indexRoot(dataDir));
  const names = typeof connection.tableNames === 'function'
    ? await connection.tableNames()
    : (await connection.listTables()).tables;
  const name = tableName(profile);
  const table = names.includes(name) ? await connection.openTable(name) : null;
  return { key: stateKey(dataDir, profile), dataDir, profile, connection, table };
}

function toLanceRow(record: SemanticVectorRecord): Record<string, unknown> {
  return {
    observation_id: record.observationId,
    project_id: record.projectId,
    status: record.status,
    visibility: record.visibility ?? 'project',
    vector: record.vector,
  };
}

async function getState(
  dataDir: string,
  profile: SemanticIndexProfile,
  seed?: SemanticVectorRecord[],
): Promise<SemanticIndexState | null> {
  const key = stateKey(dataDir, profile);
  let statePromise = statePromises.get(key);
  if (!statePromise) {
    statePromise = openState(dataDir, profile);
    statePromises.set(key, statePromise);
  }
  const state = await statePromise;
  if (!state || state.table || !seed || seed.length === 0) return state;

  // A write queue serializes table creation, so this branch is only reached by
  // the first writer for a profile.
  const lance = await loadLanceDb();
  if (!lance) return null;
  try {
    state.table = await state.connection.createTable(tableName(profile), seed.map(toLanceRow));
  } catch {
    // Another process may have created it between tableNames() and createTable().
    state.table = await state.connection.openTable(tableName(profile));
  }
  return state;
}

function escapeSqlString(value: string): string {
  return value.replace(/'/g, "''");
}

function projectPredicate(projectIds?: string | string[]): string | null {
  if (!projectIds) return null;
  const values = (Array.isArray(projectIds) ? projectIds : [projectIds]).filter(Boolean);
  if (values.length === 0) return '1 = 0';
  return values.length === 1
    ? `project_id = '${escapeSqlString(values[0])}'`
    : `project_id IN (${values.map((value) => `'${escapeSqlString(value)}'`).join(', ')})`;
}

function queueOperation(key: string, operation: () => Promise<void>): Promise<void> {
  const previous = writeQueues.get(key) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(operation);
  writeQueues.set(key, run.catch(() => undefined));
  return run;
}

function positiveEnvInt(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function semanticWriteBatchSize(): number {
  return positiveEnvInt('MEMORIX_SEMANTIC_WRITE_BATCH_SIZE', DEFAULT_WRITE_BATCH_SIZE);
}

function semanticWriteFlushMs(): number {
  return positiveEnvInt('MEMORIX_SEMANTIC_WRITE_FLUSH_MS', DEFAULT_WRITE_FLUSH_MS);
}

function semanticOptimizeEvery(): number {
  return positiveEnvInt('MEMORIX_SEMANTIC_OPTIMIZE_EVERY', DEFAULT_OPTIMIZE_EVERY);
}

function semanticVersionRetentionMs(): number {
  return positiveEnvInt('MEMORIX_SEMANTIC_VERSION_RETENTION_MS', DEFAULT_VERSION_RETENTION_MS);
}

async function optimizeState(state: SemanticIndexState): Promise<void> {
  if (!state.table || typeof state.table.optimize !== 'function') return;
  await state.table.optimize({
    cleanupOlderThan: new Date(Date.now() - semanticVersionRetentionMs()),
    deleteUnverified: false,
  });
}

async function mergeVectors(dataDir: string, profile: SemanticIndexProfile, records: SemanticVectorRecord[]): Promise<void> {
  if (records.length === 0) return;
  const state = await getState(dataDir, profile, records);
  if (!state?.table) return;
  const rows = records.map(toLanceRow);
  await state.table
    .mergeInsert('observation_id')
    .whenMatchedUpdateAll()
    .whenNotMatchedInsertAll()
    .execute(rows);
  const key = stateKey(dataDir, profile);
  const mutationCount = (mutationCounts.get(key) ?? 0) + 1;
  if (mutationCount >= semanticOptimizeEvery()) {
    mutationCounts.set(key, 0);
    await optimizeState(state).catch(() => undefined);
  } else {
    mutationCounts.set(key, mutationCount);
  }
  // Build the ANN index asynchronously once the table is large enough. The
  // current write remains cheap and the unindexed tail stays queryable while
  // LanceDB trains the derived HNSW/SQ index.
  void ensureSemanticIndex(dataDir, profile);
}

function flushPendingVectorBatch(key: string): Promise<void> {
  const pending = pendingVectorBatches.get(key);
  if (!pending) return Promise.resolve();
  if (pending.timer) clearTimeout(pending.timer);
  pendingVectorBatches.delete(key);
  const records = [...pending.records.values()];
  const waiters = pending.waiters.splice(0);
  return queueOperation(key, () => mergeVectors(pending.dataDir, pending.profile, records))
    .then(() => waiters.forEach((waiter) => waiter.resolve()))
    .catch((error) => {
      waiters.forEach((waiter) => waiter.reject(error));
    });
}

export function upsertSemanticVector(
  dataDir: string,
  profile: SemanticIndexProfile,
  record: SemanticVectorRecord,
): Promise<void> {
  const key = stateKey(dataDir, profile);
  let pending = pendingVectorBatches.get(key);
  if (!pending) {
    pending = { dataDir, profile, records: new Map(), waiters: [] };
    pendingVectorBatches.set(key, pending);
  }
  pending.records.set(`${record.projectId}:${record.observationId}`, record);
  const promise = new Promise<void>((resolve, reject) => pending!.waiters.push({ resolve, reject }));
  if (pending.records.size >= semanticWriteBatchSize()) void flushPendingVectorBatch(key);
  else if (!pending.timer) pending.timer = setTimeout(() => { void flushPendingVectorBatch(key); }, semanticWriteFlushMs());
  return promise;
}

export function upsertSemanticVectors(
  dataDir: string,
  profile: SemanticIndexProfile,
  records: SemanticVectorRecord[],
): Promise<void> {
  return queueOperation(stateKey(dataDir, profile), () => mergeVectors(dataDir, profile, records));
}

/** Return persisted vector IDs without loading vector payloads. */
export async function listSemanticVectorIds(
  dataDir: string,
  profile: SemanticIndexProfile,
): Promise<Set<number> | null> {
  const state = await getState(dataDir, profile);
  if (!state?.table) return null;
  const rows = await state.table.query().select(['observation_id']).toArray();
  return new Set(rows.map((row: any) => Number(row.observation_id)).filter(Number.isSafeInteger));
}

/** Read small, operator-safe table statistics without exposing vector data. */
export async function getSemanticIndexStats(
  dataDir: string,
  profile: SemanticIndexProfile,
): Promise<{ rowCount: number; version: number } | null> {
  const state = await getState(dataDir, profile);
  if (!state?.table) return null;
  return {
    rowCount: await state.table.countRows(),
    version: typeof state.table.version === 'function' ? await state.table.version() : 0,
  };
}

/** Compact Lance fragments and prune old manifests for a semantic profile. */
export function optimizeSemanticIndex(
  dataDir: string,
  profile: SemanticIndexProfile,
): Promise<void> {
  const key = stateKey(dataDir, profile);
  return queueOperation(key, async () => {
    const state = await getState(dataDir, profile);
    if (state) await optimizeState(state);
    mutationCounts.set(key, 0);
  });
}

/** Repair all persisted semantic tables without needing an active embedding provider. */
export async function optimizeSemanticIndexes(dataDir: string): Promise<string[]> {
  if (!existsSync(indexRoot(dataDir))) return [];
  const lance = await loadLanceDb();
  if (!lance) throw new Error('LanceDB is unavailable; install the optional @lancedb/lancedb package');
  const connection = await lance.connect(indexRoot(dataDir));
  try {
    const names: string[] = typeof connection.tableNames === 'function'
      ? await connection.tableNames()
      : (await connection.listTables()).tables;
    const optimized: string[] = [];
    for (const name of names.filter((value) => value.startsWith(TABLE_PREFIX))) {
      const table = await connection.openTable(name);
      await table.optimize({
        cleanupOlderThan: new Date(Date.now() - semanticVersionRetentionMs()),
        deleteUnverified: false,
      });
      optimized.push(name);
    }
    return optimized;
  } finally {
    try { connection.close?.(); } catch { /* best effort */ }
  }
}

export function deleteSemanticVector(
  dataDir: string,
  profile: SemanticIndexProfile,
  observationId: number,
): Promise<void> {
  return queueOperation(stateKey(dataDir, profile), async () => {
    const state = await getState(dataDir, profile);
    if (!state?.table) return;
    await state.table.delete(`observation_id = ${Math.trunc(observationId)}`);
  });
}

function resolveIndexThreshold(): number {
  const raw = Number.parseInt(process.env.MEMORIX_SEMANTIC_INDEX_THRESHOLD ?? '', 10);
  return Number.isSafeInteger(raw) && raw > 0 ? raw : DEFAULT_INDEX_THRESHOLD;
}

function resolvePartitionCount(rowCount: number): number {
  return Math.max(1, Math.min(MAX_INDEX_PARTITIONS, Math.round(Math.sqrt(rowCount) / 8)));
}

async function buildIndex(state: SemanticIndexState): Promise<boolean> {
  if (!state.table) return false;
  const indices = await state.table.listIndices();
  if (indices.some((index: any) => index.columns?.includes('vector'))) return true;

  const rowCount = await state.table.countRows();
  if (rowCount < resolveIndexThreshold()) return false;

  const lance = await loadLanceDb();
  if (!lance?.Index?.hnswSq) return false;
  await state.table.createIndex('vector', {
    config: lance.Index.hnswSq({
      distanceType: 'cosine',
      numPartitions: resolvePartitionCount(rowCount),
    }),
    waitTimeoutSeconds: 3_600,
  });
  return true;
}

/** Start or await a persistent HNSW/SQ build for a large semantic table. */
export function ensureSemanticIndex(
  dataDir: string,
  profile: SemanticIndexProfile,
): Promise<boolean> {
  const key = stateKey(dataDir, profile);
  const existing = indexBuilds.get(key);
  if (existing) return existing;
  const build = getState(dataDir, profile)
    .then((state) => state ? buildIndex(state) : false)
    .catch(() => false)
    .finally(() => {
      indexBuilds.delete(key);
    });
  indexBuilds.set(key, build);
  return build;
}

/**
 * Search the local semantic shadow index. Results contain IDs only; callers
 * fetch authoritative observation details from SQLite for scope enforcement.
 */
export async function searchSemanticVectors(options: {
  dataDir: string;
  profile: SemanticIndexProfile;
  vector: number[];
  projectId?: string | string[];
  status?: string | 'all';
  limit?: number;
}): Promise<SemanticVectorHit[] | null> {
  const state = await getState(options.dataDir, options.profile);
  if (!state?.table) return null;

  const requestedLimit = Math.max(1, Math.floor(options.limit ?? 20));
  const limit = Math.min(10_000, requestedLimit);
  let query = state.table.vectorSearch(options.vector);
  const projectWhere = projectPredicate(options.projectId);
  if (projectWhere) query = query.where(projectWhere);
  // Status and visibility are intentionally checked against SQLite after the
  // bounded candidate fetch. The shadow row can lag a lifecycle update by a
  // few milliseconds; filtering here would make a newly-reactivated memory
  // invisible until the next vector write.
  const rows = await query
    .limit(limit)
    .select(['observation_id', 'project_id', 'status', 'visibility', '_distance'])
    .toArray();

  return rows
    .map((row: any) => ({
      observationId: Number(row.observation_id),
      projectId: String(row.project_id),
      ...(row.status ? { status: String(row.status) } : {}),
      ...(row.visibility ? { visibility: String(row.visibility) } : {}),
      distance: Number(row._distance ?? Number.POSITIVE_INFINITY),
    }))
    .filter((row: SemanticVectorHit) => Number.isFinite(row.distance));
}

/** Close native connections and release this process's derived-index cache. */
export async function closeSemanticIndexes(): Promise<void> {
  await Promise.all([...pendingVectorBatches.keys()].map((key) => flushPendingVectorBatch(key)));
  await Promise.all([...writeQueues.values()]);
  for (const statePromise of statePromises.values()) {
    const state = await statePromise.catch(() => null);
    try { state?.connection?.close?.(); } catch { /* best effort */ }
  }
  statePromises.clear();
  writeQueues.clear();
  indexBuilds.clear();
  mutationCounts.clear();
}

/** Close only the semantic tables rooted in one Memorix data directory. */
export async function closeSemanticIndex(dataDir: string): Promise<void> {
  const prefix = `${path.resolve(dataDir)}::`;
  await Promise.all([...pendingVectorBatches.keys()].filter((key) => key.startsWith(prefix)).map(flushPendingVectorBatch));
  await Promise.all([...writeQueues.entries()].filter(([key]) => key.startsWith(prefix)).map(([, queue]) => queue));
  for (const [key, statePromise] of statePromises.entries()) {
    if (!key.startsWith(prefix)) continue;
    const state = await statePromise.catch(() => null);
    try { state?.connection?.close?.(); } catch { /* best effort */ }
    statePromises.delete(key);
    writeQueues.delete(key);
    indexBuilds.delete(key);
    mutationCounts.delete(key);
  }
}

/** @internal Reset state for isolated tests. */
export function resetSemanticIndexRuntime(): void {
  for (const pending of pendingVectorBatches.values()) {
    if (pending.timer) clearTimeout(pending.timer);
  }
  pendingVectorBatches.clear();
  statePromises.clear();
  writeQueues.clear();
  indexBuilds.clear();
  mutationCounts.clear();
  availability = undefined;
}
