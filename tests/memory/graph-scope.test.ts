import { describe, expect, it } from 'vitest';
import { scopeKnowledgeGraphToProject } from '../../src/memory/graph-scope.js';

describe('scopeKnowledgeGraphToProject', () => {
  it('keeps explicitly related project entities and their durable edge visible to raw graph readers', () => {
    const scoped = scopeKnowledgeGraphToProject({
      entities: [
        { name: 'release-process' },
        { name: 'token-refresh' },
        { name: 'unrelated' },
      ],
      relations: [
        { from: 'release-process', to: 'token-refresh', relationType: 'related_entity' },
        { from: 'unrelated', to: 'token-refresh', relationType: 'references' },
      ],
    }, [
      {
        entityName: 'release-process',
        relatedEntities: ['token-refresh'],
        status: 'active',
      },
      {
        entityName: 'unrelated',
        status: 'resolved',
      },
    ]);

    expect(scoped.entities.map(entity => entity.name)).toEqual(['release-process', 'token-refresh']);
    expect(scoped.relations).toEqual([
      { from: 'release-process', to: 'token-refresh', relationType: 'related_entity' },
    ]);
  });
});
