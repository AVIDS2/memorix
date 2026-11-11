import { defineCommand } from 'citty';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { exportAsJson, exportAsMarkdown, importFromJson } from '../../memory/export-import.js';
import { emitError, emitResult, getCliProjectContext } from './operator-shared.js';

async function readStandardInput(): Promise<string> {
  return new Promise((resolve, reject) => {
    let content = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      content += chunk;
    });
    process.stdin.on('end', () => resolve(content));
    process.stdin.on('error', reject);
  });
}

async function readImportPayload(args: Record<string, unknown>, projectRoot: string): Promise<string> {
  const data = typeof args.data === 'string' ? args.data.trim() : '';
  const file = typeof args.file === 'string' ? args.file.trim() : '';
  const readFromStdin = args.stdin === true || data === '-';
  const sources = Number(Boolean(data && data !== '-')) + Number(Boolean(file)) + Number(readFromStdin);
  if (sources !== 1) {
    throw new Error('Choose exactly one import source: --data <json>, --file <path>, or --stdin.');
  }
  if (readFromStdin) return readStandardInput();
  if (file) return fs.readFile(path.resolve(projectRoot, file), 'utf8');
  return data;
}

async function writeExportPayload(projectRoot: string, output: string, payload: string): Promise<string> {
  const outputPath = path.resolve(projectRoot, output);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, payload, 'utf8');
  return outputPath;
}

export default defineCommand({
  meta: {
    name: 'transfer',
    description: 'Export or import project memory snapshots',
  },
  args: {
    format: { type: 'string', description: 'Export format: json or markdown' },
    data: { type: 'string', description: 'JSON payload from a previous export' },
    file: { type: 'string', description: 'File containing a JSON payload to import' },
    stdin: { type: 'boolean', description: 'Read a JSON import payload from standard input' },
    out: { type: 'string', description: 'Write the export payload to this file instead of stdout' },
    json: { type: 'boolean', description: 'Emit machine-readable JSON output' },
  },
  run: async ({ args }) => {
    const action = (args._ as string[])?.[0] || '';
    const asJson = !!args.json;

    try {
      const { project, dataDir, reader } = await getCliProjectContext();

      switch (action) {
        case 'export': {
          const format = (args.format as string | undefined) === 'markdown' ? 'markdown' : 'json';
          if (format === 'markdown') {
            const markdown = await exportAsMarkdown(dataDir, project.id, reader);
            const output = (args.out as string | undefined)?.trim();
            if (output) {
              const outputPath = await writeExportPayload(project.rootPath, output, markdown);
              emitResult({ project, format, outputPath }, `Export written: ${outputPath}`, asJson);
              return;
            }
            emitResult({ project, format, markdown }, markdown, asJson);
            return;
          }
          const exported = await exportAsJson(dataDir, project.id, reader);
          const serialized = JSON.stringify(exported, null, 2);
          const output = (args.out as string | undefined)?.trim();
          if (output) {
            const outputPath = await writeExportPayload(project.rootPath, output, `${serialized}\n`);
            emitResult(
              { project, format, outputPath, stats: exported.stats },
              `Export written: ${outputPath}`,
              asJson,
            );
            return;
          }
          emitResult(
            { project, format, export: exported },
            serialized,
            asJson,
          );
          return;
        }

        case 'import': {
          const raw = (await readImportPayload(args as Record<string, unknown>, project.rootPath)).trim();
          if (!raw) throw new Error('Import payload is empty.');
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
          console.log('  memorix transfer export [--format json|markdown] [--out ./.memorix-export.json]');
          console.log('  memorix transfer import --file ./.memorix-export.json');
          console.log('  memorix transfer import --stdin');
          console.log('  memorix transfer import --data "<json>"');
      }
    } catch (error) {
      emitError(error instanceof Error ? error.message : String(error), asJson);
    }
  },
});

