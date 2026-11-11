import type { Entity, Relation, Observation } from '../types.js';

export interface EvidenceCard {
  id: number;
  title: string;
  type: string;
  entityName: string;
  why: string;
  source: string;
  sessionId?: string;
  createdAt: string;
  updatedAt?: string;
  status: string;
  verification: 'unverified' | 'verified' | 'conflicted';
  files: string[];
  relatedEntities: string[];
  correctionHistory: string[];
}

function relationNeighbors(entityName: string, relations: Relation[]): string[] {
  return [...new Set(relations.flatMap((relation) => {
    if (relation.from === entityName) return [relation.to];
    if (relation.to === entityName) return [relation.from];
    return [];
  }))].slice(0, 8);
}

/** Build bounded, operator-readable evidence cards from persisted records. */
export function buildEvidenceCards(
  observations: Observation[],
  graph: { entities: Entity[]; relations: Relation[] },
  query = '',
  limit = 20,
): EvidenceCard[] {
  const needle = query.trim().toLowerCase();
  return observations
    .filter((observation) => !needle || [observation.title, observation.narrative, observation.entityName, ...(observation.concepts ?? [])]
      .join(' ').toLowerCase().includes(needle))
    .sort((a, b) => b.id - a.id)
    .slice(0, Math.max(1, Math.min(100, limit)))
    .map((observation) => {
      const neighbors = relationNeighbors(observation.entityName, graph.relations);
      const entity = graph.entities.find((candidate) => candidate.name === observation.entityName);
      const verification = observation.status === 'resolved' ? 'verified' :
        observation.status === 'archived' ? 'conflicted' : 'unverified';
      return {
        id: observation.id,
        title: observation.title,
        type: observation.type,
        entityName: observation.entityName,
        why: entity ? 'Matched persisted entity and project-scoped evidence.' : 'Matched project-scoped memory record.',
        source: observation.sourceDetail || observation.source || 'unknown',
        ...(observation.sessionId ? { sessionId: observation.sessionId } : {}),
        createdAt: observation.createdAt,
        ...(observation.updatedAt ? { updatedAt: observation.updatedAt } : {}),
        status: observation.status || 'active',
        verification,
        files: observation.filesModified || [],
        relatedEntities: neighbors,
        correctionHistory: [],
      };
    });
}
