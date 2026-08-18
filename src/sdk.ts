/**
 * Memorix SDK — Programmatic API for embedding Memorix into your own projects.
 *
 * Usage:
 *   import { createMemoryClient } from 'memorix/sdk';
 *
 *   const client = await createMemoryClient({ projectRoot: '/path/to/repo' });
 *   await client.store({ entityName: 'auth', type: 'decision', title: '...', narrative: '...' });
 *   const results = await client.search('auth decisions');
 *   await client.close();
 *
 * For MCP server embedding:
 *   import { createMemorixServer } from 'memorix/sdk';
 *
 *   const { server, projectId } = await createMemorixServer('/path/to/repo');
 *   // Connect to your own transport
 */

import type {
  Observation,
  ObservationType,
  ObservationStatus,
  IndexEntry,
  SearchOptions,
  ProgressInfo,
  ProjectInfo,
  DetectionResult,
  ObservationReader,
  RetrievalQuality,
} from './types.js';
import {
  canManageObservation,
  canReadObservation,
  filterReadableObservations,
} from './memory/visibility.js';

// ── Re-exports for convenience ──────────────────────────────────────

export { createMemorixServer } from './server.js';
export type { CreateMemorixServerOptions } from './server.js';
export { detectProject, detectProjectWithDiagnostics } from './project/detector.js';
export * from './types.js';

// ── SDK Client ──────────────────────────────────────────────────────

/** Options for creating a MemoryClient */
export interface MemoryClientOptions {
  /** Absolute path to a Git project root. Required. */
  projectRoot: string;
  /**
   * If true, suppress console.error diagnostic logs during initialization.
   * Default: false.
   */
  silent?: boolean;
}

/** Input for storing an observation */
export interface StoreInput {
  entityName: string;
  type: ObservationType;
  title: string;
  narrative: string;
  facts?: string[];
  filesModified?: string[];
  concepts?: string[];
  topicKey?: string;
  sessionId?: string;
  progress?: ProgressInfo;
  source?: 'agent' | 'git' | 'manual';
  commitHash?: string;
  relatedCommits?: string[];
  relatedEntities?: string[];
  sourceDetail?: 'explicit' | 'hook' | 'git-ingest';
  valueCategory?: 'core' | 'contextual' | 'ephemeral';
}

/** Result from storing an observation */
export interface StoreResult {
  observation: Observation;
  upserted: boolean;
}

/** Options for searching */
export interface ClientSearchOptions {
  query: string;
  /** Filter by observation type */
  type?: ObservationType;
  /** Filter by observation source */
  source?: 'agent' | 'git' | 'manual';
  /** Filter by status. Default: 'active' */
  status?: ObservationStatus | 'all';
  /** Maximum results. Default: 20 */
  limit?: number;
  /** Retrieval profile. Default: balanced. */
  quality?: RetrievalQuality;
}

/** Result from resolving observations */
export interface ResolveResult {
  resolved: number[];
  notFound: number[];
}

/**
 * A lightweight, self-contained memory client for reading and writing
 * Memorix observations without MCP overhead.
 *
 * Each client initializes its own SQLite backend and Orama search index,
 * scoped to a single project. It is an unbound project reader by default, so
 * it exposes only project-shared records and cannot alter personal or team
 * records. Use an identity-bound MCP session for private coordination data.
 * Call `close()` when done to release resources.
 */
export class MemoryClient {
  private _projectId: string;
  private _projectRoot: string;
  private _dataDir: string;
  /** SDK calls are unbound by default, so they see only project-shared records. */
  private _reader: ObservationReader;
  private _closed = false;

  // Internal module references — loaded lazily to avoid top-level side effects
  private _observations!: typeof import('./memory/observations.js');
  private _oramaStore!: typeof import('./store/orama-store.js');
  private _obsStore!: typeof import('./store/obs-store.js');
  private _freshness!: typeof import('./memory/freshness.js');

  /** @internal — use createMemoryClient() instead */
  constructor(projectId: string, projectRoot: string, dataDir: string) {
    this._projectId = projectId;
    this._projectRoot = projectRoot;
    this._dataDir = dataDir;
    this._reader = { projectId };
  }

  /** The canonical project ID (derived from Git remote or local path) */
  get projectId(): string { return this._projectId; }

  /** The project root path */
  get projectRoot(): string { return this._projectRoot; }

  /** The Memorix data directory for this project */
  get dataDir(): string { return this._dataDir; }

  /**
   * @internal Initialize stores and search index.
   * Called by createMemoryClient(). Do not call directly.
   */
  async _init(silent: boolean): Promise<void> {
    // Suppress logs if requested
    const originalError = console.error;
    if (silent) {
      console.error = () => {};
    }

    try {
      this._obsStore = await import('./store/obs-store.js');
      this._observations = await import('./memory/observations.js');
      this._oramaStore = await import('./store/orama-store.js');
      this._freshness = await import('./memory/freshness.js');

      // Initialize observation store (SQLite backend)
      await this._obsStore.initObservationStore(this._dataDir);

      // Initialize observations in-memory state
      await this._observations.initObservations(this._dataDir);

      // Prepare search index (hydrate Orama from SQLite)
      await this._observations.prepareSearchIndex();
    } finally {
      if (silent) {
        console.error = originalError;
      }
    }
  }

  private _ensureOpen(): void {
    if (this._closed) throw new Error('[memorix-sdk] MemoryClient is closed');
  }

  /**
   * Store a new observation (or upsert if topicKey matches an existing one).
   *
   * @example
   * ```ts
   * const { observation } = await client.store({
   *   entityName: 'auth-module',
   *   type: 'decision',
   *   title: 'Use JWT for API auth',
   *   narrative: 'Chose JWT over session cookies for stateless API authentication.',
   *   facts: ['Token expiry: 1h', 'Refresh token: 7d'],
   * });
   * ```
   */
  async store(input: StoreInput): Promise<StoreResult> {
    this._ensureOpen();
    return this._observations.storeObservation({
      ...input,
      projectId: this._projectId,
      visibilityReader: this._reader,
    });
  }

  /**
   * Search observations using full-text and optional vector search.
   *
   * @example
   * ```ts
   * const results = await client.search({ query: 'authentication decisions' });
   * for (const r of results) {
   *   console.log(`${r.title} (score: ${r.score})`);
   * }
   * ```
   */
  async search(options: ClientSearchOptions): Promise<IndexEntry[]> {
    this._ensureOpen();
    await this._freshness.withFreshIndex(() => {});

    const searchOpts: SearchOptions = {
      query: options.query,
      projectId: this._projectId,
      limit: options.limit ?? 20,
      type: options.type,
      source: options.source,
      status: options.status === 'all' ? undefined : (options.status ?? 'active'),
      quality: options.quality,
      reader: this._reader,
    };

    return this._oramaStore.searchObservations(searchOpts);
  }

  /**
   * Get a single observation by ID.
   */
  async get(id: number): Promise<Observation | undefined> {
    this._ensureOpen();
    await this._freshness.withFreshIndex(() => {});
    const observation = this._observations.getObservation(id, this._projectId);
    return observation && canReadObservation(observation, this._reader) ? observation : undefined;
  }

  /**
   * Get all observations for this project.
   */
  async getAll(): Promise<Observation[]> {
    this._ensureOpen();
    await this._freshness.withFreshIndex(() => {});
    return filterReadableObservations(
      this._observations.getProjectObservations(this._projectId),
      this._reader,
    );
  }

  /**
   * Get the total observation count for this project.
   */
  async count(): Promise<number> {
    this._ensureOpen();
    await this._freshness.withFreshIndex(() => {});
    return filterReadableObservations(
      this._observations.getProjectObservations(this._projectId),
      this._reader,
    ).length;
  }

  /**
   * Mark observations as resolved or archived.
   *
   * Resolved observations are hidden from default search but recoverable.
   * Archived observations are permanently hidden.
   *
   * @example
   * ```ts
   * await client.resolve([1, 2, 3]);
   * await client.resolve([4], 'archived');
   * ```
   */
  async resolve(ids: number[], status: ObservationStatus = 'resolved'): Promise<ResolveResult> {
    this._ensureOpen();
    const manageableIds = ids.filter((id) => {
      const observation = this._observations.getObservation(id, this._projectId);
      return observation && canManageObservation(observation, this._reader);
    });
    const deniedIds = ids.filter((id) => !manageableIds.includes(id));
    const result = await this._observations.resolveObservations(manageableIds, status);
    return {
      resolved: result.resolved,
      notFound: [...new Set([...result.notFound, ...deniedIds])],
    };
  }

  /**
   * Release resources (close SQLite handle, reset index).
   * The client cannot be used after calling close().
   */
  async close(): Promise<void> {
    if (this._closed) return;
    this._closed = true;
    try {
      this._obsStore.resetObservationStore();
      await this._oramaStore.resetDb();
    } catch {
      // best-effort cleanup
    }
    // ObservationStore.close() only detaches from the shared handle.
    // Release this dataDir so Windows can unlink memorix.db after close().
    try {
      const { closeDatabase } = await import('./store/sqlite-db.js');
      closeDatabase(this._dataDir);
    } catch {
      // best-effort cleanup
    }
  }
}

/**
 * Create a new MemoryClient for a project.
 *
 * This initializes SQLite, loads observations, and prepares the search index.
 * Each client is independent — you can have multiple clients for different projects.
 *
 * @example
 * ```ts
 * import { createMemoryClient } from 'memorix/sdk';
 *
 * const client = await createMemoryClient({ projectRoot: '/home/user/my-project' });
 *
 * // Store a memory
 * await client.store({
 *   entityName: 'api-gateway',
 *   type: 'gotcha',
 *   title: 'Rate limiter resets on deploy',
 *   narrative: 'In-memory rate limiter state is lost on every deploy...',
 * });
 *
 * // Search memories
 * const results = await client.search({ query: 'rate limiter' });
 *
 * // Clean up
 * await client.close();
 * ```
 */
export async function createMemoryClient(options: MemoryClientOptions): Promise<MemoryClient> {
  const { projectRoot, silent = false } = options;

  // Detect project from Git root
  const { detectProject: detect } = await import('./project/detector.js');
  const project = detect(projectRoot);
  if (!project) {
    throw new Error(
      `[memorix-sdk] No Git repository found at "${projectRoot}". ` +
      'Memorix requires a Git-tracked project for identity resolution.',
    );
  }

  // Honor MEMORIX_DATA_DIR so isolated benchmarks and tests do not write
  // into ~/.memorix/data. Unset, keep the per-project home path.
  const path = await import('node:path');
  const os = await import('node:os');
  const dataDir = process.env.MEMORIX_DATA_DIR
    || path.join(os.homedir(), '.memorix', 'data', project.id.replace(/\//g, path.sep));

  // Ensure data directory exists
  const fs = await import('node:fs');
  fs.mkdirSync(dataDir, { recursive: true });

  const client = new MemoryClient(project.id, projectRoot, dataDir);
  await client._init(silent);
  return client;
}
