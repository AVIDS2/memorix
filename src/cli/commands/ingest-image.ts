import { defineCommand } from 'citty';
import path from 'node:path';
import { analyzeImage } from '../../multimodal/image-loader.js';
import { attachMediaAssetToObservation } from '../../media/attachment.js';
import { importMediaFile, readMediaAsset } from '../../media/asset-store.js';
import { MediaStore } from '../../media/media-store.js';
import { emitError, emitResult, getCliProjectContext, resolveCliWriteScope } from './operator-shared.js';

export default defineCommand({
  meta: {
    name: 'image',
    description: 'Analyze an image and store the result as memory',
  },
  args: {
    path: { type: 'string', description: 'Path to the image file' },
    prompt: { type: 'string', description: 'Custom analysis prompt' },
    mimeType: { type: 'string', description: 'Explicit MIME type override' },
    visibility: { type: 'string', description: 'Memory visibility: project (default), personal, or team' },
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
      const { project, dataDir, reader, identity } = await getCliProjectContext();
      const resolvedPath = path.resolve(project.rootPath, imagePath);
      const filename = path.basename(resolvedPath);
      const imported = await importMediaFile({
        dataDir,
        projectId: project.id,
        filePath: resolvedPath,
        sourceKind: 'import',
        sourceLabel: filename,
      });
      if (imported.asset.kind !== 'image') {
        throw new Error(`Expected an image file, detected ${imported.asset.mimeType}`);
      }

      let analysis: { description: string; tags: string[]; entities: string[] };
      let analysisWarning: string | undefined;
      try {
        const bytes = await readMediaAsset(dataDir, imported.asset);
        analysis = await analyzeImage({
          base64: bytes.toString('base64'),
          filename,
          mimeType: (args.mimeType as string | undefined) || imported.asset.mimeType,
          prompt: args.prompt as string | undefined,
        });
      } catch (error) {
        analysis = {
          description: `Imported image asset ${filename}. Visual analysis is unavailable; use the asset reference for high-fidelity inspection.`,
          tags: ['image', imported.asset.mimeType],
          entities: [],
        };
        analysisWarning = error instanceof Error ? error.message : String(error);
      }

      new MediaStore(dataDir).addDerivation({
        projectId: project.id,
        assetId: imported.asset.id,
        kind: 'description',
        content: analysis.description,
        status: 'ready',
      });
      const observation = await attachMediaAssetToObservation({
        dataDir,
        projectId: project.id,
        asset: imported.asset,
        entityName: filename.replace(/\.[^.]+$/, '') || `image-${Date.now()}`,
        title: `Image analysis: ${filename}`,
        narrative: analysis.description,
        concepts: analysis.tags,
        facts: analysis.entities,
        ...resolveCliWriteScope({ reader, identity }, args.visibility as string | undefined),
      });

      emitResult(
        { project, asset: imported.asset, deduplicated: imported.deduplicated, analysis, analysisWarning, observation },
        `Stored image analysis #${observation.id}: ${filename}`,
        asJson,
      );
    } catch (error) {
      emitError(error instanceof Error ? error.message : String(error), asJson);
    }
  },
});
