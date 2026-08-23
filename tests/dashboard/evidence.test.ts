import { describe, expect, it } from 'vitest';
import { buildEvidenceCards } from '../../src/dashboard/evidence.js';

describe('dashboard evidence cards', () => {
  it('returns bounded project evidence with provenance and graph neighbors', () => {
    const cards = buildEvidenceCards([
      { id: 2, title: 'Use SQLite', type: 'decision', entityName: 'storage', narrative: '', facts: [], filesModified: ['src/store.ts'], concepts: ['sqlite'], tokens: 2, createdAt: '2026-08-01', projectId: 'org/repo', status: 'active', source: 'agent', sourceDetail: 'explicit', sessionId: 's1' } as any,
      { id: 1, title: 'Other', type: 'discovery', entityName: 'other', narrative: '', facts: [], filesModified: [], concepts: [], tokens: 1, createdAt: '2026-08-01', projectId: 'org/repo', status: 'active', source: 'git' } as any,
    ], { entities: [{ name: 'storage', entityType: 'module', observations: [] } as any], relations: [{ from: 'storage', to: 'sqlite', relationType: 'uses' } as any] }, 'sqlite', 1);
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ id: 2, source: 'explicit', sessionId: 's1', relatedEntities: ['sqlite'], verification: 'unverified' });
  });
});
