import { defineCommand } from 'citty';
import { exportAsJson, exportAsMarkdown, importFromJson } from '../../memory/export-import.js';
import { emitError, emitResult, getCliProjectContext } from './operator-shared.js';

export default defineCommand({
  meta: {
    name: 'transfer',
    description: 'Export or import project memory snapshots',
  },
  args: {
    format: { type: 'string', description: 'Export format: json or markdown' },
    data: { type: 'string', description: 'JSON payload from a previous export' },
    json: { type: 'boolean', description: 'Emit machine-readable JSON output' },
  },
  run: async ({ args }) => {
    const action = (args._ as string[])?.[0] || '';
    const asJson = !!args.json;

    try {
      const { project, dataDir } = await getCliProjectContext();

      switch (action) {
        case 'export': {
          const format = (args.format as string | undefined) === 'markdown' ? 'markdown' : 'json';
          if (format === 'markdown') {
            const markdown = await exportAsMarkdown(dataDir, project.id);
            emitResult({ project, format, markdown }, markdown, asJson);
            return;
          }
          const exported = await exportAsJson(dataDir, project.id);
          emitResult(
            { project, format, export: exported },
            JSON.stringify(exported, null, 2),
            asJson,
          );
          return;
        }

        case 'import': {
          const raw = (args.data as string | undefined)?.trim();
          if (!raw) {
            emitError('data is required for "memorix transfer import"', asJson);
            return;
          }
          let parsed: Parameters<typeof importFromJson>[1];
          try {
            parsed = JSON.parse(raw);
          } catch (error) {
            emitError(`Invalid JSON import payload: ${error instanceof Error ? error.message : String(error)}`, asJson);
            return;
          }
          const result = await importFromJson(dataDir, parsed);
          emitResult(
            { project, result },
            `Import complete: ${result.observationsImported} observation(s), ${result.sessionsImported} session(s), ${result.skipped} skipped.`,
            asJson,
          );
          return;
        }

        default:
          console.log('Memorix Transfer Commands');
          console.log('');
          console.log('Usage:');
          console.log('  memorix transfer export [--format json|markdown]');
          console.log('  memorix transfer import --data "<json>"');
      }
    } catch (error) {
      emitError(error instanceof Error ? error.message : String(error), asJson);
    }
  },
});

