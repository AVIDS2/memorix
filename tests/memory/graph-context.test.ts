import { describe, expect, it } from 'vitest';
import { buildGraphContextPacket } from '../../src/memory/graph-context.js';
import { normalizeMemoryBrowseQuery } from '../../src/compact/engine.js';
import type { Observation } from '../../src/types.js';

function obs(overrides: Partial<Observation>): Observation {
  return {
    id: 1,
    entityName: 'memcode-runtime',
    type: 'decision',
    title: 'Default memory',
    narrative: 'A useful project memory.',
    facts: ['Useful fact'],
    filesModified: ['src/example.ts'],
    concepts: ['runtime'],
    tokens: 50,
    createdAt: new Date('2026-06-01T00:00:00.000Z').toISOString(),
    projectId: 'AVIDS2/memorix',
    status: 'active',
    source: 'manual',
    sourceDetail: 'explicit',
    valueCategory: 'contextual',
    ...overrides,
  };
}

describe('buildGraphContextPacket', () => {
  it.each(['我们有哪些记忆', '所有记忆', '全部记忆', '记忆概览', 'show memories'])(
    'normalizes broad memory browse query %s',
    (query) => {
      expect(normalizeMemoryBrowseQuery(query)).toBe('');
    },
  );

  it('turns flat memories into an entity-centered context packet', () => {
    const packet = buildGraphContextPacket([
      obs({ id: 1, entityName: 'memcode-runtime', title: 'Use native memory status', narrative: 'memcode should expose native Memorix memory runtime status.', type: 'decision', valueCategory: 'core', relatedEntities: ['memory-injection'], relatedCommits: ['abc123456789'] }),
      obs({ id: 2, entityName: 'memory-injection', title: 'Inject only relevant memory', narrative: 'Memory injection should stay intent gated and avoid greetings.', type: 'gotcha', facts: ['Skip greetings'], concepts: ['injection', 'intent'] }),
      obs({ id: 3, entityName: 'ui-noise', title: 'Thinking', narrative: 'Thinking...', type: 'discovery', facts: [], filesModified: [], concepts: [], source: 'agent', sourceDetail: 'hook', valueCategory: 'ephemeral' }),
      obs({ id: 4, entityName: 'memcode-runtime', title: 'Different project copy', narrative: 'Should be ignored by project scoping.', projectId: 'other/project' }),
    ], { projectId: 'AVIDS2/memorix', query: 'memcode memory status injection', limit: 4 });

    expect(packet.projectId).toBe('AVIDS2/memorix');
    expect(packet.query).toBe('memcode memory status injection');
    expect(packet.memories.map((memory) => memory.id)).toEqual([1, 2]);
    expect(packet.entities.map((entity) => entity.name)).toEqual(['memcode-runtime', 'memory-injection']);
    expect(packet.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: 'memcode-runtime', to: 'memory-injection', type: 'related_entity' }),
      expect.objectContaining({ from: 'memcode-runtime', to: 'commit:abc1234', type: 'cites_commit' }),
    ]));
    expect(packet.edges.filter((edge) => edge.to === 'commit:abc1234')).toHaveLength(1);
    expect(packet.risks.map((risk) => risk.id)).not.toContain(3);
    expect(packet.summary).toContain('2 high-signal memories');
    expect(packet.summary).toContain('2 entity');
  });

  it('falls back to core recent memories when the query has no lexical hit', () => {
    const packet = buildGraphContextPacket([
      obs({ id: 1, entityName: 'release-flow', title: 'Release is user controlled', narrative: 'The user performs publish and release operations manually.', type: 'decision', valueCategory: 'core' }),
    ], { projectId: 'AVIDS2/memorix', query: 'unmatched phrase', limit: 3 });

    expect(packet.memories.map((memory) => memory.id)).toEqual([1]);
    expect(packet.entities[0].name).toBe('release-flow');
  });

  it('keeps prompt risks scoped to selected context instead of global noise', () => {
    const packet = buildGraphContextPacket([
      obs({ id: 1, entityName: 'memcode-memory', title: 'Graph context injection', narrative: 'Use GraphContext Packet for memory injection.', type: 'decision', valueCategory: 'core' }),
      obs({ id: 2, entityName: 'memcode-memory', title: 'Thinking', narrative: 'Thinking...', facts: [], filesModified: [], concepts: [], source: 'agent', sourceDetail: 'hook', valueCategory: 'ephemeral' }),
      obs({ id: 3, entityName: 'unrelated-shell-noise', title: 'Ran: Select-String memory-game noisy command', narrative: 'Shell command output.', facts: [], filesModified: [], concepts: [], source: 'agent', sourceDetail: 'hook', valueCategory: 'ephemeral' }),
    ], { projectId: 'AVIDS2/memorix', query: 'memcode memory injection', limit: 3 });

    expect(packet.risks.map((risk) => risk.id)).toContain(2);
    expect(packet.risks.map((risk) => risk.id)).not.toContain(3);
    expect(packet.summary).toContain('1 risk signal');
  });

  it('keeps related risk evidence while rejecting generic keyword noise', () => {
    const packet = buildGraphContextPacket([
      obs({ id: 1, entityName: 'memcode-memory', title: 'Graph context injection', narrative: 'Use GraphContext Packet for memory injection.', type: 'decision', valueCategory: 'core' }),
      obs({ id: 2, entityName: 'diagnostics-noise', title: 'Thinking', narrative: 'Thinking about diagnostics.', facts: [], filesModified: [], concepts: [], relatedEntities: ['memcode-memory'], source: 'agent', sourceDetail: 'hook', valueCategory: 'ephemeral' }),
      obs({ id: 3, entityName: 'old-memory-game', title: 'Memory game test output', narrative: 'Old unrelated output that only shares the generic word memory.', facts: [], filesModified: [], concepts: [], source: 'agent', sourceDetail: 'hook', valueCategory: 'ephemeral' }),
    ], { projectId: 'AVIDS2/memorix', query: 'memcode memory injection', limit: 3 });

    expect(packet.risks.map((risk) => risk.id)).toContain(2);
    expect(packet.risks.map((risk) => risk.id)).not.toContain(3);
  });

  it('does not let memory-game handoff memories dominate broad memory overviews', () => {
    const packet = buildGraphContextPacket([
      obs({
        id: 1,
        entityName: 'team-handoff',
        title: 'Memory Card Matching Game approved',
        narrative: 'Memory game implementation at e2e-test/memory-game/index.html was approved.',
        type: 'what-changed',
        valueCategory: 'core',
        createdAt: new Date('2026-06-17T23:00:00.000Z').toISOString(),
      }),
      obs({
        id: 2,
        entityName: 'memorix-memory-graph-context',
        title: 'Graph context promoted to core Memorix',
        narrative: 'Implemented memorix_graph_context as a core Memorix memory graph capability for agents.',
        type: 'what-changed',
        valueCategory: 'core',
        concepts: ['memorix_graph_context', 'memory graph', 'memcode native memory'],
        createdAt: new Date('2026-06-17T22:00:00.000Z').toISOString(),
      }),
      obs({
        id: 3,
        entityName: 'memcode-runtime-status',
        title: 'Memcode exposes semantic memory readiness',
        narrative: 'memcode reports Memorix embedding readiness and search mode in the footer/status surface.',
        type: 'decision',
        valueCategory: 'core',
        concepts: ['memcode', 'memorix', 'embedding'],
        createdAt: new Date('2026-06-17T21:00:00.000Z').toISOString(),
      }),
    ], { projectId: 'AVIDS2/memorix', query: '搜索一下记忆', limit: 2 });

    expect(packet.memories.map((memory) => memory.id)).toEqual([2, 3]);
    expect(packet.entities.map((entity) => entity.name)).not.toContain('team-handoff');
  });
});
