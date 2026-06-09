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
import type { MiniSkill } from '../types.js';
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
}
export declare class MiniSkillSqliteStore implements MiniSkillStore {
    private db;
    private dataDir;
    private knownGeneration;
    private stmtInsert;
    private stmtDelete;
    private stmtSelectAll;
    private stmtSelectByProject;
    private stmtGetMeta;
    private stmtSetMeta;
    private stmtSelectGeneration;
    private stmtBumpGeneration;
    init(dataDir: string): Promise<void>;
    private readGeneration;
    private bumpGeneration;
    private migrateFromJsonIfNeeded;
    loadAll(): Promise<MiniSkill[]>;
    loadByProject(projectId: string): Promise<MiniSkill[]>;
    loadIdCounter(): Promise<number>;
    insert(skill: MiniSkill): Promise<void>;
    update(skill: MiniSkill): Promise<void>;
    remove(id: number): Promise<void>;
    saveIdCounter(nextId: number): Promise<void>;
    /**
     * Atomic create: allocate ID + insert + bump counter in a single SQLite transaction.
     * SQLite serializes write transactions, so concurrent calls are safely sequenced.
     */
    atomicInsertWithId(skillWithoutId: Omit<MiniSkill, 'id'>): Promise<MiniSkill>;
    ensureFresh(): Promise<boolean>;
    getGeneration(): number;
    getBackendName(): 'sqlite' | 'degraded';
}
export declare class MiniSkillGracefulDegrade implements MiniSkillStore {
    private warned;
    private warn;
    init(_dataDir: string): Promise<void>;
    loadAll(): Promise<MiniSkill[]>;
    loadByProject(_projectId: string): Promise<MiniSkill[]>;
    loadIdCounter(): Promise<number>;
    insert(_skill: MiniSkill): Promise<void>;
    update(_skill: MiniSkill): Promise<void>;
    remove(_id: number): Promise<void>;
    saveIdCounter(_nextId: number): Promise<void>;
    atomicInsertWithId(skillWithoutId: Omit<MiniSkill, 'id'>): Promise<MiniSkill>;
    ensureFresh(): Promise<boolean>;
    getGeneration(): number;
    getBackendName(): 'sqlite' | 'degraded';
}
export declare function isMiniSkillStoreInitialized(): boolean;
export declare function getMiniSkillStore(): MiniSkillStore;
export declare function resetMiniSkillStore(): void;
export declare function initMiniSkillStore(dataDir: string): Promise<MiniSkillStore>;
//# sourceMappingURL=mini-skill-store.d.ts.map