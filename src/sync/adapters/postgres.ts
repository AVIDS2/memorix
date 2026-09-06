import { emptyCursor } from '../types.js';
import type { ChangeBatch, SyncCursor, SyncRemote } from '../types.js';

export interface SqlClient {
  query<T>(sql: string, params: unknown[]): Promise<T[]>;
  exec(sql: string, params: unknown[]): Promise<void>;
}

interface BatchRow {
  device_id: string;
  sequence: number | string;
  produced_at: string;
  payload: ChangeBatch | string;
}

interface CursorRow {
  applied: Record<string, number> | string;
}

export class PostgresSyncRemote implements SyncRemote {
  readonly kind = 'postgres';

  constructor(private readonly sql: SqlClient) {}

  async init(): Promise<void> {
    await this.sql.exec(
      `CREATE TABLE IF NOT EXISTS memorix_sync_batches (
        device_id text,
        sequence bigint,
        produced_at text,
        payload jsonb,
        PRIMARY KEY (device_id, sequence)
      )`,
      [],
    );
    await this.sql.exec(
      `CREATE TABLE IF NOT EXISTS memorix_sync_cursors (
        owner_device text PRIMARY KEY,
        applied jsonb
      )`,
      [],
    );
  }

  async getCursor(deviceId: string): Promise<SyncCursor> {
    const [row] = await this.sql.query<CursorRow>(
      'SELECT applied FROM memorix_sync_cursors WHERE owner_device = $1',
      [deviceId],
    );
    if (!row) return emptyCursor();

    const applied = typeof row.applied === 'string'
      ? JSON.parse(row.applied) as Record<string, number>
      : row.applied;
    return { applied };
  }

  async setCursor(deviceId: string, cursor: SyncCursor): Promise<void> {
    await this.sql.exec(
      `INSERT INTO memorix_sync_cursors (owner_device, applied)
       VALUES ($1, $2::jsonb)
       ON CONFLICT (owner_device) DO UPDATE SET applied = EXCLUDED.applied`,
      [deviceId, JSON.stringify(cursor.applied)],
    );
  }

  async push(batch: ChangeBatch): Promise<void> {
    await this.sql.exec(
      `INSERT INTO memorix_sync_batches (device_id, sequence, produced_at, payload)
       VALUES ($1, $2, $3, $4::jsonb)
       ON CONFLICT (device_id, sequence) DO NOTHING`,
      [batch.deviceId, batch.sequence, batch.producedAt, JSON.stringify(batch)],
    );
  }

  async pull(since: Record<string, number>): Promise<ChangeBatch[]> {
    // Filter server-side: only ship batches newer than the caller's per-device
    // cursor, so a pull costs O(new rows), not O(full history).
    const rows = await this.sql.query<BatchRow>(
      `SELECT device_id, sequence, produced_at, payload
         FROM memorix_sync_batches
        WHERE sequence > COALESCE(($1::jsonb ->> device_id)::bigint, 0)`,
      [JSON.stringify(since)],
    );

    return rows
      .map((row) => {
        const payload = typeof row.payload === 'string'
          ? JSON.parse(row.payload) as ChangeBatch
          : row.payload;
        return {
          ...payload,
          deviceId: row.device_id,
          sequence: Number(row.sequence),
          producedAt: row.produced_at,
        };
      })
      .sort((left, right) => {
        if (left.deviceId < right.deviceId) return -1;
        if (left.deviceId > right.deviceId) return 1;
        return left.sequence - right.sequence;
      });
  }

  async close(): Promise<void> {}
}

interface PgPool {
  query(sql: string, params: unknown[]): Promise<{ rows: unknown[] }>;
}

interface PgModule {
  Pool?: new (config: Record<string, unknown>) => PgPool;
  default?: {
    Pool?: new (config: Record<string, unknown>) => PgPool;
  };
}

export async function createPgSqlClient(env: NodeJS.ProcessEnv = process.env): Promise<SqlClient> {
  const connectionString = env.MEMORIX_SYNC_PG_URL;
  let config: Record<string, unknown>;

  if (connectionString) {
    config = { connectionString };
  } else {
    const required = [
      'MEMORIX_SYNC_PG_HOST',
      'MEMORIX_SYNC_PG_PORT',
      'MEMORIX_SYNC_PG_DB',
      'MEMORIX_SYNC_PG_USER',
      'MEMORIX_SYNC_PG_PASSWORD',
    ] as const;
    const missing = required.filter((name) => !env[name]);
    if (missing.length > 0) {
      throw new Error(
        `Postgres sync requires MEMORIX_SYNC_PG_URL or all discrete settings; missing ${missing.join(', ')}`,
      );
    }

    const port = Number(env.MEMORIX_SYNC_PG_PORT);
    if (!Number.isInteger(port) || port <= 0) {
      throw new Error('MEMORIX_SYNC_PG_PORT must be a positive integer');
    }
    config = {
      host: env.MEMORIX_SYNC_PG_HOST,
      port,
      database: env.MEMORIX_SYNC_PG_DB,
      user: env.MEMORIX_SYNC_PG_USER,
      password: env.MEMORIX_SYNC_PG_PASSWORD,
    };
  }

  // pg is optional by design, so a static import would make every install require it.
  const packageName = 'pg';
  let pg: PgModule;
  try {
    pg = await import(packageName) as PgModule;
  } catch (cause) {
    throw new Error('Postgres sync requires the optional "pg" package; install it in your application', { cause });
  }

  const Pool = pg.Pool ?? pg.default?.Pool;
  if (!Pool) {
    throw new Error('The installed "pg" package does not export Pool');
  }
  const pool = new Pool(config);

  return {
    async query<T>(sql: string, params: unknown[]): Promise<T[]> {
      const result = await pool.query(sql, params);
      return result.rows as T[];
    },
    async exec(sql: string, params: unknown[]): Promise<void> {
      await pool.query(sql, params);
    },
  };
}
