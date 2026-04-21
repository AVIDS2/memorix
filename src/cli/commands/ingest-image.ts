import { defineCommand } from 'citty';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { analyzeImage } from '../../multimodal/image-loader.js';
import { storeObservation } from '../../memory/observations.js';
import { emitError, emitResult, getCliProjectContext } from './operator-shared.js';

function inferMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.gif':
      return 'image/gif';
    case '.webp':
      return 'image/webp';
    default:
      return 'image/png';
  }
}

export default defineCommand({
  meta: {
    name: 'image',
    description: 'Analyze an image and store the result as memory',
  },
  args: {
    path: { type: 'string', description: 'Path to the image file' },
    prompt: { type: 'string', description: 'Custom analysis prompt' },
    mimeType: { type: 'string', description: 'Explicit MIME type override' },
    json: { type: 'boolean', description: 'Emit machine-readable JSON output' },
  },
  run: async ({ args }) => {
    const asJson = !!args.json;
    try {
      const imagePath = (args.path as string | undefined)?.trim();
      if (!imagePath) {
        emitError('path is required for "memorix ingest image"', asJson);
        return;
      }
      const { project } = await getCliProjectContext();
      const resolvedPath = path.resolve(process.cwd(), imagePath);
      const base64 = readFileSync(resolvedPath).toString('base64');
      const filename = path.basename(resolvedPath);
      const analysis = await analyzeImage({
        base64,
        filename,
        mimeType: (args.mimeType as string | undefined) || inferMimeType(resolvedPath),
        prompt: args.prompt as string | undefined,
      });

      const result = await storeObservation({
        entityName: filename.replace(/\.[^.]+$/, '') || `image-${Date.now()}`,
        type: 'discovery',
        title: `Image analysis: ${filename}`,
        narrative: analysis.description,
        concepts: analysis.tags,
        facts: analysis.entities,
        projectId: project.id,
        source: 'manual',
      });

      emitResult(
        { project, analysis, observation: result.observation },
        `Stored image analysis #${result.observation.id}: ${filename}`,
        asJson,
      );
    } catch (error) {
      emitError(error instanceof Error ? error.message : String(error), asJson);
    }
  },
});
