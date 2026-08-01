import { defineCommand } from 'citty';
import { compactDetail, compactSearch, compactTimeline } from '../../compact/engine.js';
import { withFreshIndex } from '../../memory/freshness.js';
import { getAllObservations, getObservation, getProjectObservations, resolveObservations, storeObservation, suggestTopicKey } from '../../memory/observations.js';
import { buildGraphContextPacket, formatGraphContextPrompt } from '../../memory/graph-context.js';
import { canManageObservation, filterReadableObservations, resolveObservationVisibility } from '../../memory/visibility.js';
import {
  coerceObservationStatus,
  coerceObservationType,
  coerceRetrievalQuality,
  emitError,
  emitResult,
  getCliReadContext,
  getCliProjectContext,
  parseCsvList,
  parsePositiveInt,
  resolveCliWriteScope,
} from './operator-shared.js';

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
    visibility: { type: 'string', description: 'Memory visibility: project (default), personal, or team' },
    ids: { type: 'string', description: 'Comma-separated observation IDs' },
    id: { type: 'string', description: 'Single observation ID' },
    status: { type: 'string', description: 'Resolved or archived' },
    topicKey: { type: 'string', description: 'Stable topic key override' },
    action: { type: 'string', description: 'Secondary action for advanced memory commands' },
    limit: { type: 'string', description: 'Limit for search/recent output' },
    quality: { type: 'string', description: 'Retrieval profile: fast, balanced (default), or thorough' },
    graphLimit: { type: 'string', description: 'Limit for graph-context output' },
    graphQuery: { type: 'string', description: 'Query for graph-context packet' },
    format: { type: 'string', description: 'Output format for graph-context: summary or prompt' },
    before: { type: 'string', description: 'Timeline depth before anchor' },
    after: { type: 'string', description: 'Timeline depth after anchor' },
    threshold: { type: 'string', description: 'Similarity threshold for consolidate' },
    dryRun: { type: 'boolean', description: 'Preview changes without mutating data' },
    'dry-run': { type: 'boolean', description: 'Kebab-case alias for --dryRun' },
    trigger: { type: 'string', description: 'Custom trigger text for promoted mini-skills' },
    instruction: { type: 'string', description: 'Custom instruction for promoted mini-skills' },
    tags: { type: 'string', description: 'Comma-separated extra tags for promoted mini-skills' },
    skillId: { type: 'string', description: 'Mini-skill ID for list/delete actions' },
    kind: { type: 'string', description: 'Long-term memory kind: episodic, semantic, or procedural' },
    scope: { type: 'string', description: 'Long-term memory scope: project, user, or team' },
    portability: { type: 'string', description: 'Long-term memory portability: project-bound or portable' },
    applicability: { type: 'string', description: 'When a long-term memory applies' },
    fromObservation: { type: 'string', description: 'Observation ID to promote into long-term memory' },
    supersededBy: { type: 'string', description: 'Qualified or approved long-term memory that replaces the current record' },
    'superseded-by': { type: 'string', description: 'Kebab-case alias for --supersededBy' },
    reason: { type: 'string', description: 'Evidence review reason for qualify, approve, or archive' },
    all: { type: 'boolean', description: 'Include archived and superseded long-term memories in list output' },
    json: { type: 'boolean', description: 'Emit machine-readable JSON output' },
  },
  run: async ({ args }) => {
    const action = (args._ as string[])?.[0] || '';
    const positional = ((args._ as string[]) ?? []).slice(1);
    const longTermAction = action === 'long-term'
      ? (positional[0] || (args.action as string | undefined) || 'list').trim().toLowerCase()
      : undefined;
    const asJson = !!args.json;

    try {
      const readOnlyActions = new Set(['', 'search', 'graph-context', 'recent', 'suggest-topic-key', 'detail', 'timeline']);
      const needsSearchIndex = action === 'search' || action === 'detail' || action === 'timeline';
      const longTermReadOnly = longTermAction === 'list' || longTermAction === 'show';
      const context = readOnlyActions.has(action) || longTermReadOnly
        ? await getCliReadContext({ searchIndex: needsSearchIndex })
        : await getCliProjectContext({ searchIndex: true });
      const { project, dataDir, reader, identity } = context;

      switch (action) {
        case 'search': {
          const query = getStringArg(args.query as string | undefined, positional);
          if (!query) {
            emitError('query is required for "memorix memory search"', asJson);
            return;
          }
          const limit = parsePositiveInt(args.limit as string | undefined, 10);
          const quality = coerceRetrievalQuality(args.quality as string | undefined);
          const result = await compactSearch({ query, limit, quality, projectId: project.id, reader }, 'cli');
          emitResult({ project, entries: result.entries }, result.formatted, asJson);
          return;
        }

        case 'graph-context': {
          const query =
            getStringArg(args.graphQuery as string | undefined, []) ||
            getStringArg(args.query as string | undefined, positional);
          if (!query) {
            emitError('query is required for "memorix memory graph-context"', asJson);
            return;
          }
          const observations = filterReadableObservations(getAllObservations(), reader);
          const packet = buildGraphContextPacket(observations, {
            projectId: project.id,
            query,
            limit: parsePositiveInt(args.graphLimit as string | undefined, 5),
          });
          const format = (args.format as string | undefined)?.trim().toLowerCase();
          const formatted = format === 'prompt'
            ? formatGraphContextPrompt(packet)
            : [
                `Graph context packet for ${project.name}`,
                `- ${packet.summary}`,
                '',
                ...packet.entities.map((entity) => `* ${entity.name} (#${entity.observationIds.join(', #')})`),
              ].join('\n');
          emitResult(
            { project, packet },
            formatted,
            asJson,
          );
          return;
        }

        case 'recent': {
          const limit = parsePositiveInt(args.limit as string | undefined, 10);
          const observations = filterReadableObservations(getProjectObservations(project.id), reader)
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
          const narrative = getStringArg(args.text as string | undefined, positional);
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
          const writeScope = resolveCliWriteScope(
            { reader, identity },
            args.visibility as string | undefined,
          );
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
            ...writeScope,
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
          const refs = parseCsvList(getIdArg(args, positional));
          if (refs.length === 0) {
            emitError('Provide --id <n>, --ids 1,2,3, or typed refs like obs:42@org/project for "memorix memory detail"', asJson);
            return;
          }
          const scopedRefs = refs.map((ref) => {
            const numericId = Number.parseInt(ref, 10);
            return Number.isFinite(numericId) && String(numericId) === ref.trim()
              ? `obs:${numericId}@${project.id}`
              : ref;
          });
          const result = await compactDetail(scopedRefs, { reader });
          if (scopedRefs.length === 1 && result.documents.length === 0) {
            emitError(`No readable memory found for ${scopedRefs[0]}.`, asJson);
            return;
          }
          emitResult({ project, documents: result.documents }, result.formatted, asJson);
          return;
        }

        case 'timeline': {
          const rawId = (args.id as string | undefined) || positional[0] || '';
          let id: number;
          try {
            id = parseObservationId(rawId);
          } catch {
            emitError('Provide --id <n> for "memorix memory timeline"', asJson);
            return;
          }
          const result = await compactTimeline(
            id,
            project.id,
            parsePositiveInt(args.before as string | undefined, 3),
            parsePositiveInt(args.after as string | undefined, 3),
            reader,
            'cli',
          );
          if (!result.timeline.anchorEntry) {
            emitError(`Observation #${id} was not found.`, asJson);
            return;
          }
          emitResult({ project, timeline: result.timeline }, result.formatted, asJson);
          return;
        }

        case 'resolve': {
          const ids = parseObservationIds(getIdArg(args, positional));
          if (ids.length === 0) {
            emitError('Provide --id <n> or --ids 1,2,3 for "memorix memory resolve"', asJson);
            return;
          }
          const status = coerceObservationStatus(args.status as string | undefined);
          const authorizedIds = ids.filter((id) => {
            const observation = getObservation(id, project.id);
            return observation ? canManageObservation(observation, reader) : false;
          });
          if (authorizedIds.length === 0) {
            emitError('No requested observations are manageable with the active CLI scope.', asJson);
            return;
          }
          const dryRun = !!args.dryRun || !!args['dry-run'];
          if (dryRun) {
            const unavailableIds = ids.filter((id) => !authorizedIds.includes(id));
            emitResult(
              { project, dryRun: true, status, wouldResolve: authorizedIds, unavailableIds },
              `Would resolve ${authorizedIds.length} observation(s) to ${status}${unavailableIds.length > 0 ? `; unavailable: ${unavailableIds.join(', ')}` : ''}`,
              asJson,
            );
            return;
          }
          const result = await resolveObservations(authorizedIds, status);
          emitResult(
            { project, result, status },
            `Resolved ${result.resolved.length} observation(s) to ${status}${result.notFound.length > 0 ? `; not found: ${result.notFound.join(', ')}` : ''}`,
            asJson,
          );
          return;
        }

        case 'deduplicate': {
          const query = (args.query as string | undefined)?.trim();
          const dryRun = !!args.dryRun || !!args['dry-run'];
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
            filterReadableObservations(
              getAllObservations().filter((obs) => (obs.status ?? 'active') === 'active' && obs.projectId === project.id),
              reader,
            ),
          );

          if (allObs.length < 2) {
            emitResult({ project, actions: [], resolved: [] }, 'Not enough active memories to deduplicate.', asJson);
            return;
          }

          let candidates = allObs;
          if (query) {
            const searchResult = await compactSearch({ query, limit: 20, projectId: project.id, status: 'active', reader });
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

          const result = await resolveObservations(
            [...new Set(toResolve)].filter((id) => {
              const observation = getObservation(id, project.id);
              return observation ? canManageObservation(observation, reader) : false;
            }),
            'resolved',
          );
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
            const clusters = await findConsolidationCandidates(project.rootPath, project.id, { threshold });
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
            const result = await executeConsolidation(project.rootPath, project.id, { threshold });
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
          await initMiniSkillStore(dataDir);

          if (promoteAction === 'list') {
            const skills = await loadAllMiniSkills(project.rootPath);
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
            const deleted = await deleteMiniSkill(project.rootPath, skillId);
            if (!deleted) {
              emitError(`Mini-skill #${skillId} not found`, asJson);
              return;
            }
            emitResult({ project, skillId, deleted: true }, `Deleted mini-skill #${skillId}.`, asJson);
            return;
          }

          const ids = parseObservationIds(getIdArg(args, positional));
          if (ids.length === 0) {
            emitError('Provide --id <n> or --ids 1,2,3 for "memorix memory promote"', asJson);
            return;
          }
          const observations = await withFreshIndex(() => getAllObservations());
          const matched = filterReadableObservations(
            observations.filter((obs) => obs.projectId === project.id && ids.includes(obs.id)),
            reader,
          ).filter((observation) => resolveObservationVisibility(observation) === 'project');
          if (matched.length === 0) {
            emitError(`No project-visible observations found for IDs: ${ids.join(', ')}. Private and team records cannot be promoted into shared skills.`, asJson);
            return;
          }
          const skill = await promoteToMiniSkill(project.rootPath, project.id, matched, {
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

        case 'long-term': {
          const resolvedLongTermAction = longTermAction ?? 'list';
          const longTermPositional = positional.slice(1);
          const {
            archiveLongTermMemory,
            approveLongTermMemory,
            createManualLongTermMemory,
            getLongTermMemoryDetail,
            listLongTermMemories,
            promoteObservationToLongTermMemory,
            qualifyLongTermMemory,
            supersedeLongTermMemory,
          } = await import('../../memory/long-term.js');
          const { resolveLocalMemoryOwner } = await import('../../memory/owner.js');
          const owner = await resolveLocalMemoryOwner(dataDir, { create: false });
          const longTermReader = {
            projectId: project.id,
            ...(owner ? { ownerId: owner.id } : {}),
            ...(reader.agentId ? { agentId: reader.agentId } : {}),
            ...(reader.isTeamMember ? { isTeamMember: true } : {}),
          };

          const memoryId = (): string => {
            const id = (args.id as string | undefined)?.trim()
              || (args.fromObservation as string | undefined)?.trim()
              || longTermPositional[0]?.trim();
            if (!id) throw new Error('long-term memory id is required.');
            return id;
          };
          const scope = () => longTermScope(args.scope as string | undefined);
          const kind = () => longTermKind(args.kind as string | undefined);
          const portability = () => longTermPortability(args.portability as string | undefined);
          const reason = () => requiredLongTermReason(args.reason as string | undefined);

          switch (resolvedLongTermAction) {
            case 'list': {
              const memories = await listLongTermMemories({
                dataDir,
                reader: longTermReader,
                includeInactive: !!args.all,
                limit: parsePositiveInt(args.limit as string | undefined, 50),
              });
              emitResult(
                { project, memories },
                memories.length === 0
                  ? 'No long-term memories are visible in the active scope.'
                  : memories.map(item => `- ${item.memory.id} [${item.memory.state}/${item.memory.kind}/${item.memory.scope}] ${item.memory.title}`).join('\n'),
                asJson,
              );
              return;
            }

            case 'show': {
              const detail = await getLongTermMemoryDetail({ dataDir, id: memoryId(), reader: longTermReader });
              emitResult(
                { project, ...detail },
                [
                  `${detail.memory.id} [${detail.memory.state}/${detail.memory.kind}/${detail.memory.scope}]`,
                  detail.memory.title,
                  detail.memory.content,
                  `Evidence: ${detail.evidence.length}`,
                  `Audit events: ${detail.events.length}`,
                ].join('\n'),
                asJson,
              );
              return;
            }

            case 'add': {
              const content = getStringArg(args.text as string | undefined, longTermPositional);
              if (!content) {
                emitError('text is required for "memorix memory long-term add"', asJson);
                return;
              }
              const result = await createManualLongTermMemory({
                dataDir,
                projectId: project.id,
                scope: scope(),
                kind: kind(),
                title: (args.title as string | undefined)?.trim() || content.slice(0, 100),
                content,
                facts: parseCsvList(args.facts as string | undefined),
                tags: parseCsvList(args.tags as string | undefined),
                applicability: (args.applicability as string | undefined)?.trim(),
                portability: portability(),
                reader: longTermReader,
              });
              emitResult(
                { project, ...result },
                `Created long-term memory candidate ${result.memory.id}. Qualify it after checking its evidence.`,
                asJson,
              );
              return;
            }

            case 'promote': {
              const rawId = (args.fromObservation as string | undefined)?.trim()
                || (args.id as string | undefined)?.trim()
                || longTermPositional[0]?.trim();
              const observationId = Number.parseInt(rawId || '', 10);
              if (!Number.isFinite(observationId)) {
                emitError('fromObservation or id must be an observation ID for "memorix memory long-term promote"', asJson);
                return;
              }
              const observation = getObservation(observationId, project.id);
              if (!observation || !canManageObservation(observation, reader)) {
                emitError('Observation was not found or is outside the active write scope.', asJson);
                return;
              }
              const result = await promoteObservationToLongTermMemory({
                dataDir,
                observation,
                scope: scope(),
                kind: kind(),
                tags: parseCsvList(args.tags as string | undefined),
                applicability: (args.applicability as string | undefined)?.trim(),
                reader: longTermReader,
              });
              emitResult(
                { project, sourceObservationId: observation.id, ...result },
                `Promoted observation #${observation.id} to long-term memory candidate ${result.memory.id}.`,
                asJson,
              );
              return;
            }

            case 'qualify': {
              await getLongTermMemoryDetail({ dataDir, id: memoryId(), reader: longTermReader });
              const memory = await qualifyLongTermMemory({ dataDir, id: memoryId(), reason: reason() });
              emitResult({ project, memory }, `Qualified long-term memory ${memory.id}.`, asJson);
              return;
            }

            case 'approve': {
              await getLongTermMemoryDetail({ dataDir, id: memoryId(), reader: longTermReader });
              const memory = await approveLongTermMemory({ dataDir, id: memoryId(), reason: reason() });
              emitResult({ project, memory }, `Approved long-term memory ${memory.id}.`, asJson);
              return;
            }

            case 'archive': {
              await getLongTermMemoryDetail({ dataDir, id: memoryId(), reader: longTermReader });
              const memory = await archiveLongTermMemory({ dataDir, id: memoryId(), reason: reason() });
              emitResult({ project, memory }, `Archived long-term memory ${memory.id}.`, asJson);
              return;
            }

            case 'supersede': {
              const supersededBy = (args.supersededBy as string | undefined)?.trim()
                || (args['superseded-by'] as string | undefined)?.trim();
              if (!supersededBy) {
                emitError('supersededBy is required for "memorix memory long-term supersede"', asJson);
                return;
              }
              await getLongTermMemoryDetail({ dataDir, id: memoryId(), reader: longTermReader });
              await getLongTermMemoryDetail({ dataDir, id: supersededBy, reader: longTermReader });
              const memory = await supersedeLongTermMemory({
                dataDir,
                id: memoryId(),
                supersededBy,
                reason: reason(),
              });
              emitResult({ project, memory }, `Superseded long-term memory ${memory.id} with ${supersededBy}.`, asJson);
              return;
            }

            default:
              emitError('long-term action must be list, show, add, promote, qualify, approve, archive, or supersede.', asJson);
          }
          return;
        }

        default:
          if (!action) {
            printMemoryUsage();
            return;
          }
          if (!asJson) printMemoryUsage();
          emitError(`Unknown memory action "${action}".`, asJson);
      }
    } catch (error) {
      emitError(error instanceof Error ? error.message : String(error), asJson);
    }
  },
});

function getStringArg(named: string | undefined, positional: string[]): string | undefined {
  const value = named?.trim() || positional.join(' ').trim();
  return value || undefined;
}

function getIdArg(args: Record<string, unknown>, positional: string[]): string {
  return (
    (args.ids as string | undefined) ||
    (args.id as string | undefined) ||
    positional.join(',')
  );
}

function parseObservationId(value: string): number {
  const normalized = value.trim();
  if (!/^[1-9]\d*$/.test(normalized)) {
    throw new Error(`Invalid observation ID: ${value}`);
  }
  const id = Number(normalized);
  if (!Number.isSafeInteger(id)) throw new Error(`Invalid observation ID: ${value}`);
  return id;
}

function parseObservationIds(value: string): number[] {
  const values = parseCsvList(value);
  if (values.length === 0) return [];
  return values.map(parseObservationId);
}

function printMemoryUsage(): void {
  console.log('Memorix Memory Commands');
  console.log('');
  console.log('Usage:');
  console.log('  memorix memory search --query "timeout bug" [--limit 10] [--quality fast|balanced|thorough]');
  console.log('  memorix memory recent [--limit 10]');
  console.log('  memorix memory store --text "..." [--title "..."] [--type discovery] [--visibility project|personal|team]');
  console.log('  memorix memory suggest-topic-key --type decision --title "..."');
  console.log('  memorix memory detail --id 42');
  console.log('  memorix memory detail obs:42@org/project');
  console.log('  memorix memory timeline --id 42 [--before 3 --after 3]');
  console.log('  memorix memory resolve --ids 42,43 [--status resolved|archived] [--dry-run]');
  console.log('  memorix memory deduplicate [--query "..."] [--dryRun]');
  console.log('  memorix memory consolidate [--action preview|execute] [--threshold 0.45]');
  console.log('  memorix memory promote --ids 42,43 [--trigger "..."] [--instruction "..."]');
  console.log('  memorix memory long-term list [--all]');
  console.log('  memorix memory long-term add --kind semantic --scope user --portability portable --title "..." --text "..." [--tags "..."] [--applicability "..."]');
  console.log('  memorix memory long-term promote --fromObservation 42 --kind procedural --scope project');
  console.log('  memorix memory long-term qualify --id <id> --reason "verified against evidence"');
  console.log('  memorix memory long-term approve --id <id> --reason "reviewed by operator"');
  console.log('  memorix memory long-term archive --id <id> --reason "no longer current"');
  console.log('  memorix memory long-term supersede --id <old-id> --superseded-by <qualified-id> --reason "replaced"');
}

function longTermKind(value: string | undefined): 'episodic' | 'semantic' | 'procedural' {
  const normalized = (value ?? 'semantic').trim().toLowerCase();
  if (normalized === 'episodic' || normalized === 'semantic' || normalized === 'procedural') return normalized;
  throw new Error('long-term kind must be episodic, semantic, or procedural.');
}

function longTermScope(value: string | undefined): 'project' | 'user' | 'team' {
  const normalized = (value ?? 'project').trim().toLowerCase();
  if (normalized === 'project' || normalized === 'user' || normalized === 'team') return normalized;
  throw new Error('long-term scope must be project, user, or team.');
}

function longTermPortability(value: string | undefined): 'project-bound' | 'portable' {
  const normalized = (value ?? 'project-bound').trim().toLowerCase();
  if (normalized === 'project-bound' || normalized === 'portable') return normalized;
  throw new Error('long-term portability must be project-bound or portable.');
}

function requiredLongTermReason(value: string | undefined): string {
  const reason = value?.trim();
  if (!reason) throw new Error('reason is required for this long-term memory transition.');
  return reason;
}
