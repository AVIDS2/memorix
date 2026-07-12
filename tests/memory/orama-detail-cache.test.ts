import { describe, expect, it, vi } from 'vitest';
import { getByID, insert } from '@orama/orama';

import { getDb, getObservationsByIds, resetDb } from '../../src/store/orama-store.js';

vi.mock('../../src/embedding/provider.js', () => ({
	getEmbeddingProvider: vi.fn(async () => ({
		name: 'test',
		dimensions: 2,
		embed: async () => [0.6, 0.8],
		embedBatch: async () => [[0.6, 0.8]],
	})),
}));

describe('Orama detail cache', () => {
	it('returns vector-free detail without damaging a cache-miss document', async () => {
		const projectId = 'AVIDS2/memorix';

		const doc = {
			id: `obs-${encodeURIComponent(projectId)}-42`,
			observationId: 42,
			entityName: 'memcode-runtime',
			type: 'discovery',
			title: 'Cached detail lookup',
			narrative: 'Detail lookup should reuse the indexed document cache.',
			facts: 'one\n',
			filesModified: 'src/example.ts',
			concepts: 'cache',
			tokens: 12,
			createdAt: new Date().toISOString(),
			projectId,
			accessCount: 0,
			lastAccessedAt: '',
			status: 'active',
			source: 'agent',
			sourceDetail: 'explicit',
			valueCategory: 'contextual',
			embedding: [0.6, 0.8],
		};

		await resetDb();
		const db = await getDb();
		await insert(db, doc);

		const first = await getObservationsByIds([42], projectId);
		const second = await getObservationsByIds([42], projectId);

		expect(first).toHaveLength(1);
		expect(second).toHaveLength(1);
		expect(first[0]).not.toHaveProperty('embedding');
		expect(second[0]).not.toHaveProperty('embedding');
		expect(getByID(db, doc.id)).toMatchObject({ embedding: [0.6, 0.8] });
	});
});
