import { defineCommand } from 'citty';
import { compactSearch } from '../../compact/engine.js';
import { storeObservation } from '../../memory/observations.js';
import { emitError, emitResult, getCliProjectContext, parseCsvList, parsePositiveInt } from './operator-shared.js';

export default defineCommand({
  meta: {
    name: 'reasoning',
    description: 'Store and search decision rationale from the operator CLI',
  },
  args: {
    entity: { type: 'string', description: 'Entity this reasoning applies to' },
    decision: { type: 'string', description: 'Decision that was made' },
    rationale: { type: 'string', description: 'Why this approach was chosen' },
    alternatives: { type: 'string', description: 'Comma-separated alternatives that were considered' },
    constraints: { type: 'string', description: 'Comma-separated constraints' },
    expectedOutcome: { type: 'string', description: 'Expected outcome from this decision' },
    risks: { type: 'string', description: 'Comma-separated risks or downsides' },
    concepts: { type: 'string', description: 'Comma-separated related concepts' },
    files: { type: 'string', description: 'Comma-separated file list' },
    relatedCommits: { type: 'string', description: 'Comma-separated related commit hashes' },
    relatedEntities: { type: 'string', description: 'Comma-separated related entity names' },
    query: { type: 'string', description: 'Search query for reasoning traces' },
    limit: { type: 'string', description: 'Search result limit' },
    scope: { type: 'string', description: 'project or global scope for search' },
    json: { type: 'boolean', description: 'Emit machine-readable JSON output' },
  },
  run: async ({ args }) => {
    const action = (args._ as string[])?.[0] || '';
    const asJson = !!args.json;

    try {
      const { project } = await getCliProjectContext({ searchIndex: action === 'search' });

      switch (action) {
        case 'store': {
          const entityName = (args.entity as string | undefined)?.trim();
          const decision = (args.decision as string | undefined)?.trim();
          const rationale = (args.rationale as string | undefined)?.trim();
          if (!entityName || !decision || !rationale) {
            emitError('entity, decision, and rationale are required for "memorix reasoning store"', asJson);
            return;
          }

          const alternatives = parseCsvList(args.alternatives as string | undefined);
          const constraints = parseCsvList(args.constraints as string | undefined);
          const risks = parseCsvList(args.risks as string | undefined);
          const concepts = parseCsvList(args.concepts as string | undefined);
          const filesModified = parseCsvList(args.files as string | undefined);
          const relatedCommits = parseCsvList(args.relatedCommits as string | undefined);
          const relatedEntities = parseCsvList(args.relatedEntities as string | undefined);

          const narrativeParts: string[] = [rationale];
          if (alternatives.length > 0) {
            narrativeParts.push(`Alternatives considered: ${alternatives.join('; ')}`);
          }
          if (constraints.length > 0) {
            narrativeParts.push(`Constraints: ${constraints.join('; ')}`);
          }
          if (args.expectedOutcome) {
            narrativeParts.push(`Expected outcome: ${String(args.expectedOutcome).trim()}`);
          }
          if (risks.length > 0) {
            narrativeParts.push(`Risks: ${risks.join('; ')}`);
          }

          const result = await storeObservation({
            entityName,
            type: 'reasoning',
            title: decision,
            narrative: narrativeParts.join('. '),
            facts: [
              `Decision: ${decision}`,
              ...alternatives.map((item) => `Alternative: ${item}`),
              ...constraints.map((item) => `Constraint: ${item}`),
              ...(args.expectedOutcome ? [`Expected outcome: ${String(args.expectedOutcome).trim()}`] : []),
              ...risks.map((item) => `Risk: ${item}`),
              ...relatedCommits.map((item) => `Commit: ${item}`),
              ...relatedEntities.map((item) => `Related entity: ${item}`),
            ],
            concepts,
            filesModified,
            relatedCommits,
            relatedEntities,
            projectId: project.id,
            source: 'manual',
          });

          emitResult(
            { project, observation: result.observation, upserted: result.upserted },
            `${result.upserted ? 'Updated' : 'Stored'} reasoning trace #${result.observation.id}: ${decision}`,
            asJson,
          );
          return;
        }

        case 'search': {
          const query = (args.query as string | undefined)?.trim();
          if (!query) {
            emitError('query is required for "memorix reasoning search"', asJson);
            return;
          }
          const scope = (args.scope as string | undefined) === 'global' ? 'global' : 'project';
          const limit = parsePositiveInt(args.limit as string | undefined, 10);
          const result = await compactSearch({
            query,
            limit,
            type: 'reasoning',
            projectId: scope === 'global' ? undefined : project.id,
            status: 'active',
          });
          emitResult(
            { project, scope, entries: result.entries },
            result.entries.length === 0 ? 'No reasoning traces found.' : `🧠 Reasoning traces\n${result.formatted}`,
            asJson,
          );
          return;
        }

        default:
          console.log('Memorix Reasoning Commands');
          console.log('');
          console.log('Usage:');
          console.log('  memorix reasoning store --entity auth --decision "Use SQLite" --rationale "..."');
          console.log('  memorix reasoning search --query "why sqlite" [--scope project|global --limit 10]');
      }
    } catch (error) {
      emitError(error instanceof Error ? error.message : String(error), asJson);
    }
  },
});

