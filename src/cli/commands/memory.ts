import { defineCommand } from 'citty';
import { compactDetail, compactSearch, compactTimeline } from '../../compact/engine.js';
import { withFreshIndex } from '../../memory/freshness.js';
import { getAllObservations, getProjectObservations, resolveObservations, storeObservation, suggestTopicKey } from '../../memory/observations.js';
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
    action: { type: 'string', description: 'Secondary action for advanced memory commands' },
    limit: { type: 'string', description: 'Limit for search/recent output' },
    before: { type: 'string', description: 'Timeline depth before anchor' },
    after: { type: 'string', description: 'Timeline depth after anchor' },
    threshold: { type: 'string', description: 'Similarity threshold for consolidate' },
    dryRun: { type: 'boolean', description: 'Preview changes without mutating data' },
    trigger: { type: 'string', description: 'Custom trigger text for promoted mini-skills' },
    instruction: { type: 'string', description: 'Custom instruction for promoted mini-skills' },
    tags: { type: 'string', description: 'Comma-separated extra tags for promoted mini-skills' },
    skillId: { type: 'string', description: 'Mini-skill ID for list/delete actions' },
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

        case 'suggest-topic-key': {
          const type = coerceObservationType(args.type as string | undefined);
          const title = (args.title as string | undefined)?.trim();
          if (!title) {
            emitError('title is required for "memorix memory suggest-topic-key"', asJson);
            return;
          }
          const key = suggestTopicKey(type, title);
          if (!key) {
            emitError('Could not suggest a stable topic key for the provided title', asJson);
            return;
          }
          emitResult({ project, type, title, topicKey: key }, `Suggested topic key: ${key}`, asJson);
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

        case 'deduplicate': {
          const query = (args.query as string | undefined)?.trim();
          const dryRun = !!args.dryRun;
          const { isLLMEnabled } = await import('../../llm/provider.js');
          if (!isLLMEnabled()) {
            emitResult(
              { project, available: false, usedLLM: false },
              'LLM not configured. Set MEMORIX_LLM_API_KEY or OPENAI_API_KEY to enable intelligent dedup.\n\nTip: use `memorix memory consolidate --action preview` for similarity-based consolidation without LLM.',
              asJson,
            );
            return;
          }

          const { deduplicateMemory } = await import('../../llm/memory-manager.js');
          const allObs = await withFreshIndex(() =>
            getAllObservations().filter((obs) => (obs.status ?? 'active') === 'active' && obs.projectId === project.id),
          );

          if (allObs.length < 2) {
            emitResult({ project, actions: [], resolved: [] }, 'Not enough active memories to deduplicate.', asJson);
            return;
          }

          let candidates = allObs;
          if (query) {
            const searchResult = await compactSearch({ query, limit: 20, projectId: project.id, status: 'active' });
            const ids = new Set(searchResult.entries.map((entry) => entry.id));
            candidates = allObs.filter((obs) => ids.has(obs.id));
          } else {
            candidates = allObs.slice(-20);
          }

          const byEntity = new Map<string, typeof candidates>();
          for (const obs of candidates) {
            const bucket = byEntity.get(obs.entityName) ?? [];
            bucket.push(obs);
            byEntity.set(obs.entityName, bucket);
          }

          const actions: string[] = [];
          const toResolve: number[] = [];
          for (const [, group] of byEntity) {
            if (group.length < 2) continue;
            for (let index = 0; index < group.length; index += 1) {
              for (let compareIndex = index + 1; compareIndex < group.length; compareIndex += 1) {
                const newer = group[compareIndex];
                const older = group[index];
                try {
                  const decision = await deduplicateMemory(
                    { title: newer.title, narrative: newer.narrative, facts: newer.facts },
                    [{ id: older.id, title: older.title, narrative: older.narrative, facts: older.facts.join('\n') }],
                  );
                  if (decision && (decision.action === 'DELETE' || decision.action === 'UPDATE' || decision.action === 'NONE')) {
                    actions.push(`Resolve #${older.id} because it duplicates newer #${newer.id}`);
                    toResolve.push(older.id);
                  }
                } catch {
                  // Ignore failed pair analysis so one bad comparison doesn't abort the batch.
                }
              }
            }
          }

          if (dryRun || toResolve.length === 0) {
            emitResult(
              { project, actions, resolved: [], dryRun: true },
              actions.length === 0 ? 'No duplicate candidates found.' : actions.join('\n'),
              asJson,
            );
            return;
          }

          const result = await resolveObservations([...new Set(toResolve)], 'resolved');
          emitResult(
            { project, actions, resolved: result.resolved, notFound: result.notFound, dryRun: false },
            `Resolved ${result.resolved.length} duplicate observation(s).`,
            asJson,
          );
          return;
        }

        case 'consolidate': {
          const consolidationAction = (args.action as string | undefined) || 'preview';
          const threshold = args.threshold == null ? undefined : Number(args.threshold);
          const { findConsolidationCandidates, executeConsolidation } = await import('../../memory/consolidation.js');

          if (consolidationAction === 'preview') {
            const clusters = await findConsolidationCandidates(process.cwd(), project.id, { threshold });
            emitResult(
              { project, clusters, action: consolidationAction },
              clusters.length === 0
                ? 'No consolidation candidates found.'
                : clusters
                    .map((cluster, index) => `- Cluster ${index + 1}: ${cluster.ids.length} observation(s) for ${cluster.entityName}`)
                    .join('\n'),
              asJson,
            );
            return;
          }

          if (consolidationAction === 'execute') {
            const result = await executeConsolidation(process.cwd(), project.id, { threshold });
            emitResult(
              { project, action: consolidationAction, ...result },
              result.clustersFound === 0
                ? 'No consolidation candidates found.'
                : `Merged ${result.observationsMerged} observation(s) across ${result.clustersFound} cluster(s).`,
              asJson,
            );
            return;
          }

          emitError('action must be preview or execute for "memorix memory consolidate"', asJson);
          return;
        }

        case 'promote': {
          const promoteAction = (args.action as string | undefined) || 'promote';
          const { promoteToMiniSkill, loadAllMiniSkills, deleteMiniSkill } = await import('../../skills/mini-skills.js');
          const { initMiniSkillStore } = await import('../../store/mini-skill-store.js');
          const { dataDir } = await getCliProjectContext();
          await initMiniSkillStore(dataDir);

          if (promoteAction === 'list') {
            const skills = await loadAllMiniSkills(process.cwd());
            emitResult(
              { project, skills, action: promoteAction },
              skills.length === 0 ? 'No mini-skills found.' : skills.map((skill) => `- #${skill.id} ${skill.title}`).join('\n'),
              asJson,
            );
            return;
          }

          if (promoteAction === 'delete') {
            const skillId = Number.parseInt((args.skillId as string | undefined) || '', 10);
            if (!Number.isFinite(skillId)) {
              emitError('skillId is required for "memorix memory promote --action delete"', asJson);
              return;
            }
            const deleted = await deleteMiniSkill(process.cwd(), skillId);
            if (!deleted) {
              emitError(`Mini-skill #${skillId} not found`, asJson);
              return;
            }
            emitResult({ project, skillId, deleted: true }, `Deleted mini-skill #${skillId}.`, asJson);
            return;
          }

          const ids = parseCsvList((args.ids as string | undefined) || (args.id as string | undefined))
            .map((value) => Number.parseInt(value, 10))
            .filter((value) => Number.isFinite(value));
          if (ids.length === 0) {
            emitError('Provide --id <n> or --ids 1,2,3 for "memorix memory promote"', asJson);
            return;
          }
          const observations = await withFreshIndex(() => getAllObservations());
          const matched = observations.filter((obs) => ids.includes(obs.id));
          if (matched.length === 0) {
            emitError(`No observations found for IDs: ${ids.join(', ')}`, asJson);
            return;
          }
          const skill = await promoteToMiniSkill(process.cwd(), project.id, matched, {
            trigger: args.trigger as string | undefined,
            instruction: args.instruction as string | undefined,
            tags: parseCsvList(args.tags as string | undefined),
          });
          emitResult(
            { project, action: promoteAction, skill, sourceObservationIds: matched.map((obs) => obs.id) },
            `Created mini-skill #${skill.id}: ${skill.title}`,
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
          console.log('  memorix memory suggest-topic-key --type decision --title "..."');
          console.log('  memorix memory detail --id 42');
          console.log('  memorix memory timeline --id 42 [--before 3 --after 3]');
          console.log('  memorix memory resolve --ids 42,43 [--status resolved|archived]');
          console.log('  memorix memory deduplicate [--query "..."] [--dryRun]');
          console.log('  memorix memory consolidate [--action preview|execute] [--threshold 0.45]');
          console.log('  memorix memory promote --ids 42,43 [--trigger "..."] [--instruction "..."]');
      }
    } catch (error) {
      emitError(error instanceof Error ? error.message : String(error), asJson);
    }
  },
});
