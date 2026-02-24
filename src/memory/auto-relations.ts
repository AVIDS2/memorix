/**
 * Auto-Relation Creator
 *
 * Automatically creates Knowledge Graph relations from entity extraction.
 * Inspired by mcp-memory-service's typed relationships and MemCP's MAGMA 4-graph.
 *
 * When an observation is stored:
 *   1. Extract entities from narrative (files, modules, CamelCase)
 *   2. Find matching existing entities in the graph
 *   3. Auto-create relations: "references", "modifies", or "causes" (if causal)
 *
 * This is "implicit memory" — the agent doesn't need to call create_relations.
 */

import type { Observation, Relation } from '../types.js';
import type { KnowledgeGraphManager } from './graph.js';
import type { ExtractedEntities } from './entity-extractor.js';

/**
 * Infer relation type based on observation type and causal language.
 */
function inferRelationType(obs: Observation): string {
  if (obs.hasCausalLanguage) return 'causes';

  switch (obs.type) {
    case 'problem-solution':
      return 'fixes';
    case 'decision':
    case 'trade-off':
      return 'decides';
    case 'what-changed':
      return 'modifies';
    case 'gotcha':
      return 'warns_about';
    default:
      return 'references';
  }
}

/**
 * Auto-create relations from a stored observation.
 *
 * Scans the knowledge graph for entities matching extracted file names,
 * modules, and identifiers, then creates typed relations.
 *
 * Returns the number of relations created.
 */
export async function createAutoRelations(
  obs: Observation,
  extracted: ExtractedEntities,
  graphManager: KnowledgeGraphManager,
): Promise<number> {
  const relationType = inferRelationType(obs);
  const relations: Relation[] = [];

  // Skip self-references
  const selfName = obs.entityName.toLowerCase();

  // Check extracted identifiers against existing entities (O(1) lookups via index)
  const candidates = [
    ...extracted.identifiers,
    ...extracted.files.map((f) => f.split('/').pop()?.replace(/\.\w+$/, '') ?? ''),
    ...extracted.modules.map((m) => m.split(/[./]/).pop() ?? ''),
  ].filter((c) => c.length >= 3);

  for (const candidate of candidates) {
    const lower = candidate.toLowerCase();
    if (lower === selfName) continue;

    const matchedEntity = graphManager.findEntityByName(candidate);
    if (matchedEntity) {
      relations.push({
        from: obs.entityName,
        to: matchedEntity.name,
        relationType,
      });
    }
  }

  // Also create relations from explicit filesModified → existing entities
  for (const file of obs.filesModified) {
    const basename = file.split('/').pop()?.replace(/\.\w+$/, '') ?? '';
    if (basename.length < 3 || basename.toLowerCase() === selfName) continue;

    const matchedEntity = graphManager.findEntityByName(basename);
    if (matchedEntity) {
      relations.push({
        from: obs.entityName,
        to: matchedEntity.name,
        relationType: 'modifies',
      });
    }
  }

  if (relations.length === 0) return 0;

  // Deduplicate
  const unique = relations.filter(
    (r, i, arr) =>
      arr.findIndex(
        (o) => o.from === r.from && o.to === r.to && o.relationType === r.relationType,
      ) === i,
  );

  const created = await graphManager.createRelations(unique);
  return created.length;
}
