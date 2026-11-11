import { loadBetterSqlite3 } from './sqlite-db.js';

const SQLITE_BUSY_RETRY_DELAYS_MS = [50, 150, 400, 1000, 2500] as const;

export class SqliteUnavailableError extends Error {
  readonly code = 'MEMORIX_SQLITE_UNAVAILABLE';

  constructor(cause?: unknown) {
    super(
      cause instanceof Error && cause.message
        ? cause.message
        : '[memorix] SQLite is unavailable (install a supported SQLite runtime)',
    );
    this.name = 'SqliteUnavailableError';
  }
}

/** SQLite BUSY means another connection is currently holding the database lock. */
export function isTransientSqliteError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === 'string') {
    // SQLITE_LOCKED is a same-connection/shared-cache conflict. Retrying it
    // would hide a transaction bug; only BUSY is cross-connection contention.
    return /^SQLITE_BUSY(?:_|$)/i.test(code);
  }
  return error instanceof Error && /\bdatabase is locked\b|\bdatabase is busy\b/i.test(error.message);
}

export function isSqliteUnavailableError(error: unknown): boolean {
  return error instanceof SqliteUnavailableError
    || (error instanceof Error && /SQLite is not available|better-sqlite3.*failed|node:sqlite.*failed|bun:sqlite.*failed/i.test(error.message));
}

export function degradedReadError(storeName: string): Error {
  return new Error(`[memorix] Cannot read ${storeName}: SQLite backend unavailable (memory is not loaded)`);
}

export function degradedWriteError(storeName: string): Error {
  return new Error(`[memorix] Cannot write ${storeName}: SQLite backend unavailable (degraded mode; read-only)`);
}

export function formatSqliteFailure(error: unknown): string {
  return error instanceof Error && error.message ? error.message : String(error);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Retry only cross-process SQLite contention, keeping each attempt bounded. */
export async function retrySqliteBusy<T>(operation: () => Promise<T>, label: string): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (!isTransientSqliteError(error) || attempt >= SQLITE_BUSY_RETRY_DELAYS_MS.length) throw error;
      const waitMs = SQLITE_BUSY_RETRY_DELAYS_MS[attempt];
      console.error(
        `[memorix] ${label} SQLite busy (attempt ${attempt + 1}/${SQLITE_BUSY_RETRY_DELAYS_MS.length + 1}), retrying in ${waitMs}ms`,
      );
      await delay(waitMs);
    }
  }
}

/**
 * Establish one complete store instance. Runtime lock errors are retried with
 * fresh instances; a missing SQLite runtime is classified separately so the
 * caller can choose the intentional degraded backend.
 */
export async function initializeSqliteStore<T extends { init(dataDir: string): Promise<void> }>(
  factory: () => T,
  dataDir: string,
  label: string,
): Promise<T> {
  try {
    loadBetterSqlite3();
  } catch (error) {
    throw new SqliteUnavailableError(error);
  }

  return retrySqliteBusy(async () => {
    const store = factory();
    await store.init(dataDir);
    return store;
  }, label);
}
