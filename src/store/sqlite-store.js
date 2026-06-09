/**
 * SqliteBackend — ObservationStore implementation backed by better-sqlite3.
 *
 * Features:
 *   - WAL mode for concurrent read performance
 *   - storage_generation counter for cross-process freshness detection
 *   - next_id counter in meta table (replaces counter.json)
 *   - One-time migration from observations.json on first init
 *   - Dynamic require of better-sqlite3 (optionalDependencies)
 *
 * Array fields (facts, filesModified, concepts, relatedCommits, relatedEntities)
 * are stored as JSON strings in SQLite columns.
 *
 * Uses the shared database handle from sqlite-db.ts so that observations,
 * mini-skills, and sessions all share one connection and one DB file.
 */
import { getDatabase } from './sqlite-db.js';
import path from 'node:path';
import fs from 'node:fs';
// ── Row ↔ Observation serialization ────────────────────────────────
function obsToRow(obs) {
    return {
        id: obs.id,
        entityName: obs.entityName,
        type: obs.type,
        title: obs.title,
        narrative: obs.narrative,
        facts: JSON.stringify(obs.facts ?? []),
        filesModified: JSON.stringify(obs.filesModified ?? []),
        concepts: JSON.stringify(obs.concepts ?? []),
        tokens: obs.tokens ?? 0,
        createdAt: obs.createdAt,
        updatedAt: obs.updatedAt ?? null,
        projectId: obs.projectId,
        hasCausalLanguage: obs.hasCausalLanguage ? 1 : 0,
        topicKey: obs.topicKey ?? null,
        revisionCount: obs.revisionCount ?? 1,
        sessionId: obs.sessionId ?? null,
        status: obs.status ?? 'active',
        progress: obs.progress ? JSON.stringify(obs.progress) : null,
        source: obs.source ?? 'agent',
        commitHash: obs.commitHash ?? null,
        relatedCommits: obs.relatedCommits ? JSON.stringify(obs.relatedCommits) : null,
        relatedEntities: obs.relatedEntities ? JSON.stringify(obs.relatedEntities) : null,
        sourceDetail: obs.sourceDetail ?? null,
        valueCategory: obs.valueCategory ?? null,
        createdByAgentId: obs.createdByAgentId ?? null,
        writeGeneration: obs.writeGeneration ?? 0,
    };
}
function rowToObs(row) {
    return {
        id: row.id,
        entityName: row.entityName,
        type: row.type,
        title: row.title,
        narrative: row.narrative,
        facts: safeJsonParse(row.facts, []),
        filesModified: safeJsonParse(row.filesModified, []),
        concepts: safeJsonParse(row.concepts, []),
        tokens: row.tokens,
        createdAt: row.createdAt,
        ...(row.updatedAt ? { updatedAt: row.updatedAt } : {}),
        projectId: row.projectId,
        hasCausalLanguage: !!row.hasCausalLanguage,
        ...(row.topicKey ? { topicKey: row.topicKey } : {}),
        revisionCount: row.revisionCount ?? 1,
        ...(row.sessionId ? { sessionId: row.sessionId } : {}),
        status: row.status ?? 'active',
        ...(row.progress ? { progress: safeJsonParse(row.progress, undefined) } : {}),
        ...(row.source ? { source: row.source } : {}),
        ...(row.commitHash ? { commitHash: row.commitHash } : {}),
        ...(row.relatedCommits ? { relatedCommits: safeJsonParse(row.relatedCommits, []) } : {}),
        ...(row.relatedEntities ? { relatedEntities: safeJsonParse(row.relatedEntities, []) } : {}),
        ...(row.sourceDetail ? { sourceDetail: row.sourceDetail } : {}),
        ...(row.valueCategory ? { valueCategory: row.valueCategory } : {}),
        ...(row.createdByAgentId ? { createdByAgentId: row.createdByAgentId } : {}),
        ...(row.writeGeneration ? { writeGeneration: row.writeGeneration } : {}),
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
// ── SqliteBackend ──────────────────────────────────────────────────
export class SqliteBackend {
    db = null;
    dataDir = '';
    knownGeneration = 0;
    // Async mutex for serializing atomic() calls on the single connection
    _atomicQueue = Promise.resolve();
    // Prepared statements (lazy-initialized after db open)
    stmtInsert = null;
    stmtUpdate = null;
    stmtDelete = null;
    stmtSelectAll = null;
    stmtSelectGeneration = null;
    stmtBumpGeneration = null;
    stmtGetMeta = null;
    stmtSetMeta = null;
    async init(dataDir) {
        this.dataDir = dataDir;
        // Use shared database handle (opens DB, creates all tables, sets pragmas)
        this.db = getDatabase(dataDir);
        // Prepare statements
        this.stmtInsert = this.db.prepare(`
      INSERT OR REPLACE INTO observations
        (id, entityName, type, title, narrative, facts, filesModified, concepts, tokens,
         createdAt, updatedAt, projectId, hasCausalLanguage, topicKey, revisionCount,
         sessionId, status, progress, source, commitHash, relatedCommits, relatedEntities,
         sourceDetail, valueCategory, createdByAgentId, writeGeneration)
      VALUES
        (@id, @entityName, @type, @title, @narrative, @facts, @filesModified, @concepts, @tokens,
         @createdAt, @updatedAt, @projectId, @hasCausalLanguage, @topicKey, @revisionCount,
         @sessionId, @status, @progress, @source, @commitHash, @relatedCommits, @relatedEntities,
         @sourceDetail, @valueCategory, @createdByAgentId, @writeGeneration)
    `);
        this.stmtUpdate = this.stmtInsert; // INSERT OR REPLACE works for both
        this.stmtDelete = this.db.prepare(`DELETE FROM observations WHERE id = ?`);
        this.stmtSelectAll = this.db.prepare(`SELECT * FROM observations`);
        this.stmtSelectGeneration = this.db.prepare(`SELECT value FROM meta WHERE key = 'storage_generation'`);
        this.stmtBumpGeneration = this.db.prepare(`UPDATE meta SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT) WHERE key = 'storage_generation'`);
        this.stmtGetMeta = this.db.prepare(`SELECT value FROM meta WHERE key = ?`);
        this.stmtSetMeta = this.db.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)`);
        // Read initial generation
        this.knownGeneration = this.readGeneration();
        // Migration: if observations table is empty but observations.json exists, import
        await this.migrateFromJsonIfNeeded();
    }
    // ── Internal helpers ─────────────────────────────────────────────
    readGeneration() {
        const row = this.stmtSelectGeneration.get();
        return row ? parseInt(row.value, 10) : 0;
    }
    bumpGeneration() {
        this.stmtBumpGeneration.run();
        this.knownGeneration = this.readGeneration();
    }
    rawLoadAll() {
        const rows = this.stmtSelectAll.all();
        return rows.map(rowToObs);
    }
    rawLoadIdCounter() {
        const row = this.stmtGetMeta.get('next_id');
        return row ? parseInt(row.value, 10) : 1;
    }
    rawSaveIdCounter(nextId) {
        this.stmtSetMeta.run('next_id', String(nextId));
    }
    // ── Migration ────────────────────────────────────────────────────
    async migrateFromJsonIfNeeded() {
        // Only migrate if table is empty
        const count = this.db.prepare(`SELECT COUNT(*) AS cnt FROM observations`).get();
        if (count.cnt > 0)
            return;
        const jsonPath = path.join(this.dataDir, 'observations.json');
        if (!fs.existsSync(jsonPath))
            return;
        try {
            const raw = fs.readFileSync(jsonPath, 'utf-8');
            const observations = JSON.parse(raw);
            if (observations.length === 0)
                return;
            console.error(`[memorix] Migrating ${observations.length} observations from JSON to SQLite...`);
            const insertMany = this.db.transaction((obsList) => {
                for (const obs of obsList) {
                    this.stmtInsert.run(obsToRow(obs));
                }
            });
            insertMany(observations);
            // Migrate counter
            const counterPath = path.join(this.dataDir, 'counter.json');
            if (fs.existsSync(counterPath)) {
                try {
                    const counterData = JSON.parse(fs.readFileSync(counterPath, 'utf-8'));
                    const nextId = counterData.nextId ?? counterData.next_id ?? (Math.max(...observations.map(o => o.id)) + 1);
                    this.rawSaveIdCounter(nextId);
                }
                catch {
                    // Fallback: derive from max observation ID
                    this.rawSaveIdCounter(Math.max(...observations.map(o => o.id)) + 1);
                }
            }
            else {
                this.rawSaveIdCounter(Math.max(...observations.map(o => o.id)) + 1);
            }
            this.bumpGeneration();
            console.error(`[memorix] Migration complete. ${observations.length} observations now in SQLite.`);
        }
        catch (err) {
            console.error(`[memorix] JSON→SQLite migration failed (non-fatal, data preserved in JSON): ${err}`);
        }
    }
    // ── Public read ──────────────────────────────────────────────────
    async loadAll() {
        return this.rawLoadAll();
    }
    async loadIdCounter() {
        return this.rawLoadIdCounter();
    }
    // ── Public write (each bumps generation) ─────────────────────────
    async insert(obs) {
        this.stmtInsert.run(obsToRow(obs));
        this.bumpGeneration();
    }
    async update(obs) {
        this.stmtUpdate.run(obsToRow(obs));
        this.bumpGeneration();
    }
    async remove(id) {
        this.stmtDelete.run(id);
        this.bumpGeneration();
    }
    async bulkReplace(obs) {
        const run = this.db.transaction((obsList) => {
            this.db.prepare(`DELETE FROM observations`).run();
            for (const o of obsList) {
                this.stmtInsert.run(obsToRow(o));
            }
        });
        run(obs);
        this.bumpGeneration();
    }
    async bulkRemoveByIds(ids) {
        if (ids.length === 0)
            return;
        const run = this.db.transaction((idList) => {
            const stmt = this.db.prepare(`DELETE FROM observations WHERE id = ?`);
            for (const id of idList) {
                stmt.run(id);
            }
        });
        run(ids);
        this.bumpGeneration();
    }
    async saveIdCounter(nextId) {
        this.rawSaveIdCounter(nextId);
    }
    // ── Compound atomic operation ────────────────────────────────────
    async atomic(fn) {
        // Serialize concurrent atomic() calls via an async queue.
        // better-sqlite3 is single-connection; nested BEGIN is illegal.
        const run = this._atomicQueue
            .catch(() => undefined)
            .then(async () => {
            this.db.prepare('BEGIN IMMEDIATE').run();
            try {
                const tx = {
                    loadAll: async () => this.rawLoadAll(),
                    loadIdCounter: async () => this.rawLoadIdCounter(),
                    saveAll: async (obs) => {
                        this.db.prepare(`DELETE FROM observations`).run();
                        for (const o of obs) {
                            this.stmtInsert.run(obsToRow(o));
                        }
                    },
                    saveIdCounter: async (nextId) => this.rawSaveIdCounter(nextId),
                };
                const result = await fn(tx);
                this.bumpGeneration();
                this.db.prepare('COMMIT').run();
                return result;
            }
            catch (err) {
                try {
                    this.db.prepare('ROLLBACK').run();
                }
                catch { /* already rolled back */ }
                throw err;
            }
        });
        // Keep the queue alive after failures so one bad transaction does not poison
        // all future atomic() calls.
        this._atomicQueue = run.catch(() => undefined);
        return run;
    }
    // ── Freshness ────────────────────────────────────────────────────
    async ensureFresh() {
        const remoteGen = this.readGeneration();
        if (remoteGen > this.knownGeneration) {
            this.knownGeneration = remoteGen;
            return true; // caller should reload observations[] + rebuild Orama
        }
        return false;
    }
    getGeneration() {
        return this.knownGeneration;
    }
    // ── Diagnostics ──────────────────────────────────────────────────
    close() {
        // Detach from the shared handle without closing it — other stores
        // (MiniSkillSqliteStore, SessionSqliteStore) may still be using it.
        // Use closeDatabase(dataDir) or closeAllDatabases() for full shutdown.
        this.db = null;
    }
    getBackendName() {
        return 'sqlite';
    }
}
//# sourceMappingURL=sqlite-store.js.map