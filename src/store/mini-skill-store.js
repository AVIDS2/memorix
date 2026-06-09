/**
 * MiniSkillStore — persistence abstraction for mini-skills.
 *
 * Backends:
 *   - MiniSkillSqliteStore — canonical store, uses shared DB handle from sqlite-db.ts
 *   - MiniSkillGracefulDegrade — no-op fallback when SQLite is unavailable
 *
 * Phase 2 debt-zero: SQLite is the only canonical store for mini-skills.
 * JSON files are migration source only. No writable JSON fallback exists.
 */
import { getDatabase } from './sqlite-db.js';
import path from 'node:path';
import fs from 'node:fs';
// ── Row <-> MiniSkill serialization ─────────────────────────────────
function skillToRow(skill) {
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
function rowToSkill(row) {
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
function safeJsonParse(val, fallback) {
    if (val == null || val === '')
        return fallback;
    try {
        return JSON.parse(val);
    }
    catch {
        return fallback;
    }
}
// ── SQLite Backend ──────────────────────────────────────────────────
export class MiniSkillSqliteStore {
    db = null;
    dataDir = '';
    knownGeneration = 0;
    stmtInsert = null;
    stmtDelete = null;
    stmtSelectAll = null;
    stmtSelectByProject = null;
    stmtGetMeta = null;
    stmtSetMeta = null;
    stmtSelectGeneration = null;
    stmtBumpGeneration = null;
    async init(dataDir) {
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
    readGeneration() {
        const row = this.stmtSelectGeneration.get();
        return row ? parseInt(row.value, 10) : 0;
    }
    bumpGeneration() {
        this.stmtBumpGeneration.run();
        this.knownGeneration = this.readGeneration();
    }
    // ── Migration ────────────────────────────────────────────────────
    async migrateFromJsonIfNeeded() {
        const count = this.db.prepare(`SELECT COUNT(*) AS cnt FROM mini_skills`).get();
        if (count.cnt > 0)
            return;
        const jsonPath = path.join(this.dataDir, 'mini-skills.json');
        if (!fs.existsSync(jsonPath))
            return;
        try {
            const raw = fs.readFileSync(jsonPath, 'utf-8');
            const skills = JSON.parse(raw);
            if (!Array.isArray(skills) || skills.length === 0)
                return;
            console.error(`[memorix] Migrating ${skills.length} mini-skills from JSON to SQLite...`);
            const insertMany = this.db.transaction((list) => {
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
                }
                catch {
                    this.stmtSetMeta.run('mini_skills_next_id', String(Math.max(...skills.map(s => s.id)) + 1));
                }
            }
            else {
                this.stmtSetMeta.run('mini_skills_next_id', String(Math.max(...skills.map(s => s.id)) + 1));
            }
            this.bumpGeneration();
            console.error(`[memorix] Mini-skills migration complete. ${skills.length} skills now in SQLite.`);
        }
        catch (err) {
            console.error(`[memorix] Mini-skills JSON->SQLite migration failed (non-fatal): ${err}`);
        }
    }
    // ── Public read ──────────────────────────────────────────────────
    async loadAll() {
        return this.stmtSelectAll.all().map(rowToSkill);
    }
    async loadByProject(projectId) {
        return this.stmtSelectByProject.all(projectId).map(rowToSkill);
    }
    async loadIdCounter() {
        const row = this.stmtGetMeta.get('mini_skills_next_id');
        return row ? parseInt(row.value, 10) : 1;
    }
    // ── Public write (each bumps generation) ─────────────────────────
    async insert(skill) {
        this.stmtInsert.run(skillToRow(skill));
        this.bumpGeneration();
    }
    async update(skill) {
        this.stmtInsert.run(skillToRow(skill)); // INSERT OR REPLACE
        this.bumpGeneration();
    }
    async remove(id) {
        this.stmtDelete.run(id);
        this.bumpGeneration();
    }
    async saveIdCounter(nextId) {
        this.stmtSetMeta.run('mini_skills_next_id', String(nextId));
    }
    /**
     * Atomic create: allocate ID + insert + bump counter in a single SQLite transaction.
     * SQLite serializes write transactions, so concurrent calls are safely sequenced.
     */
    async atomicInsertWithId(skillWithoutId) {
        const result = this.db.transaction(() => {
            // 1. Read current counter inside the transaction
            const row = this.stmtGetMeta.get('mini_skills_next_id');
            const nextId = row ? parseInt(row.value, 10) : 1;
            // 2. Build the full skill with the allocated ID
            const skill = { ...skillWithoutId, id: nextId };
            // 3. Insert
            this.stmtInsert.run(skillToRow(skill));
            // 4. Bump counter
            this.stmtSetMeta.run('mini_skills_next_id', String(nextId + 1));
            // 5. Bump generation
            this.stmtBumpGeneration.run();
            this.knownGeneration = this.readGeneration();
            return skill;
        })();
        return result;
    }
    // ── Freshness ────────────────────────────────────────────────────
    async ensureFresh() {
        const remoteGen = this.readGeneration();
        if (remoteGen > this.knownGeneration) {
            this.knownGeneration = remoteGen;
            return true;
        }
        return false;
    }
    getGeneration() {
        return this.knownGeneration;
    }
    getBackendName() {
        return 'sqlite';
    }
}
// ── Graceful Degrade Fallback ────────────────────────────────────────
//
// Phase 2 debt-zero rule: mini-skills have NO writable JSON fallback.
// In JSON-only environments (no better-sqlite3), reads return empty
// and writes are no-ops with a warning. This prevents a parallel
// canonical JSON write path from existing alongside SQLite.
export class MiniSkillGracefulDegrade {
    warned = false;
    warn() {
        if (!this.warned) {
            console.error('[memorix] MiniSkillStore: SQLite unavailable — mini-skills are disabled (read-only empty). Install better-sqlite3 for full functionality.');
            this.warned = true;
        }
    }
    async init(_dataDir) {
        this.warn();
    }
    async loadAll() { return []; }
    async loadByProject(_projectId) { return []; }
    async loadIdCounter() { return 1; }
    async insert(_skill) { this.warn(); }
    async update(_skill) { this.warn(); }
    async remove(_id) { this.warn(); }
    async saveIdCounter(_nextId) { }
    async atomicInsertWithId(skillWithoutId) {
        this.warn();
        return { ...skillWithoutId, id: 0 };
    }
    async ensureFresh() { return false; }
    getGeneration() { return 0; }
    getBackendName() { return 'degraded'; }
}
// ── Singleton access ────────────────────────────────────────────────
let _store = null;
let _storeDataDir = null;
export function isMiniSkillStoreInitialized() {
    return _store !== null;
}
export function getMiniSkillStore() {
    if (!_store) {
        throw new Error('[memorix] MiniSkillStore not initialized — call initMiniSkillStore() first');
    }
    return _store;
}
export function resetMiniSkillStore() {
    _store = null;
    _storeDataDir = null;
}
export async function initMiniSkillStore(dataDir) {
    if (_store && _storeDataDir === dataDir)
        return _store;
    _store = null;
    _storeDataDir = null;
    // Try SQLite first
    try {
        const store = new MiniSkillSqliteStore();
        await store.init(dataDir);
        _store = store;
        _storeDataDir = dataDir;
        return store;
    }
    catch (err) {
        console.error(`[memorix] MiniSkillSqliteStore unavailable, running in degraded read-only mode: ${err instanceof Error ? err.message : err}`);
    }
    // Fallback: graceful degrade (no writable JSON backend per debt-zero rule)
    const store = new MiniSkillGracefulDegrade();
    await store.init(dataDir);
    _store = store;
    _storeDataDir = dataDir;
    return store;
}
//# sourceMappingURL=mini-skill-store.js.map