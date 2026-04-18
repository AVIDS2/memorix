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

export interface GraphStore {
  init(dataDir: string): Promise<void>;
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

export class GraphSqliteStore implements GraphStore {
  private db: any = null;
  private dataDir: string = '';

  private stmtInsertEntity: any = null;
  private stmtUpdateEntityObs: any = null;
  private stmtDeleteEntity: any = null;
  private stmtSelectAllEntities: any = null;
  private stmtSelectEntityByName: any = null;

  private stmtInsertRelation: any = null;
  private stmtDeleteRelation: any = null;
  private stmtDeleteRelationsByEntity: any = null;
  private stmtSelectAllRelations: any = null;

  async init(dataDir: string): Promise<void> {
    this.dataDir = dataDir;
    this.db = getDatabase(dataDir);

    // Prepare entity statements
    this.stmtInsertEntity = this.db.prepare(
      `INSERT OR REPLACE INTO graph_entities (name, entityType, observations) VALUES (@name, @entityType, @observations)`
    );
    this.stmtUpdateEntityObs = this.db.prepare(
      `UPDATE graph_entities SET observations = @observations WHERE name = @name`
    );
    this.stmtDeleteEntity = this.db.prepare(`DELETE FROM graph_entities WHERE name = ?`);
    this.stmtSelectAllEntities = this.db.prepare(`SELECT * FROM graph_entities`);
    this.stmtSelectEntityByName = this.db.prepare(`SELECT * FROM graph_entities WHERE name = ?`);

    // Prepare relation statements
    this.stmtInsertRelation = this.db.prepare(
      `INSERT OR IGNORE INTO graph_relations (from_entity, to_entity, relationType) VALUES (@from, @to, @relationType)`
    );
    this.stmtDeleteRelation = this.db.prepare(
      `DELETE FROM graph_relations WHERE from_entity = ? AND to_entity = ? AND relationType = ?`
    );
    this.stmtDeleteRelationsByEntity = this.db.prepare(
      `DELETE FROM graph_relations WHERE from_entity = ? OR to_entity = ?`
    );
    this.stmtSelectAllRelations = this.db.prepare(`SELECT * FROM graph_relations`);

    // One-time migration from graph.jsonl
    await this.migrateFromJsonlIfNeeded();
  }

  private async migrateFromJsonlIfNeeded(): Promise<void> {
    const count = this.db.prepare(`SELECT COUNT(*) AS cnt FROM graph_entities`).get();
    if (count.cnt > 0) return;

    const jsonlPath = path.join(this.dataDir, 'graph.jsonl');
    if (!fs.existsSync(jsonlPath)) return;

    try {
      const data = await loadGraphJsonl(this.dataDir);
      if (data.entities.length === 0 && data.relations.length === 0) return;

      console.error(`[memorix] Migrating graph from JSONL to SQLite (${data.entities.length} entities, ${data.relations.length} relations)...`);

      const insertAll = this.db.transaction(() => {
        for (const entity of data.entities) {
          this.stmtInsertEntity.run(entityToRow(entity));
        }
        for (const rel of data.relations) {
          this.stmtInsertRelation.run({ from: rel.from, to: rel.to, relationType: rel.relationType });
        }
      });
      insertAll();

      console.error(`[memorix] Graph migration complete.`);
    } catch (err) {
      console.error(`[memorix] Graph JSONL->SQLite migration failed (non-fatal): ${err}`);
    }
  }

  loadEntities(): Entity[] {
    return this.stmtSelectAllEntities.all().map(rowToEntity);
  }

  loadRelations(): Relation[] {
    return this.stmtSelectAllRelations.all().map((row: any) => ({
      from: row.from_entity,
      to: row.to_entity,
      relationType: row.relationType,
    }));
  }

  insertEntities(entities: Entity[]): void {
    const insertAll = this.db.transaction(() => {
      for (const entity of entities) {
        this.stmtInsertEntity.run(entityToRow(entity));
      }
    });
    insertAll();
  }

  insertRelations(relations: Relation[]): void {
    const insertAll = this.db.transaction(() => {
      for (const rel of relations) {
        this.stmtInsertRelation.run({ from: rel.from, to: rel.to, relationType: rel.relationType });
      }
    });
    insertAll();
  }

  deleteEntities(names: string[]): void {
    const deleteAll = this.db.transaction(() => {
      for (const name of names) {
        this.stmtDeleteRelationsByEntity.run(name, name);
        this.stmtDeleteEntity.run(name);
      }
    });
    deleteAll();
  }

  deleteRelations(relations: Relation[]): void {
    const deleteAll = this.db.transaction(() => {
      for (const rel of relations) {
        this.stmtDeleteRelation.run(rel.from, rel.to, rel.relationType);
      }
    });
    deleteAll();
  }

  addObservations(updates: { entityName: string; contents: string[] }[]): void {
    const updateAll = this.db.transaction(() => {
      for (const u of updates) {
        const row = this.stmtSelectEntityByName.get(u.entityName);
        if (!row) continue;
        const existing: string[] = safeJsonParse(row.observations, []);
        const newObs = u.contents.filter(c => !existing.includes(c));
        if (newObs.length > 0) {
          existing.push(...newObs);
          this.stmtUpdateEntityObs.run({ name: u.entityName, observations: JSON.stringify(existing) });
        }
      }
    });
    updateAll();
  }

  deleteObservations(deletions: { entityName: string; observations: string[] }[]): void {
    const deleteAll = this.db.transaction(() => {
      for (const d of deletions) {
        const row = this.stmtSelectEntityByName.get(d.entityName);
        if (!row) continue;
        const existing: string[] = safeJsonParse(row.observations, []);
        const filtered = existing.filter(o => !d.observations.includes(o));
        this.stmtUpdateEntityObs.run({ name: d.entityName, observations: JSON.stringify(filtered) });
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
      this.db.prepare('DELETE FROM graph_relations').run();
      this.db.prepare('DELETE FROM graph_entities').run();
      for (const entity of entities) {
        this.stmtInsertEntity.run(entityToRow(entity));
      }
      for (const rel of relations) {
        this.stmtInsertRelation.run({ from: rel.from, to: rel.to, relationType: rel.relationType });
      }
    });
    replaceAll();
  }

  close(): void {
    // DB handle is managed by sqlite-db singleton — nothing to close here
  }
}

// ── Singleton ──────────────────────────────────────────────────────

let _graphStore: GraphSqliteStore | null = null;
let _graphDataDir: string | null = null;

export async function initGraphStore(dataDir: string): Promise<GraphSqliteStore> {
  if (_graphStore && _graphDataDir === dataDir) return _graphStore;
  _graphStore = new GraphSqliteStore();
  await _graphStore.init(dataDir);
  _graphDataDir = dataDir;
  return _graphStore;
}

export function getGraphStore(): GraphSqliteStore {
  if (!_graphStore) throw new Error('[memorix] GraphStore not initialized — call initGraphStore() first');
  return _graphStore;
}

export function resetGraphStore(): void {
  if (_graphStore) {
    try { _graphStore.close(); } catch { /* best-effort */ }
  }
  _graphStore = null;
  _graphDataDir = null;
}
