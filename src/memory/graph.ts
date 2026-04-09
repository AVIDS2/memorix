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
  /** Index: lowercase entity name → Entity for O(1) lookups */
  private entityIndex = new Map<string, Entity>();

  constructor(projectDir: string) {
    this.projectDir = projectDir;
  }

  /** Rebuild the entity name index */
  private rebuildIndex(): void {
    this.entityIndex.clear();
    for (const e of this.entities) {
      this.entityIndex.set(e.name.toLowerCase(), e);
    }
  }

  /** Load graph from disk on first access */
  async init(): Promise<void> {
    if (this.initialized) return;
    const data = await loadGraphJsonl(this.projectDir);
    this.entities = data.entities;
    this.relations = data.relations;
    this.rebuildIndex();
    this.initialized = true;
  }

  /** Find entity by name (case-insensitive, O(1)) */
  findEntityByName(name: string): Entity | undefined {
    return this.entityIndex.get(name.toLowerCase());
  }

  /** Get all entity names as a Set (lowercase, for fast membership checks) */
  getEntityNameSet(): Set<string> {
    return new Set(this.entityIndex.keys());
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
      (e) => !this.entityIndex.has(e.name.toLowerCase()),
    );
    this.entities.push(...newEntities);
    if (newEntities.length > 0) this.rebuildIndex();
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
    this.rebuildIndex();
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

  /** Get all entity names (for Formation Pipeline entity resolution) */
  getEntityNames(): string[] {
    return this.entities.map(e => e.name);
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

  // ─── Graph Search (RRF Fusion) ──────────────────────────────────

  /**
   * BFS traversal from seed entity names through graph relations.
   * Returns entity names (and hop distance) reachable within maxHops.
   *
   * Used by orama-store's searchObservations() to discover related
   * observations through the knowledge graph, which are then fused
   * into BM25+vector results via Reciprocal Rank Fusion (RRF).
   *
   * @param seedNames - Starting entity names (e.g. from BM25/vector hits)
   * @param maxHops - Maximum traversal depth (default: 2)
   * @returns Discovered entities with their hop distance from seeds
   */
  async graphSearch(
    seedNames: string[],
    maxHops = 2,
  ): Promise<{ entityName: string; hopDistance: number }[]> {
    await this.init();

    // Normalize seeds to lowercase for index lookup
    const seedSet = new Set(seedNames.map(n => n.toLowerCase()));

    // BFS state
    const visited = new Set<string>(); // lowercase entity names
    const discovered: { entityName: string; hopDistance: number }[] = [];

    // Initialize frontier with seeds that actually exist in the graph
    let frontier: string[] = []; // lowercase names
    for (const name of seedSet) {
      if (this.entityIndex.has(name)) {
        visited.add(name);
        frontier.push(name);
      }
    }

    // Pre-build adjacency: lowercase name → Set<lowercase neighbor names>
    // Relations are directed but we traverse both directions for discovery
    const adjacency = new Map<string, Set<string>>();
    for (const rel of this.relations) {
      const fromLower = rel.from.toLowerCase();
      const toLower = rel.to.toLowerCase();

      if (!adjacency.has(fromLower)) adjacency.set(fromLower, new Set());
      adjacency.get(fromLower)!.add(toLower);

      if (!adjacency.has(toLower)) adjacency.set(toLower, new Set());
      adjacency.get(toLower)!.add(fromLower);
    }

    // BFS: expand frontier hop by hop
    for (let hop = 1; hop <= maxHops; hop++) {
      const nextFrontier: string[] = [];

      for (const current of frontier) {
        const neighbors = adjacency.get(current);
        if (!neighbors) continue;

        for (const neighbor of neighbors) {
          if (visited.has(neighbor)) continue;
          visited.add(neighbor);

          // Only include if the entity actually exists in the graph
          const entity = this.entityIndex.get(neighbor);
          if (entity) {
            discovered.push({ entityName: entity.name, hopDistance: hop });
            nextFrontier.push(neighbor);
          }
        }
      }

      frontier = nextFrontier;
      if (frontier.length === 0) break; // no more to explore
    }

    return discovered;
  }

  /**
   * Get all observation IDs associated with given entity names.
   * Used to look up graph-discovered observations for RRF fusion.
   *
   * Note: Entity.observations[] contains free-text strings (not IDs).
   * Actual observation lookup by entityName must go through the
   * observations module or Orama search.
   */
  getEntitiesForNames(names: string[]): Entity[] {
    const result: Entity[] = [];
    for (const name of names) {
      const entity = this.entityIndex.get(name.toLowerCase());
      if (entity) result.push(entity);
    }
    return result;
  }
}
