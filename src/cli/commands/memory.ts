import { defineCommand } from 'citty';
import { compactDetail, compactSearch, compactTimeline } from '../../compact/engine.js';
import { getProjectObservations, resolveObservations, storeObservation, suggestTopicKey } from '../../memory/observations.js';
import { emitError, emitResult, getCliProjectContext, parseCsvList, parsePositiveInt, coerceObservationStatus, coerceObservationType } from './operator-shared.js';

export default defineCommand({
  meta: {
    name: 'memory',
    description: 'Inspect and manage observations from the operator CLI',
  },
  args: {
    query: { type: 'string', description: 'Search query' },
    text: { type: 'string', description: 'Narrative text for memory store' },
    title: { type: 'string', description: 'Observation title' },
    entity: { type: 'string', description: 'Entity name for the observation' },
    type: { type: 'string', description: 'Observation type' },
    facts: { type: 'string', description: 'Comma-separated facts' },
    files: { type: 'string', description: 'Comma-separated file list' },
    concepts: { type: 'string', description: 'Comma-separated concept list' },
    ids: { type: 'string', description: 'Comma-separated observation IDs' },
    id: { type: 'string', description: 'Single observation ID' },
    status: { type: 'string', description: 'Resolved or archived' },
    topicKey: { type: 'string', description: 'Stable topic key override' },
    limit: { type: 'string', description: 'Limit for search/recent output' },
    before: { type: 'string', description: 'Timeline depth before anchor' },
    after: { type: 'string', description: 'Timeline depth after anchor' },
    json: { type: 'boolean', description: 'Emit machine-readable JSON output' },
  },
  run: async ({ args }) => {
    const action = (args._ as string[])?.[0] || '';
    const asJson = !!args.json;

    try {
      const { project } = await getCliProjectContext({ searchIndex: true });

      switch (action) {
        case 'search': {
          const query = (args.query as string | undefined)?.trim();
          if (!query) {
            emitError('query is required for "memorix memory search"', asJson);
            return;
          }
          const limit = parsePositiveInt(args.limit as string | undefined, 10);
          const result = await compactSearch({ query, limit, projectId: project.id });
          emitResult({ project, entries: result.entries }, result.formatted, asJson);
          return;
        }

        case 'recent': {
          const limit = parsePositiveInt(args.limit as string | undefined, 10);
          const observations = getProjectObservations(project.id)
            .filter((obs) => (obs.status ?? 'active') === 'active')
            .slice(-limit)
            .reverse();
          emitResult(
            { project, observations },
            observations.length === 0
              ? 'No active observations.'
              : observations.map((obs) => `- #${obs.id} ${obs.title}`).join('\n'),
            asJson,
          );
          return;
        }

        case 'store': {
          const narrative = (args.text as string | undefined)?.trim();
          if (!narrative) {
            emitError('text is required for "memorix memory store"', asJson);
            return;
          }
          const title = (args.title as string | undefined)?.trim() || narrative.slice(0, 80);
          const type = coerceObservationType(args.type as string | undefined);
          const topicKey =
            (args.topicKey as string | undefined)?.trim() ||
            suggestTopicKey(type, title) ||
            undefined;
          const result = await storeObservation({
            entityName: (args.entity as string | undefined)?.trim() || 'general',
            type,
            title,
            narrative,
            facts: parseCsvList(args.facts as string | undefined),
            filesModified: parseCsvList(args.files as string | undefined),
            concepts: parseCsvList(args.concepts as string | undefined),
            projectId: project.id,
            topicKey,
            source: 'manual',
          });
          emitResult(
            { project, observation: result.observation, upserted: result.upserted },
            `${result.upserted ? 'Updated' : 'Stored'} observation #${result.observation.id}: ${result.observation.title}`,
            asJson,
          );
          return;
        }

        case 'detail': {
          const ids = parseCsvList((args.ids as string | undefined) || (args.id as string | undefined))
            .map((value) => Number.parseInt(value, 10))
            .filter((value) => Number.isFinite(value));
          if (ids.length === 0) {
            emitError('Provide --id <n> or --ids 1,2,3 for "memorix memory detail"', asJson);
            return;
          }
          const result = await compactDetail(ids.map((id) => ({ id, projectId: project.id })));
          emitResult({ project, documents: result.documents }, result.formatted, asJson);
          return;
        }

        case 'timeline': {
          const id = Number.parseInt((args.id as string | undefined) || '', 10);
          if (!Number.isFinite(id)) {
            emitError('Provide --id <n> for "memorix memory timeline"', asJson);
            return;
          }
          const result = await compactTimeline(
            id,
            project.id,
            parsePositiveInt(args.before as string | undefined, 3),
            parsePositiveInt(args.after as string | undefined, 3),
          );
          emitResult({ project, timeline: result.timeline }, result.formatted, asJson);
          return;
        }

        case 'resolve': {
          const ids = parseCsvList((args.ids as string | undefined) || (args.id as string | undefined))
            .map((value) => Number.parseInt(value, 10))
            .filter((value) => Number.isFinite(value));
          if (ids.length === 0) {
            emitError('Provide --id <n> or --ids 1,2,3 for "memorix memory resolve"', asJson);
            return;
          }
          const status = coerceObservationStatus(args.status as string | undefined);
          const result = await resolveObservations(ids, status);
          emitResult(
            { project, result, status },
            `Resolved ${result.resolved.length} observation(s) to ${status}${result.notFound.length > 0 ? `; not found: ${result.notFound.join(', ')}` : ''}`,
            asJson,
          );
          return;
        }

        default:
          console.log('Memorix Memory Commands');
          console.log('');
          console.log('Usage:');
          console.log('  memorix memory search --query "timeout bug" [--limit 10]');
          console.log('  memorix memory recent [--limit 10]');
          console.log('  memorix memory store --text "..." [--title "..."] [--type discovery]');
          console.log('  memorix memory detail --id 42');
          console.log('  memorix memory timeline --id 42 [--before 3 --after 3]');
          console.log('  memorix memory resolve --ids 42,43 [--status resolved|archived]');
      }
    } catch (error) {
      emitError(error instanceof Error ? error.message : String(error), asJson);
    }
  },
});
