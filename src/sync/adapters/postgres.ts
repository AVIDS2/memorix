import type { ChangeBatch, SyncCompactReport, SyncPullPage, SyncRemote } from '../types.js';

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

export class PostgresSyncRemote implements SyncRemote {
  readonly kind = 'postgres';
  readonly namespace: string;

  constructor(private readonly sql: SqlClient, namespace: string) {
    this.namespace = namespace;
  }

  async init(options: { create?: boolean } = {}): Promise<void> {
    if (options.create === false) return;
    await this.sql.exec(
      `CREATE TABLE IF NOT EXISTS memorix_sync_batches (
        namespace text,
        device_id text,
        sequence bigint,
        produced_at text,
        payload jsonb,
        PRIMARY KEY (namespace, device_id, sequence)
      )`,
      [],
    );
    // Upgrade the pre-v3 #277 table without touching its payloads. Legacy rows
    // stay quarantined under a non-project namespace; a fresh scoped sync never
    // accidentally imports them.
    await this.sql.exec(
      `ALTER TABLE memorix_sync_batches
       ADD COLUMN IF NOT EXISTS namespace text NOT NULL DEFAULT 'legacy'`,
      [],
    );
    await this.sql.exec(
      `CREATE UNIQUE INDEX IF NOT EXISTS memorix_sync_batches_scope_key
       ON memorix_sync_batches(namespace, device_id, sequence)`,
      [],
    );
  }

  async push(batch: ChangeBatch): Promise<void> {
    await this.sql.exec(
      `INSERT INTO memorix_sync_batches (namespace, device_id, sequence, produced_at, payload)
       VALUES ($1, $2, $3, $4, $5::jsonb)
       ON CONFLICT (namespace, device_id, sequence) DO NOTHING`,
      [this.namespace, batch.deviceId, batch.sequence, batch.producedAt, JSON.stringify(batch)],
    );
  }

  async pull(since: Record<string, number>, limit: number, pageToken?: string): Promise<SyncPullPage> {
    const sinceEntries = Object.entries(since);
    const params: unknown[] = [this.namespace];
    const clauses: string[] = [];
    for (const [deviceId, sequence] of sinceEntries) {
      params.push(deviceId, sequence);
      const deviceParam = `$${params.length - 1}`;
      const sequenceParam = `$${params.length}`;
      clauses.push(`(device_id = ${deviceParam} AND sequence > ${sequenceParam})`);
    }
    if (sinceEntries.length > 0) {
      params.push(...sinceEntries.map(([deviceId]) => deviceId));
      const placeholders = sinceEntries.map((_, index) => `$${params.length - sinceEntries.length + index + 1}`);
      clauses.push(`device_id NOT IN (${placeholders.join(', ')})`);
    } else {
      clauses.push('TRUE');
    }
    const offset = Math.max(0, Number.parseInt(pageToken ?? '0', 10) || 0);
    params.push(limit + 1, offset);
    const rows = await this.sql.query<BatchRow>(
      `SELECT device_id, sequence, produced_at, payload
       FROM memorix_sync_batches
       WHERE namespace = $1 AND (${clauses.join(' OR ')})
       ORDER BY device_id, sequence
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    const batches = rows
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
      .filter((batch) => batch.sequence > (since[batch.deviceId] ?? 0))
      .sort((left, right) => {
        if (left.deviceId < right.deviceId) return -1;
        if (left.deviceId > right.deviceId) return 1;
        return left.sequence - right.sequence;
      });
    const hasMore = batches.length > limit;
    return { batches: batches.slice(0, limit), hasMore, nextPageToken: hasMore ? String(offset + limit) : undefined };
  }

  async compact(through: Record<string, number>, options: { dryRun?: boolean } = {}): Promise<SyncCompactReport> {
    const entries = Object.entries(through).filter(([, value]) => Number.isSafeInteger(value) && value >= 0);
    if (entries.length === 0) return { candidates: 0, deleted: 0 };
    const clauses: string[] = [];
    const params: unknown[] = [this.namespace];
    for (const [deviceId, sequence] of entries) {
      params.push(deviceId, sequence);
      clauses.push(`(device_id = $${params.length - 1} AND sequence <= $${params.length})`);
    }
    const where = `namespace = $1 AND (${clauses.join(' OR ')})`;
    const [row] = await this.sql.query<{ count: number | string }>(`SELECT COUNT(*) AS count FROM memorix_sync_batches WHERE ${where}`, params);
    const candidates = Number(row?.count ?? 0);
    if (!options.dryRun && candidates > 0) await this.sql.exec(`DELETE FROM memorix_sync_batches WHERE ${where}`, params);
    return { candidates, deleted: options.dryRun ? 0 : candidates };
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
