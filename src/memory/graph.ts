/**
 * Knowledge Graph Manager
 *
 * Manages the Entity-Relation knowledge graph.
 * Source: MCP Official Memory Server v0.6.3 (complete rewrite with same API).
 *
 * Key differences from official implementation:
 * - Uses per-project JSONL files (official uses single file)
 * - Async initialization with persistence layer
 * - Project-scoped operations
 */

import type { Entity, Relation, KnowledgeGraph } from '../types.js';
import { saveGraphJsonl, loadGraphJsonl } from '../store/persistence.js';
import { withFileLock } from '../store/file-lock.js';

export class KnowledgeGraphManager {
  private entities: Entity[] = [];
  private relations: Relation[] = [];
  private projectDir: string;
  private initialized = false;

  constructor(projectDir: string) {
    this.projectDir = projectDir;
  }

  /** Load graph from disk on first access */
  async init(): Promise<void> {
    if (this.initialized) return;
    const data = await loadGraphJsonl(this.projectDir);
    this.entities = data.entities;
    this.relations = data.relations;
    this.initialized = true;
  }

  /** Persist current state to disk with file lock (cross-process safe) */
  private async save(): Promise<void> {
    await withFileLock(this.projectDir, async () => {
      await saveGraphJsonl(this.projectDir, this.entities, this.relations);
    });
  }

  /** Create new entities (skip duplicates by name) */
  async createEntities(entities: Entity[]): Promise<Entity[]> {
    await this.init();
    const newEntities = entities.filter(
      (e) => !this.entities.some((existing) => existing.name === e.name),
    );
    this.entities.push(...newEntities);
    await this.save();
    return newEntities;
  }

  /** Create new relations (skip duplicates) */
  async createRelations(relations: Relation[]): Promise<Relation[]> {
    await this.init();
    const newRelations = relations.filter(
      (r) =>
        !this.relations.some(
          (existing) =>
            existing.from === r.from &&
            existing.to === r.to &&
            existing.relationType === r.relationType,
        ),
    );
    this.relations.push(...newRelations);
    await this.save();
    return newRelations;
  }

  /** Add observations to existing entities */
  async addObservations(
    observations: { entityName: string; contents: string[] }[],
  ): Promise<{ entityName: string; addedObservations: string[] }[]> {
    await this.init();
    const results = observations.map((o) => {
      const entity = this.entities.find((e) => e.name === o.entityName);
      if (!entity) {
        throw new Error(`Entity with name ${o.entityName} not found`);
      }
      const newObs = o.contents.filter((c) => !entity.observations.includes(c));
      entity.observations.push(...newObs);
      return { entityName: o.entityName, addedObservations: newObs };
    });
    await this.save();
    return results;
  }

  /** Delete entities and their associated relations */
  async deleteEntities(entityNames: string[]): Promise<void> {
    await this.init();
    this.entities = this.entities.filter((e) => !entityNames.includes(e.name));
    this.relations = this.relations.filter(
      (r) => !entityNames.includes(r.from) && !entityNames.includes(r.to),
    );
    await this.save();
  }

  /** Delete specific observations from entities */
  async deleteObservations(
    deletions: { entityName: string; observations: string[] }[],
  ): Promise<void> {
    await this.init();
    for (const d of deletions) {
      const entity = this.entities.find((e) => e.name === d.entityName);
      if (entity) {
        entity.observations = entity.observations.filter(
          (o) => !d.observations.includes(o),
        );
      }
    }
    await this.save();
  }

  /** Delete specific relations */
  async deleteRelations(relations: Relation[]): Promise<void> {
    await this.init();
    this.relations = this.relations.filter(
      (r) =>
        !relations.some(
          (del) =>
            r.from === del.from &&
            r.to === del.to &&
            r.relationType === del.relationType,
        ),
    );
    await this.save();
  }

  /** Read the entire graph */
  async readGraph(): Promise<KnowledgeGraph> {
    await this.init();
    return { entities: this.entities, relations: this.relations };
  }

  /** Search nodes by query string (upgraded from official's basic includes) */
  async searchNodes(query: string): Promise<KnowledgeGraph> {
    await this.init();
    const lowerQuery = query.toLowerCase();

    const filteredEntities = this.entities.filter(
      (e) =>
        e.name.toLowerCase().includes(lowerQuery) ||
        e.entityType.toLowerCase().includes(lowerQuery) ||
        e.observations.some((o) => o.toLowerCase().includes(lowerQuery)),
    );

    const filteredNames = new Set(filteredEntities.map((e) => e.name));

    const filteredRelations = this.relations.filter(
      (r) => filteredNames.has(r.from) && filteredNames.has(r.to),
    );

    return { entities: filteredEntities, relations: filteredRelations };
  }

  /** Open specific nodes by name */
  async openNodes(names: string[]): Promise<KnowledgeGraph> {
    await this.init();

    const filteredEntities = this.entities.filter((e) => names.includes(e.name));
    const filteredNames = new Set(filteredEntities.map((e) => e.name));

    const filteredRelations = this.relations.filter(
      (r) => filteredNames.has(r.from) && filteredNames.has(r.to),
    );

    return { entities: filteredEntities, relations: filteredRelations };
  }
}
