export interface GraphScopeObservation {
  entityName?: string;
  relatedEntities?: string[];
  status?: string;
}

export interface ScopedKnowledgeGraph<Entity extends { name: string }, Relation extends { from: string; to: string }> {
  entities: Entity[];
  relations: Relation[];
  entityNames: Set<string>;
}

/** Return the active project entities, including explicit cross-references. */
export function projectGraphEntityNames(observations: readonly GraphScopeObservation[]): Set<string> {
  const entityNames = new Set<string>();
  for (const observation of observations) {
    if ((observation.status ?? 'active') !== 'active') continue;
    const entityName = observation.entityName?.trim();
    if (entityName) entityNames.add(entityName);
    for (const relatedEntity of observation.relatedEntities ?? []) {
      const name = relatedEntity.trim();
      if (name) entityNames.add(name);
    }
  }
  return entityNames;
}

/**
 * Give every graph surface the same project projection: active entities plus
 * explicit related entities, with only edges whose endpoints remain visible.
 */
export function scopeKnowledgeGraphToProject<
  Entity extends { name: string },
  Relation extends { from: string; to: string },
>(
  graph: { entities: readonly Entity[]; relations: readonly Relation[] },
  observations: readonly GraphScopeObservation[],
): ScopedKnowledgeGraph<Entity, Relation> {
  const entityNames = projectGraphEntityNames(observations);
  const entities = graph.entities.filter(entity => entityNames.has(entity.name));
  const visibleNames = new Set(entities.map(entity => entity.name));
  const relations = graph.relations.filter(relation =>
    visibleNames.has(relation.from) && visibleNames.has(relation.to),
  );
  return { entities, relations, entityNames };
}
