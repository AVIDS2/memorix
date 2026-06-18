import { describe, expect, it } from 'vitest';

import { getObservationsByIds, insertObservation, resetDb } from '../../src/store/orama-store.js';

describe('Orama detail cache', () => {
	it('returns a cached observation document by id even after in-memory observation state is cleared', async () => {
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
		};

		await resetDb();
		await insertObservation(doc as any);

		const docs = await getObservationsByIds([42], projectId);

		expect(docs).toHaveLength(1);
		expect(docs[0]?.title).toBe('Cached detail lookup');
		expect(docs[0]?.projectId).toBe(projectId);
	});
});
