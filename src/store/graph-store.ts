/**
 * GraphSqliteStore — SQLite-backed knowledge graph store.
 *
 * Replaces graph.jsonl as the canonical runtime graph store.
 * graph.jsonl is now only a migration source / export artifact.
 */

import type { Entity, Relation } from '../types.js';
import { getDatabase } from './sqlite-db.js';
import { loadGraphJsonl } from './persistence.js';
import path from 'node:path';
import fs from 'node:fs';

export const DEFAULT_GRAPH_PROJECT_ID = '__default__';
const LEGACY_GRAPH_PROJECT_ID = '__legacy__';
const MAX_GRAPH_STORE_CACHE = 32;

export interface GraphStore {
  init(dataDir: string, projectId?: string): Promise<void>;
  loadEntities(): Entity[];
  loadRelations(): Relation[];
  insertEntities(entities: Entity[]): void;
  insertRelations(relations: Relation[]): void;
  deleteEntities(names: string[]): void;
  deleteRelations(relations: Relation[]): void;
  addObservations(updates: { entityName: string; contents: string[] }[]): void;
  deleteObservations(deletions: { entityName: string; observations: string[] }[]): void;
  replaceAll(entities: Entity[], relations: Relation[]): void;
  close(): void;
}

function safeJsonParse(val: string | null | undefined, fallback: any): any {
  if (val == null || val === '') return fallback;
  try { return JSON.parse(val); } catch { return fallback; }
}

function rowToEntity(row: any): Entity {
  return {
    name: row.name,
    entityType: row.entityType || '',
    observations: safeJsonParse(row.observations, []),
  };
}

function entityToRow(entity: Entity): Record<string, unknown> {
  return {
    name: entity.name,
    entityType: entity.entityType || '',
    observations: JSON.stringify(entity.observations ?? []),
  };
}

const CREATE_SCOPED_GRAPH_ENTITIES = `
CREATE TABLE IF NOT EXISTS graph_entities (
  projectId       TEXT NOT NULL,
  name            TEXT NOT NULL,
  entityType      TEXT NOT NULL DEFAULT '',
  observations    TEXT NOT NULL DEFAULT '[]',
  PRIMARY KEY (projectId, name)
);`;

const CREATE_SCOPED_GRAPH_RELATIONS = `
CREATE TABLE IF NOT EXISTS graph_relations (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  projectId       TEXT NOT NULL,
  from_entity     TEXT NOT NULL,
  to_entity       TEXT NOT NULL,
  relationType    TEXT NOT NULL DEFAULT '',
  UNIQUE(projectId, from_entity, to_entity, relationType)
);`;

function ensureScopedGraphSchema(db: any): void {
  const entityColumns = db.prepare('PRAGMA table_info(graph_entities)').all() as Array<{ name: string }>;
  if (!entityColumns.some((column) => column.name === 'projectId')) {
    const migrate = db.transaction(() => {
      db.exec('ALTER TABLE graph_entities RENAME TO graph_entities_legacy_unscoped');
      db.exec(CREATE_SCOPED_GRAPH_ENTITIES);
      db.exec(`INSERT INTO graph_entities (projectId, name, entityType, observations)
        SELECT '${LEGACY_GRAPH_PROJECT_ID}', name, entityType, observations
        FROM graph_entities_legacy_unscoped`);
      db.exec('DROP TABLE graph_entities_legacy_unscoped');
    });
    migrate();
  } else {
    db.exec(CREATE_SCOPED_GRAPH_ENTITIES);
  }

  const relationColumns = db.prepare('PRAGMA table_info(graph_relations)').all() as Array<{ name: string }>;
  if (!relationColumns.some((column) => column.name === 'projectId')) {
    const migrate = db.transaction(() => {
      db.exec('ALTER TABLE graph_relations RENAME TO graph_relations_legacy_unscoped');
      db.exec(CREATE_SCOPED_GRAPH_RELATIONS);
      db.exec(`INSERT INTO graph_relations (projectId, from_entity, to_entity, relationType)
        SELECT '${LEGACY_GRAPH_PROJECT_ID}', from_entity, to_entity, relationType
        FROM graph_relations_legacy_unscoped`);
      db.exec('DROP TABLE graph_relations_legacy_unscoped');
    });
    migrate();
  } else {
    db.exec(CREATE_SCOPED_GRAPH_RELATIONS);
  }
}

export class GraphSqliteStore implements GraphStore {
  private db: any = null;
  private dataDir: string = '';
  private projectId = DEFAULT_GRAPH_PROJECT_ID;

  private stmtInsertEntity: any = null;
  private stmtUpdateEntityObs: any = null;
  private stmtDeleteEntity: any = null;
  private stmtSelectAllEntities: any = null;
  private stmtSelectEntityByName: any = null;

  private stmtInsertRelation: any = null;
  private stmtDeleteRelation: any = null;
  private stmtDeleteRelationsByEntity: any = null;
  private stmtSelectAllRelations: any = null;

  async init(dataDir: string, projectId = DEFAULT_GRAPH_PROJECT_ID): Promise<void> {
    this.dataDir = dataDir;
    this.projectId = projectId;
    this.db = getDatabase(dataDir);
    ensureScopedGraphSchema(this.db);

    // Prepare entity statements
    this.stmtInsertEntity = this.db.prepare(
      `INSERT OR REPLACE INTO graph_entities (projectId, name, entityType, observations) VALUES (@projectId, @name, @entityType, @observations)`
    );
    this.stmtUpdateEntityObs = this.db.prepare(
      `UPDATE graph_entities SET observations = @observations WHERE projectId = @projectId AND name = @name`
    );
    this.stmtDeleteEntity = this.db.prepare(`DELETE FROM graph_entities WHERE projectId = ? AND name = ?`);
    this.stmtSelectAllEntities = this.db.prepare(`SELECT * FROM graph_entities WHERE projectId = ? ORDER BY name`);
    this.stmtSelectEntityByName = this.db.prepare(`SELECT * FROM graph_entities WHERE projectId = ? AND name = ?`);

    // Prepare relation statements
    this.stmtInsertRelation = this.db.prepare(
      `INSERT OR IGNORE INTO graph_relations (projectId, from_entity, to_entity, relationType) VALUES (@projectId, @from, @to, @relationType)`
    );
    this.stmtDeleteRelation = this.db.prepare(
      `DELETE FROM graph_relations WHERE projectId = ? AND from_entity = ? AND to_entity = ? AND relationType = ?`
    );
    this.stmtDeleteRelationsByEntity = this.db.prepare(
      `DELETE FROM graph_relations WHERE projectId = ? AND (from_entity = ? OR to_entity = ?)`
    );
    this.stmtSelectAllRelations = this.db.prepare(`SELECT * FROM graph_relations WHERE projectId = ? ORDER BY id`);

    // One-time migration from graph.jsonl
    await this.migrateFromJsonlIfNeeded();
  }

  private async migrateFromJsonlIfNeeded(): Promise<void> {
    const count = this.db.prepare(`SELECT COUNT(*) AS cnt FROM graph_entities WHERE projectId = ?`).get(this.projectId);
    const totalCount = this.db.prepare(`SELECT COUNT(*) AS cnt FROM graph_entities`).get();
    if (count.cnt > 0) return;
    if (totalCount.cnt > 0) return;

    const jsonlPath = path.join(this.dataDir, 'graph.jsonl');
    if (!fs.existsSync(jsonlPath)) return;

    try {
      const data = await loadGraphJsonl(this.dataDir);
      if (data.entities.length === 0 && data.relations.length === 0) return;

      console.error(`[memorix] Migrating graph from JSONL to SQLite (${data.entities.length} entities, ${data.relations.length} relations)...`);

      const observations = this.db.prepare('SELECT id, projectId FROM observations').all() as Array<{ id: number; projectId: string }>;
      const projectByObservationId = new Map(observations.map((row) => [row.id, row.projectId]));
      const projectsByEntity = new Map<string, Set<string>>();
      for (const entity of data.entities) {
        const projects = new Set<string>();
        for (const content of entity.observations ?? []) {
          const match = /^\[#(\d+)\]/.exec(content);
          const projectId = match ? projectByObservationId.get(Number(match[1])) : undefined;
          if (projectId) projects.add(projectId);
        }
        projectsByEntity.set(entity.name, projects);
      }

      // Legacy graph.jsonl had no project column. Recover the ownership that
      // can be proven from observation references, then propagate it through
      // unambiguous relation endpoints. A relation crossing two projects is
      // intentionally quarantined instead of leaking into both views.
      let changed = true;
      while (changed) {
        changed = false;
        for (const relation of data.relations) {
          const from = projectsByEntity.get(relation.from) ?? new Set<string>();
          const to = projectsByEntity.get(relation.to) ?? new Set<string>();
          if (from.size > 0 && to.size === 0) {
            projectsByEntity.set(relation.to, new Set(from));
            changed = true;
          } else if (to.size > 0 && from.size === 0) {
            projectsByEntity.set(relation.from, new Set(to));
            changed = true;
          }
        }
      }

      const entityRows = data.entities.flatMap((entity) => {
        const projects = projectsByEntity.get(entity.name) ?? new Set<string>();
        const owners = projects.size > 0 ? [...projects] : [this.projectId];
        return owners.map((projectId) => ({ ...entityToRow(entity), projectId }));
      });
      const projectSet = new Set(entityRows.map((row) => String(row.projectId)));
      const relationRows = data.relations.flatMap((relation) => {
        const from = projectsByEntity.get(relation.from) ?? new Set<string>();
        const to = projectsByEntity.get(relation.to) ?? new Set<string>();
        const shared = [...from].filter((projectId) => to.has(projectId));
        const owners = shared.length > 0
          ? shared
          : from.size === 0 && to.size === 0
            ? [this.projectId]
            : [];
        return owners
          .filter((projectId) => projectSet.has(projectId))
          .map((projectId) => ({ projectId, from: relation.from, to: relation.to, relationType: relation.relationType }));
      });

      const insertAll = this.db.transaction(() => {
        for (const entity of entityRows) {
          this.stmtInsertEntity.run(entity);
        }
        for (const relation of relationRows) {
          this.stmtInsertRelation.run(relation);
        }
      });
      insertAll();

      console.error(`[memorix] Graph migration complete.`);
    } catch (err) {
      console.error(`[memorix] Graph JSONL->SQLite migration failed (non-fatal): ${err}`);
    }
  }

  loadEntities(): Entity[] {
    return this.stmtSelectAllEntities.all(this.projectId).map(rowToEntity);
  }

  loadRelations(): Relation[] {
    return this.stmtSelectAllRelations.all(this.projectId).map((row: any) => ({
      from: row.from_entity,
      to: row.to_entity,
      relationType: row.relationType,
    }));
  }

  insertEntities(entities: Entity[]): void {
    const insertAll = this.db.transaction(() => {
      for (const entity of entities) {
        this.stmtInsertEntity.run({ ...entityToRow(entity), projectId: this.projectId });
      }
    });
    insertAll();
  }

  insertRelations(relations: Relation[]): void {
    const insertAll = this.db.transaction(() => {
      for (const rel of relations) {
        this.stmtInsertRelation.run({ projectId: this.projectId, from: rel.from, to: rel.to, relationType: rel.relationType });
      }
    });
    insertAll();
  }

  deleteEntities(names: string[]): void {
    const deleteAll = this.db.transaction(() => {
      for (const name of names) {
        this.stmtDeleteRelationsByEntity.run(this.projectId, name, name);
        this.stmtDeleteEntity.run(this.projectId, name);
      }
    });
    deleteAll();
  }

  deleteRelations(relations: Relation[]): void {
    const deleteAll = this.db.transaction(() => {
      for (const rel of relations) {
        this.stmtDeleteRelation.run(this.projectId, rel.from, rel.to, rel.relationType);
      }
    });
    deleteAll();
  }

  addObservations(updates: { entityName: string; contents: string[] }[]): void {
    const updateAll = this.db.transaction(() => {
      for (const u of updates) {
        const row = this.stmtSelectEntityByName.get(this.projectId, u.entityName);
        if (!row) continue;
        const existing: string[] = safeJsonParse(row.observations, []);
        const newObs = u.contents.filter(c => !existing.includes(c));
        if (newObs.length > 0) {
          existing.push(...newObs);
          this.stmtUpdateEntityObs.run({ projectId: this.projectId, name: u.entityName, observations: JSON.stringify(existing) });
        }
      }
    });
    updateAll();
  }

  deleteObservations(deletions: { entityName: string; observations: string[] }[]): void {
    const deleteAll = this.db.transaction(() => {
      for (const d of deletions) {
        const row = this.stmtSelectEntityByName.get(this.projectId, d.entityName);
        if (!row) continue;
        const existing: string[] = safeJsonParse(row.observations, []);
        const filtered = existing.filter(o => !d.observations.includes(o));
        this.stmtUpdateEntityObs.run({ projectId: this.projectId, name: d.entityName, observations: JSON.stringify(filtered) });
      }
    });
    deleteAll();
  }

  /**
   * Atomically replace all entities and relations.
   * Used by KnowledgeGraphManager.save() for full-state persistence.
   */
  replaceAll(entities: Entity[], relations: Relation[]): void {
    const replaceAll = this.db.transaction(() => {
      this.db.prepare('DELETE FROM graph_relations WHERE projectId = ?').run(this.projectId);
      this.db.prepare('DELETE FROM graph_entities WHERE projectId = ?').run(this.projectId);
      for (const entity of entities) {
        this.stmtInsertEntity.run({ ...entityToRow(entity), projectId: this.projectId });
      }
      for (const rel of relations) {
        this.stmtInsertRelation.run({ projectId: this.projectId, from: rel.from, to: rel.to, relationType: rel.relationType });
      }
    });
    replaceAll();
  }

  close(): void {
    // DB handle is managed by sqlite-db singleton — nothing to close here
  }
}

// ── Singleton ──────────────────────────────────────────────────────

const _graphStores = new Map<string, GraphSqliteStore>();
let _activeGraphKey: string | null = null;

function graphStoreKey(dataDir: string, projectId: string): string {
  return `${path.resolve(dataDir)}\0${projectId}`;
}

export async function initGraphStore(dataDir: string, projectId = DEFAULT_GRAPH_PROJECT_ID): Promise<GraphSqliteStore> {
  const key = graphStoreKey(dataDir, projectId);
  const existing = _graphStores.get(key);
  if (existing) {
    _graphStores.delete(key);
    _graphStores.set(key, existing);
    _activeGraphKey = key;
    return existing;
  }
  const store = new GraphSqliteStore();
  await store.init(dataDir, projectId);
  _graphStores.set(key, store);
  while (_graphStores.size > MAX_GRAPH_STORE_CACHE) {
    const oldest = _graphStores.keys().next().value as string | undefined;
    if (!oldest) break;
    _graphStores.delete(oldest);
  }
  _activeGraphKey = key;
  return store;
}

export function getGraphStore(dataDir?: string, projectId?: string): GraphSqliteStore {
  const key = dataDir && projectId ? graphStoreKey(dataDir, projectId) : _activeGraphKey;
  const store = key ? _graphStores.get(key) : undefined;
  if (!store) throw new Error('[memorix] GraphStore not initialized — call initGraphStore() first');
  return store;
}

export function resetGraphStore(): void {
  for (const store of _graphStores.values()) {
    try { store.close(); } catch { /* best-effort */ }
  }
  _graphStores.clear();
  _activeGraphKey = null;
}
