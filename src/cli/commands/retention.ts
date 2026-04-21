import { defineCommand } from 'citty';
import { getAllObservations } from '../../memory/observations.js';
import { archiveExpired, explainRetention, getArchiveCandidates, getRetentionSummary, getRetentionZone, rankByRelevance } from '../../memory/retention.js';
import type { MemorixDocument } from '../../types.js';
import { emitError, emitResult, getCliProjectContext } from './operator-shared.js';

function toDocument(obs: Awaited<ReturnType<typeof getAllObservations>>[number]): MemorixDocument {
  return {
    id: `obs-${obs.id}`,
    observationId: obs.id,
    entityName: obs.entityName,
    type: obs.type,
    title: obs.title,
    narrative: obs.narrative,
    facts: obs.facts.join('\n'),
    filesModified: obs.filesModified.join('\n'),
    concepts: obs.concepts.join(', '),
    tokens: obs.tokens,
    createdAt: obs.createdAt,
    projectId: obs.projectId,
    accessCount: 0,
    lastAccessedAt: '',
    status: obs.status ?? 'active',
    source: obs.source ?? 'agent',
    sourceDetail: obs.sourceDetail ?? '',
    valueCategory: obs.valueCategory ?? '',
  };
}

export default defineCommand({
  meta: {
    name: 'retention',
    description: 'Inspect retention state and archive expired memories',
  },
  args: {
    json: { type: 'boolean', description: 'Emit machine-readable JSON output' },
  },
  run: async ({ args }) => {
    const action = (args._ as string[])?.[0] || '';
    const asJson = !!args.json;

    try {
      const { project, dataDir } = await getCliProjectContext();
      const activeDocs = getAllObservations()
        .filter((obs) => obs.projectId === project.id && (obs.status ?? 'active') === 'active')
        .map(toDocument);

      switch (action) {
        case 'status': {
          const summary = getRetentionSummary(activeDocs);
          const archiveCandidates = getArchiveCandidates(activeDocs);
          const ranked = rankByRelevance(activeDocs).slice(0, 5);
          emitResult(
            { project, summary, archiveCandidates, ranked },
            [
              `Retention status for ${project.name}`,
              `- Active: ${summary.active}`,
              `- Stale: ${summary.stale}`,
              `- Archive candidates: ${summary.archiveCandidates}`,
              `- Immune: ${summary.immune}`,
            ].join('\n'),
            asJson,
          );
          return;
        }

        case 'archive': {
          const result = await archiveExpired(dataDir);
          emitResult(
            { project, result },
            result.archived === 0
              ? 'No expired observations to archive.'
              : `Archived ${result.archived} expired observation(s); ${result.remaining} active observation(s) remain.`,
            asJson,
          );
          return;
        }

        case 'stale': {
          const stale = activeDocs
            .filter((doc) => getRetentionZone(doc) !== 'active')
            .map((doc) => explainRetention(doc));
          emitResult(
            { project, stale },
            stale.length === 0
              ? 'No stale or archive-candidate observations.'
              : stale
                  .map((entry) => `- #${entry.observationId}: ${entry.summary}`)
                  .join('\n'),
            asJson,
          );
          return;
        }

        default:
          console.log('Memorix Retention Commands');
          console.log('');
          console.log('Usage:');
          console.log('  memorix retention status');
          console.log('  memorix retention stale');
          console.log('  memorix retention archive');
      }
    } catch (error) {
      emitError(error instanceof Error ? error.message : String(error), asJson);
    }
  },
});

