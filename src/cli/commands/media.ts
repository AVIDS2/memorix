import { defineCommand } from 'citty';

import { loadDotenv } from '../../config/dotenv-loader.js';
import { attachMediaAssetToObservation } from '../../media/attachment.js';
import { embedMediaAsset, findSimilarMediaAssets } from '../../media/embedding.js';
import {
  cleanupMediaQuota,
  importMediaFile,
  removeMediaAsset,
} from '../../media/asset-store.js';
import { MediaStore } from '../../media/media-store.js';
import {
  generateMiniMaxImages,
  type MiniMaxImageGenerationInput,
  type MiniMaxVideoGenerationRequest,
} from '../../media/minimax.js';
import { launchMediaVideoRunner, queueMiniMaxVideoGeneration } from '../../media/video-jobs.js';
import type { MediaKind } from '../../media/types.js';
import {
  emitError,
  emitResult,
  getCliProjectContext,
  getCliReadContext,
  parsePositiveInt,
  resolveCliWriteScope,
} from './operator-shared.js';

function getValue(value: unknown, positional: string[] = []): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : positional[0]?.trim() || undefined;
}

function parseMediaKind(value: unknown): MediaKind | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'image' || normalized === 'audio' || normalized === 'video' || normalized === 'document') {
    return normalized;
  }
  throw new Error('kind must be image, audio, video, or document');
}

function parseByteLimit(value: unknown, fallback: number): number {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string' && typeof value !== 'number') throw new Error('maxBytes must be a positive integer');
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error('maxBytes must be a non-negative integer');
  return parsed;
}

function parseOptionalInteger(value: unknown, label: string, minimum: number, maximum: number): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${label} must be a whole number between ${minimum} and ${maximum}`);
  }
  return parsed;
}

function parseAspectRatio(value: unknown): MiniMaxImageGenerationInput['aspectRatio'] | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const ratio = String(value).trim();
  const allowed = new Set(['1:1', '16:9', '4:3', '3:2', '2:3', '3:4', '9:16', '21:9']);
  if (!allowed.has(ratio)) throw new Error('ratio must be one of 1:1, 16:9, 4:3, 3:2, 2:3, 3:4, 9:16, or 21:9');
  return ratio as MiniMaxImageGenerationInput['aspectRatio'];
}

function parseMiniMaxModel(value: unknown): MiniMaxImageGenerationInput['model'] | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const model = String(value).trim();
  if (model === 'image-01' || model === 'image-01-live') return model;
  throw new Error('MiniMax image model must be image-01 or image-01-live');
}

function parseMiniMaxRegion(value: unknown): MiniMaxImageGenerationInput['region'] | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const region = String(value).trim().toLowerCase();
  if (region === 'global' || region === 'cn') return region;
  throw new Error('MiniMax region must be global or cn');
}

function parseMiniMaxVideoModel(value: unknown): MiniMaxVideoGenerationRequest['model'] | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const model = String(value).trim();
  if (model === 'MiniMax-H3') return model;
  throw new Error('MiniMax video model must be MiniMax-H3');
}

function parseMiniMaxVideoRatio(value: unknown): MiniMaxVideoGenerationRequest['ratio'] | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const ratio = String(value).trim();
  if (ratio === 'adaptive' || ratio === '16:9' || ratio === '9:16' || ratio === '1:1') return ratio;
  throw new Error('MiniMax video ratio must be adaptive, 16:9, 9:16, or 1:1');
}

function parseMiniMaxVideoDuration(value: unknown): MiniMaxVideoGenerationRequest['duration'] | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const duration = Number(value);
  if (duration === 5 || duration === 10) return duration;
  throw new Error('MiniMax video duration must be 5 or 10 seconds');
}

function parseMiniMaxVideoResolution(value: unknown): MiniMaxVideoGenerationRequest['resolution'] | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (String(value).trim() === '2K') return '2K';
  throw new Error('MiniMax video resolution must be 2K');
}

function help(): string {
  return [
    'Memorix Media Commands',
    '',
    '  memorix media import --path ./diagram.png',
    '  memorix media list [--kind image]',
    '  memorix media show --asset <asset-id>',
    '  memorix media attach --asset <asset-id> [--title "Architecture"] [--text "..."]',
    '  memorix media embed --asset <asset-id>',
    '  memorix media similar --asset <asset-id> [--limit 10]',
    '  memorix media generate image --prompt "..." [--model image-01] [--attach]',
    '  memorix media generate video --prompt "..." [--model MiniMax-H3] [--duration 5] [--ratio 16:9] [--attach]',
    '  memorix media status --job <media-job-id>',
    '  memorix media cancel --job <media-job-id>',
    '  memorix media remove --asset <asset-id> [--force]',
    '  memorix media cleanup [--maxBytes 1073741824]',
    '',
    'Generated output is stored as a controlled asset. Use --attach to add it to memory explicitly.',
  ].join('\n');
}

export default defineCommand({
  meta: {
    name: 'media',
    description: 'Import, attach, inspect, and clean controlled local media assets',
  },
  args: {
    action: { type: 'string', description: 'Media action' },
    path: { type: 'string', description: 'Local file to import' },
    asset: { type: 'string', description: 'Media asset ID' },
    kind: { type: 'string', description: 'Filter: image, audio, video, or document' },
    title: { type: 'string', description: 'Observation title when attaching' },
    text: { type: 'string', description: 'Observation narrative when attaching' },
    entity: { type: 'string', description: 'Observation entity when attaching' },
    concepts: { type: 'string', description: 'Comma-separated concepts when attaching' },
    visibility: { type: 'string', description: 'Observation visibility when attaching' },
    prompt: { type: 'string', description: 'Generation prompt' },
    model: { type: 'string', description: 'Provider model' },
    region: { type: 'string', description: 'MiniMax region: global or cn' },
    n: { type: 'string', description: 'Generated image count (1-4)' },
    ratio: { type: 'string', description: 'Image or video aspect ratio' },
    width: { type: 'string', description: 'Requested image width' },
    height: { type: 'string', description: 'Requested image height' },
    seed: { type: 'string', description: 'Optional image seed' },
    duration: { type: 'string', description: 'MiniMax video duration: 5 or 10 seconds' },
    resolution: { type: 'string', description: 'MiniMax video resolution: 2K' },
    job: { type: 'string', description: 'Media job ID for status or cancellation' },
    attach: { type: 'boolean', description: 'Explicitly attach generated output to memory' },
    promptOptimizer: { type: 'boolean', description: 'Enable MiniMax prompt optimization' },
    'prompt-optimizer': { type: 'boolean', description: 'Kebab-case alias for --promptOptimizer' },
    limit: { type: 'string', description: 'List limit' },
    maxBytes: { type: 'string', description: 'Import or cleanup byte limit' },
    'max-bytes': { type: 'string', description: 'Kebab-case alias for --maxBytes' },
    force: { type: 'boolean', description: 'Detach linked observations before removal' },
    json: { type: 'boolean', description: 'Emit machine-readable JSON output' },
  },
  run: async ({ args }) => {
    const action = ((args._ as string[])?.[0] || (args.action as string | undefined) || '').trim().toLowerCase();
    const positional = ((args._ as string[]) ?? []).slice(1);
    const asJson = !!args.json;

    try {
      switch (action) {
        case 'generate':
        case 'generate-image':
        case 'generate-video': {
          const target = action === 'generate'
            ? (positional.shift() ?? '').trim().toLowerCase()
            : action === 'generate-video' ? 'video' : 'image';
          if (target !== 'image' && target !== 'video') {
            throw new Error(`Unsupported media generation target: ${target || '(missing)'}. Use "image" or "video".`);
          }
          const prompt = getValue(args.prompt, positional);
          if (!prompt) throw new Error(`prompt is required for "memorix media generate ${target}"`);
          const { project, dataDir, reader, identity } = await getCliProjectContext();
          // Image/video credentials can live in a project .env. This must be
          // loaded before the explicit request is validated or submitted.
          loadDotenv(project.rootPath);
          if (target === 'video') {
            const queued = queueMiniMaxVideoGeneration({
              dataDir,
              projectId: project.id,
              prompt,
              model: parseMiniMaxVideoModel(args.model),
              region: parseMiniMaxRegion(args.region),
              duration: parseMiniMaxVideoDuration(args.duration),
              ratio: parseMiniMaxVideoRatio(args.ratio),
              resolution: parseMiniMaxVideoResolution(args.resolution),
              maxBytes: parseByteLimit(args.maxBytes ?? args['max-bytes'], 100 * 1024 * 1024),
              attachOnComplete: args.attach === true,
              observationTitle: (args.title as string | undefined)?.trim(),
            });
            const runner = launchMediaVideoRunner({
              projectId: project.id,
              projectRoot: project.rootPath,
              dataDir,
              mediaJobId: queued.mediaJob.id,
            });
            emitResult(
              { project, ...queued, runner },
              runner.launched
                ? `Queued MiniMax video job ${queued.mediaJob.id}; generation continues in the background.`
                : `Queued MiniMax video job ${queued.mediaJob.id}. ${runner.reason ?? 'Run a Memorix server or invoke media status after building to resume it.'}`,
              asJson,
            );
            return;
          }
          const generated = await generateMiniMaxImages({
            dataDir,
            projectId: project.id,
            prompt,
            model: parseMiniMaxModel(args.model),
            region: parseMiniMaxRegion(args.region),
            n: parseOptionalInteger(args.n, 'n', 1, 4),
            aspectRatio: parseAspectRatio(args.ratio),
            width: parseOptionalInteger(args.width, 'width', 1, 8_192),
            height: parseOptionalInteger(args.height, 'height', 1, 8_192),
            seed: parseOptionalInteger(args.seed, 'seed', 0, 2_147_483_647),
            promptOptimizer: args.promptOptimizer === true || args['prompt-optimizer'] === true,
            maxBytes: parseByteLimit(args.maxBytes ?? args['max-bytes'], 100 * 1024 * 1024),
          });
          const observations = args.attach === true
            ? await Promise.all(generated.assets.map(({ asset }) => attachMediaAssetToObservation({
              dataDir,
              projectId: project.id,
              asset,
              title: `MiniMax image: ${asset.sourceLabel ?? asset.id}`,
              narrative: `Generated with ${generated.provider}/${generated.model}. Prompt: ${prompt}`,
              concepts: ['generated-image', 'minimax', generated.model],
              ...resolveCliWriteScope({ reader, identity }, args.visibility as string | undefined),
            })))
            : [];
          emitResult(
            { project, ...generated, observations },
            `Generated ${generated.assets.length} controlled image asset(s)${observations.length > 0 ? ` and attached ${observations.length} to memory` : ''}.`,
            asJson,
          );
          return;
        }
        case 'status': {
          const jobId = getValue(args.job, positional);
          if (!jobId) throw new Error('job is required for "memorix media status"');
          const { project, dataDir } = await getCliProjectContext();
          const job = new MediaStore(dataDir).getJob(project.id, jobId);
          if (!job) throw new Error(`Media job not found: ${jobId}`);
          const runner = job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled'
            ? undefined
            : launchMediaVideoRunner({
              projectId: project.id,
              projectRoot: project.rootPath,
              dataDir,
              mediaJobId: job.id,
            });
          emitResult(
            { project, job, ...(runner ? { runner } : {}) },
            `${job.kind} ${job.id}: ${job.status}${job.assetId ? ` (${job.assetId})` : ''}`,
            asJson,
          );
          return;
        }
        case 'cancel': {
          const jobId = getValue(args.job, positional);
          if (!jobId) throw new Error('job is required for "memorix media cancel"');
          const { project, dataDir } = await getCliProjectContext();
          const job = new MediaStore(dataDir).cancelJob(project.id, jobId);
          emitResult({ project, job }, `Cancelled media job ${job.id}`, asJson);
          return;
        }
        case 'import': {
          const filePath = getValue(args.path, positional);
          if (!filePath) throw new Error('path is required for "memorix media import"');
          const { project, dataDir } = await getCliProjectContext();
          const result = await importMediaFile({
            dataDir,
            projectId: project.id,
            filePath,
            maxBytes: parseByteLimit(args.maxBytes ?? args['max-bytes'], 100 * 1024 * 1024),
          });
          emitResult(
            { project, ...result },
            `${result.deduplicated ? 'Reused' : 'Imported'} ${result.asset.kind} asset ${result.asset.id}`,
            asJson,
          );
          return;
        }
        case 'list': {
          const { project, dataDir } = await getCliReadContext();
          const assets = new MediaStore(dataDir).listAssets(project.id, {
            kind: parseMediaKind(args.kind),
            limit: parsePositiveInt(args.limit as string | undefined, 50),
          });
          emitResult(
            { project, assets },
            assets.length === 0
              ? 'No media assets.'
              : assets.map((asset) => `- ${asset.id} ${asset.kind} ${asset.sourceLabel ?? asset.sha256.slice(0, 12)}`).join('\n'),
            asJson,
          );
          return;
        }
        case 'show': {
          const assetId = getValue(args.asset, positional);
          if (!assetId) throw new Error('asset is required for "memorix media show"');
          const { project, dataDir } = await getCliReadContext();
          const store = new MediaStore(dataDir);
          const asset = store.getAsset(project.id, assetId);
          if (!asset) throw new Error(`Media asset not found: ${assetId}`);
          const links = store.listLinks(project.id, asset.id);
          const derivations = store.listDerivations(project.id, asset.id);
          emitResult(
            { project, asset, links, derivations },
            `${asset.kind} ${asset.id}\n${asset.mimeType}, ${asset.byteSize} bytes, ${links.length} link(s)`,
            asJson,
          );
          return;
        }
        case 'attach': {
          const assetId = getValue(args.asset, positional);
          if (!assetId) throw new Error('asset is required for "memorix media attach"');
          const { project, dataDir, reader, identity } = await getCliProjectContext();
          const store = new MediaStore(dataDir);
          const asset = store.getAsset(project.id, assetId);
          if (!asset) throw new Error(`Media asset not found: ${assetId}`);
          const description = store.listDerivations(project.id, asset.id)
            .find((item) => item.kind === 'description' && item.status === 'ready')?.content;
          const concepts = typeof args.concepts === 'string'
            ? args.concepts.split(',').map((value) => value.trim()).filter(Boolean)
            : [];
          const observation = await attachMediaAssetToObservation({
            dataDir,
            projectId: project.id,
            asset,
            title: (args.title as string | undefined)?.trim() || `Media asset: ${asset.sourceLabel ?? asset.id}`,
            narrative: (args.text as string | undefined)?.trim() || description,
            entityName: (args.entity as string | undefined)?.trim(),
            concepts,
            ...resolveCliWriteScope({ reader, identity }, args.visibility as string | undefined),
          });
          emitResult(
            { project, asset, observation },
            `Attached ${asset.id} to memory #${observation.id}`,
            asJson,
          );
          return;
        }
        case 'remove': {
          const assetId = getValue(args.asset, positional);
          if (!assetId) throw new Error('asset is required for "memorix media remove"');
          const { project, dataDir } = await getCliProjectContext();
          const result = await removeMediaAsset({
            dataDir,
            projectId: project.id,
            assetId,
            force: args.force === true,
          });
          emitResult(
            { project, ...result },
            result.pendingDelete
              ? `Removed media asset ${assetId}; its staged file is pending cleanup because another process still holds it.`
              : `Removed media asset ${assetId}`,
            asJson,
          );
          return;
        }
        case 'embed': {
          const assetId = getValue(args.asset, positional);
          if (!assetId) throw new Error('asset is required for "memorix media embed"');
          const { project, dataDir } = await getCliProjectContext();
          const result = await embedMediaAsset({ dataDir, projectId: project.id, assetId, timeoutMs: 8_000 });
          emitResult(
            { project, ...result },
            result.status === 'embedded'
              ? `Embedded ${assetId} with profile ${result.profileKey}`
              : result.reason,
            asJson,
          );
          return;
        }
        case 'similar': {
          const assetId = getValue(args.asset, positional);
          if (!assetId) throw new Error('asset is required for "memorix media similar"');
          const { project, dataDir } = await getCliReadContext();
          const matches = findSimilarMediaAssets({
            dataDir,
            projectId: project.id,
            assetId,
            limit: parsePositiveInt(args.limit as string | undefined, 10),
          });
          emitResult(
            { project, assetId, matches },
            matches.length === 0
              ? 'No compatible media embeddings found. Run "memorix media embed --asset <id>" with a multimodal embedding provider first.'
              : matches.map((match) => `- ${match.asset.id} ${match.score.toFixed(3)} ${match.asset.sourceLabel ?? ''}`).join('\n'),
            asJson,
          );
          return;
        }
        case 'cleanup': {
          const { project, dataDir } = await getCliProjectContext();
          const result = await cleanupMediaQuota({
            dataDir,
            projectId: project.id,
            maxBytes: parseByteLimit(args.maxBytes ?? args['max-bytes'], 1024 * 1024 * 1024),
          });
          emitResult(
            { project, ...result },
            `Media cleanup: ${result.removed.length} asset(s), ${result.beforeBytes} -> ${result.afterBytes} active bytes` +
              `${result.reclaimedTrashBytes > 0 ? `; reclaimed ${result.reclaimedTrashBytes} staged bytes` : ''}` +
              `${result.pendingTrashFiles > 0 ? `; ${result.pendingTrashFiles} staged file(s) (${result.pendingTrashBytes} bytes) still pending` : ''}`,
            asJson,
          );
          return;
        }
        default:
          emitResult({ usage: help() }, help(), asJson);
      }
    } catch (error) {
      emitError(error instanceof Error ? error.message : String(error), asJson);
    }
  },
});
