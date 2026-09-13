/**
 * MiniSkillStore — persistence abstraction for mini-skills.
 *
 * Backends:
 *   - MiniSkillSqliteStore — canonical store, uses shared DB handle from sqlite-db.ts
 *   - MiniSkillGracefulDegrade — explicit read-only fallback when SQLite is unavailable
 *
 * Phase 2 debt-zero: SQLite is the only canonical store for mini-skills.
 * JSON files are migration source only. No writable JSON fallback exists.
 */

import type { MiniSkill } from '../types.js';
import { getDatabase } from './sqlite-db.js';
import { degradedReadError, degradedWriteError, initializeSqliteStore, isSqliteUnavailableError, retrySqliteBusy } from './sqlite-reliability.js';
import {
  loadMiniSkillsJson,
} from './persistence.js';
import path from 'node:path';
import fs from 'node:fs';

// ── Interface ───────────────────────────────────────────────────────

export interface MiniSkillStore {
  init(dataDir: string): Promise<void>;
  loadAll(): Promise<MiniSkill[]>;
  loadByProject(projectId: string): Promise<MiniSkill[]>;
  insert(skill: MiniSkill): Promise<void>;
  update(skill: MiniSkill): Promise<void>;
  remove(id: number): Promise<void>;
  loadIdCounter(): Promise<number>;
  saveIdCounter(nextId: number): Promise<void>;
  /**
   * Atomic create: allocate ID + insert skill + bump counter in one transaction.
   * Prevents concurrent promotes from receiving the same ID.
   */
  atomicInsertWithId(skill: Omit<MiniSkill, 'id'>): Promise<MiniSkill>;
  ensureFresh(): Promise<boolean>;
  getGeneration(): number;
  getBackendName(): 'sqlite' | 'degraded';
  getBackendReason?(): string | undefined;
}

// ── Row <-> MiniSkill serialization ─────────────────────────────────

function skillToRow(skill: MiniSkill): Record<string, unknown> {
  return {
    id: skill.id,
    sourceObservationIds: JSON.stringify(skill.sourceObservationIds ?? []),
    sourceEntity: skill.sourceEntity ?? 'unknown',
    title: skill.title,
    instruction: skill.instruction ?? '',
    trigger_desc: skill.trigger ?? '',
    facts: JSON.stringify(skill.facts ?? []),
    projectId: skill.projectId,
    createdAt: skill.createdAt,
    usedCount: skill.usedCount ?? 0,
    tags: JSON.stringify(skill.tags ?? []),
    sourceSnapshot: skill.sourceSnapshot ?? '',
    updatedAt: skill.updatedAt ?? null,
  };
}

function rowToSkill(row: any): MiniSkill {
  return {
    id: row.id,
    sourceObservationIds: safeJsonParse(row.sourceObservationIds, []),
    sourceEntity: row.sourceEntity ?? 'unknown',
    title: row.title,
    instruction: row.instruction ?? '',
    trigger: row.trigger_desc ?? '',
    facts: safeJsonParse(row.facts, []),
    projectId: row.projectId,
    createdAt: row.createdAt,
    usedCount: row.usedCount ?? 0,
    tags: safeJsonParse(row.tags, []),
    sourceSnapshot: row.sourceSnapshot || undefined,
    updatedAt: row.updatedAt || undefined,
  };
}

function safeJsonParse(val: string | null | undefined, fallback: any): any {
  if (val == null || val === '') return fallback;
  try { return JSON.parse(val); } catch { return fallback; }
}

// ── SQLite Backend ──────────────────────────────────────────────────

export class MiniSkillSqliteStore implements MiniSkillStore {
  private db: any = null;
  private dataDir: string = '';
  private knownGeneration: number = 0;

  private stmtInsert: any = null;
  private stmtDelete: any = null;
  private stmtSelectAll: any = null;
  private stmtSelectByProject: any = null;
  private stmtGetMeta: any = null;
  private stmtSetMeta: any = null;
  private stmtSelectGeneration: any = null;
  private stmtBumpGeneration: any = null;

  async init(dataDir: string): Promise<void> {
    this.dataDir = dataDir;
    this.db = getDatabase(dataDir);

    // Prepare statements
    this.stmtInsert = this.db.prepare(`
      INSERT OR REPLACE INTO mini_skills
        (id, sourceObservationIds, sourceEntity, title, instruction, trigger_desc,
         facts, projectId, createdAt, usedCount, tags, sourceSnapshot, updatedAt)
      VALUES
        (@id, @sourceObservationIds, @sourceEntity, @title, @instruction, @trigger_desc,
         @facts, @projectId, @createdAt, @usedCount, @tags, @sourceSnapshot, @updatedAt)
    `);
    this.stmtDelete = this.db.prepare(`DELETE FROM mini_skills WHERE id = ?`);
    this.stmtSelectAll = this.db.prepare(`SELECT * FROM mini_skills`);
    this.stmtSelectByProject = this.db.prepare(`SELECT * FROM mini_skills WHERE projectId = ?`);
    this.stmtGetMeta = this.db.prepare(`SELECT value FROM meta WHERE key = ?`);
    this.stmtSetMeta = this.db.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)`);
    this.stmtSelectGeneration = this.db.prepare(`SELECT value FROM meta WHERE key = 'mini_skills_generation'`);
    this.stmtBumpGeneration = this.db.prepare(`UPDATE meta SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT) WHERE key = 'mini_skills_generation'`);

    // Read initial generation
    this.knownGeneration = this.readGeneration();

    // One-time migration from mini-skills.json
    await this.migrateFromJsonIfNeeded();
  }

  private readGeneration(): number {
    const row = this.stmtSelectGeneration.get();
    return row ? parseInt(row.value, 10) : 0;
  }

  private bumpGeneration(): void {
    this.stmtBumpGeneration.run();
    this.knownGeneration = this.readGeneration();
  }

  // ── Migration ────────────────────────────────────────────────────

  private async migrateFromJsonIfNeeded(): Promise<void> {
    const count = this.db.prepare(`SELECT COUNT(*) AS cnt FROM mini_skills`).get();
    if (count.cnt > 0) return;

    const jsonPath = path.join(this.dataDir, 'mini-skills.json');
    if (!fs.existsSync(jsonPath)) return;

    try {
      const raw = fs.readFileSync(jsonPath, 'utf-8');
      const skills: MiniSkill[] = JSON.parse(raw);
      if (!Array.isArray(skills) || skills.length === 0) return;

      console.error(`[memorix] Migrating ${skills.length} mini-skills from JSON to SQLite...`);

      const insertMany = this.db.transaction((list: MiniSkill[]) => {
        for (const skill of list) {
          this.stmtInsert.run(skillToRow(skill));
        }
      });
      insertMany(skills);

      // Migrate counter
      const counterPath = path.join(this.dataDir, 'mini-skills-counter.json');
      if (fs.existsSync(counterPath)) {
        try {
          const counterData = JSON.parse(fs.readFileSync(counterPath, 'utf-8'));
          const nextId = counterData.nextId ?? (Math.max(...skills.map(s => s.id)) + 1);
          this.stmtSetMeta.run('mini_skills_next_id', String(nextId));
        } catch {
          this.stmtSetMeta.run('mini_skills_next_id', String(Math.max(...skills.map(s => s.id)) + 1));
        }
      } else {
        this.stmtSetMeta.run('mini_skills_next_id', String(Math.max(...skills.map(s => s.id)) + 1));
      }

      this.bumpGeneration();
      console.error(`[memorix] Mini-skills migration complete. ${skills.length} skills now in SQLite.`);
    } catch (err) {
      console.error(`[memorix] Mini-skills JSON->SQLite migration failed (non-fatal): ${err}`);
    }
  }

  // ── Public read ──────────────────────────────────────────────────

  async loadAll(): Promise<MiniSkill[]> {
    return this.stmtSelectAll.all().map(rowToSkill);
  }

  async loadByProject(projectId: string): Promise<MiniSkill[]> {
    return this.stmtSelectByProject.all(projectId).map(rowToSkill);
  }

  async loadIdCounter(): Promise<number> {
    const row = this.stmtGetMeta.get('mini_skills_next_id');
    return row ? parseInt(row.value, 10) : 1;
  }

  // ── Public write (each bumps generation) ─────────────────────────

  async insert(skill: MiniSkill): Promise<void> {
    this.stmtInsert.run(skillToRow(skill));
    this.bumpGeneration();
  }

  async update(skill: MiniSkill): Promise<void> {
    this.stmtInsert.run(skillToRow(skill)); // INSERT OR REPLACE
    this.bumpGeneration();
  }

  async remove(id: number): Promise<void> {
    this.stmtDelete.run(id);
    this.bumpGeneration();
  }

  async saveIdCounter(nextId: number): Promise<void> {
    this.stmtSetMeta.run('mini_skills_next_id', String(nextId));
  }

  /**
   * Atomic create: allocate ID + insert + bump counter in a single SQLite transaction.
   * SQLite serializes write transactions, so concurrent calls are safely sequenced.
   */
  async atomicInsertWithId(skillWithoutId: Omit<MiniSkill, 'id'>): Promise<MiniSkill> {
    return retrySqliteBusy(async () => this.db.transaction(() => {
      // 1. Read current counter inside the transaction
      const row = this.stmtGetMeta.get('mini_skills_next_id');
      const nextId = row ? parseInt(row.value, 10) : 1;

      // 2. Build the full skill with the allocated ID
      const skill: MiniSkill = { ...skillWithoutId, id: nextId } as MiniSkill;

      // 3. Insert
      this.stmtInsert.run(skillToRow(skill));

      // 4. Bump counter
      this.stmtSetMeta.run('mini_skills_next_id', String(nextId + 1));

      // 5. Bump generation
      this.stmtBumpGeneration.run();
      this.knownGeneration = this.readGeneration();

      return skill;
    })(), 'Mini-skill promotion');
  }

  // ── Freshness ────────────────────────────────────────────────────

  async ensureFresh(): Promise<boolean> {
    const remoteGen = this.readGeneration();
    if (remoteGen > this.knownGeneration) {
      this.knownGeneration = remoteGen;
      return true;
    }
    return false;
  }

  getGeneration(): number {
    return this.knownGeneration;
  }

  getBackendName(): 'sqlite' | 'degraded' {
    return 'sqlite';
  }
}

// ── Graceful Degrade Fallback ────────────────────────────────────────
//
// Phase 2 debt-zero rule: mini-skills have NO writable JSON fallback.
// In environments without a supported SQLite runtime, reads return an
// explicit unavailable error and writes fail rather than pretending success.

export class MiniSkillGracefulDegrade implements MiniSkillStore {
  private warned = false;

  constructor(private readonly reason = 'SQLite runtime unavailable') {}

  private unavailableRead(): Error {
    return degradedReadError('mini-skills');
  }

  private warn(): void {
    if (!this.warned) {
      console.error('[memorix] MiniSkillStore: SQLite unavailable — mini-skills cannot be read or written. Install a supported SQLite runtime.');
      this.warned = true;
    }
  }

  async init(_dataDir: string): Promise<void> {
    this.warn();
  }

  async loadAll(): Promise<MiniSkill[]> { throw this.unavailableRead(); }
  async loadByProject(_projectId: string): Promise<MiniSkill[]> { throw this.unavailableRead(); }
  async loadIdCounter(): Promise<number> { throw this.unavailableRead(); }

  async insert(_skill: MiniSkill): Promise<void> { this.warn(); throw degradedWriteError('mini-skills'); }
  async update(_skill: MiniSkill): Promise<void> { this.warn(); throw degradedWriteError('mini-skills'); }
  async remove(_id: number): Promise<void> { this.warn(); throw degradedWriteError('mini-skills'); }
  async saveIdCounter(_nextId: number): Promise<void> { this.warn(); throw degradedWriteError('mini-skills'); }
  async atomicInsertWithId(skillWithoutId: Omit<MiniSkill, 'id'>): Promise<MiniSkill> {
    this.warn();
    throw degradedWriteError('mini-skills');
  }

  async ensureFresh(): Promise<boolean> { return false; }
  getGeneration(): number { return 0; }
  getBackendName(): 'sqlite' | 'degraded' { return 'degraded'; }
  getBackendReason(): string { return this.reason; }
}

// ── Singleton access ────────────────────────────────────────────────

let _store: MiniSkillStore | null = null;
let _storeDataDir: string | null = null;

export function isMiniSkillStoreInitialized(): boolean {
  return _store !== null;
}

export function getMiniSkillStore(): MiniSkillStore {
  if (!_store) {
    throw new Error('[memorix] MiniSkillStore not initialized — call initMiniSkillStore() first');
  }
  return _store;
}

export function resetMiniSkillStore(): void {
  _store = null;
  _storeDataDir = null;
}

export async function initMiniSkillStore(dataDir: string): Promise<MiniSkillStore> {
  if (_store && _storeDataDir === dataDir) return _store;

  _store = null;
  _storeDataDir = null;

  // Only a missing SQLite runtime may use the intentional read-only fallback.
  let degradedReason = 'SQLite runtime unavailable';
  try {
    const store = await initializeSqliteStore(() => new MiniSkillSqliteStore(), dataDir, 'Mini-skill store');
    _store = store;
    _storeDataDir = dataDir;
    return store;
  } catch (err) {
    if (!isSqliteUnavailableError(err)) throw err;
    degradedReason = err instanceof Error ? err.message : String(err);
    console.error(`[memorix] MiniSkillSqliteStore unavailable, running in degraded read-only mode: ${degradedReason}`);
  }

  // Fallback: explicit read-only mode (no writable JSON backend per debt-zero rule)
  const store = new MiniSkillGracefulDegrade(degradedReason);
  await store.init(dataDir);
  _store = store;
  _storeDataDir = dataDir;
  return store;
}
