import { defineCommand } from 'citty';
import { getAllAuditEntries, getProjectId } from '../../audit/index.js';
import { auditProjectObservations } from '../../memory/attribution-guard.js';
import { getAllObservations } from '../../memory/observations.js';
import { emitError, emitResult, getCliProjectContext } from './operator-shared.js';

export default defineCommand({
  meta: {
    name: 'audit',
    description: 'Inspect Memorix audit trail and project attribution health',
  },
  args: {
    project: { type: 'string', description: 'Project root used to filter audit entries' },
    threshold: { type: 'string', description: 'Minimum suspicious occurrence count for project audits' },
    json: { type: 'boolean', description: 'Emit machine-readable JSON output' },
  },
  run: async ({ args }) => {
    const action = (args._ as string[])?.[0] || '';
    const asJson = !!args.json;

    try {
      switch (action) {
        case 'list': {
          const entries = await getAllAuditEntries();
          const projectFilter = args.project ? getProjectId(String(args.project)) : undefined;
          const filtered = projectFilter
            ? entries.filter((entry) => entry.projectId === projectFilter)
            : entries;
          emitResult(
            { entries: filtered },
            filtered.length === 0
              ? 'Audit trail is empty.'
              : filtered
                  .map(({ projectId, entry }) => `- ${projectId}: ${entry.path} (${entry.type})`)
                  .join('\n'),
            asJson,
          );
          return;
        }

        case 'project': {
          const { project } = await getCliProjectContext();
          const threshold = Number.parseInt(String(args.threshold ?? '2'), 10) || 2;
          const entries = await auditProjectObservations(project.id, getAllObservations(), threshold);
          emitResult(
            { project, entries, threshold },
            entries.length === 0
              ? `No suspicious observations found in project "${project.id}".`
              : entries
                  .map((entry) => `- #${entry.id} ${entry.title} -> ${entry.likelyBelongsTo}`)
                  .join('\n'),
            asJson,
          );
          return;
        }

        default:
          console.log('Memorix Audit Commands');
          console.log('');
          console.log('Usage:');
          console.log('  memorix audit list [--project /abs/path]');
          console.log('  memorix audit project [--threshold 2]');
      }
    } catch (error) {
      emitError(error instanceof Error ? error.message : String(error), asJson);
    }
  },
});
