import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/embedding/provider.js', () => ({
  getEmbeddingProvider: async () => null,
  isVectorSearchAvailable: async () => false,
  isEmbeddingExplicitlyDisabled: () => true,
  resetProvider: () => {},
}));

vi.mock('../../src/llm/provider.js', () => ({
  initLLM: () => null,
  isLLMEnabled: () => false,
  getLLMConfig: () => null,
}));

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { resetDotenv } from '../../src/config/dotenv-loader.js';
import { createMemorixServer } from '../../src/server.js';
import { resetDb } from '../../src/store/orama-store.js';
import { resetObservationStore } from '../../src/store/obs-store.js';
import { closeAllDatabases } from '../../src/store/sqlite-db.js';

const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+XWZ0AAAAASUVORK5CYII=',
  'base64',
);
const WAV_BYTES = Buffer.concat([
  Buffer.from('RIFF'), Buffer.from([36, 0, 0, 0]), Buffer.from('WAVEfmt '),
  Buffer.from([16, 0, 0, 0, 1, 0, 1, 0, 0x40, 0x1f, 0, 0, 0x80, 0x3e, 0, 0, 2, 0, 16, 0]),
  Buffer.from('data'), Buffer.from([0, 0, 0, 0]),
]);

function buildPdf(text: string): Buffer {
  const stream = `BT\n/F1 12 Tf\n72 720 Td\n(${text.replace(/[\\()]/g, '\\$&')}) Tj\nET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 5 0 R >> >> /MediaBox [0 0 612 792] /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let document = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(document));
    document += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(document);
  document += 'xref\n0 6\n0000000000 65535 f \n';
  offsets.slice(1).forEach((offset) => { document += `${String(offset).padStart(10, '0')} 00000 n \n`; });
  return Buffer.from(`${document}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);
}

function getHandler(server: any, name: string): (args: Record<string, unknown>) => Promise<any> {
  const handler = server._registeredTools?.[name]?.handler;
  expect(handler).toBeTypeOf('function');
  return handler;
}

function readJson(result: any): any {
  expect(result?.isError).not.toBe(true);
  const text = result?.content?.find((part: any) => part?.type === 'text')?.text;
  expect(typeof text).toBe('string');
  return JSON.parse(text);
}

describe('controlled media through MCP', () => {
  const priorDataDir = process.env.MEMORIX_DATA_DIR;
  const priorApiKey = process.env.MINIMAX_API_KEY;
  const priorMcpMediaGeneration = process.env.MEMORIX_MCP_MEDIA_GENERATION;
  const priorMcpMediaTranscription = process.env.MEMORIX_MCP_MEDIA_TRANSCRIPTION;
  const priorGroqApiKey = process.env.GROQ_API_KEY;
  let root = '';
  let projectRoot = '';
  let dataDir = '';

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'memorix-media-mcp-'));
    projectRoot = path.join(root, 'project');
    dataDir = path.join(root, 'data');
    await fs.mkdir(path.join(projectRoot, '.git'), { recursive: true });
    await fs.writeFile(path.join(projectRoot, 'diagram.png'), PNG_BYTES);
    await fs.writeFile(path.join(projectRoot, 'design.pdf'), buildPdf('MCP PDF evidence'));
    await fs.writeFile(path.join(projectRoot, 'meeting.wav'), WAV_BYTES);
    process.env.MEMORIX_DATA_DIR = dataDir;
    process.env.MINIMAX_API_KEY = 'mcp-test-key';
    delete process.env.MEMORIX_MCP_MEDIA_GENERATION;
    delete process.env.MEMORIX_MCP_MEDIA_TRANSCRIPTION;
    process.env.GROQ_API_KEY = 'mcp-groq-key';
    resetDotenv();
    resetObservationStore();
    await resetDb();
  });

  afterEach(async () => {
    if (priorDataDir === undefined) delete process.env.MEMORIX_DATA_DIR;
    else process.env.MEMORIX_DATA_DIR = priorDataDir;
    if (priorApiKey === undefined) delete process.env.MINIMAX_API_KEY;
    else process.env.MINIMAX_API_KEY = priorApiKey;
    if (priorMcpMediaGeneration === undefined) delete process.env.MEMORIX_MCP_MEDIA_GENERATION;
    else process.env.MEMORIX_MCP_MEDIA_GENERATION = priorMcpMediaGeneration;
    if (priorMcpMediaTranscription === undefined) delete process.env.MEMORIX_MCP_MEDIA_TRANSCRIPTION;
    else process.env.MEMORIX_MCP_MEDIA_TRANSCRIPTION = priorMcpMediaTranscription;
    if (priorGroqApiKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = priorGroqApiKey;
    resetDotenv();
    resetObservationStore();
    await resetDb();
    closeAllDatabases();
    await fs.rm(root, { recursive: true, force: true });
  });

  it('uses the explicit project binding rather than a transport session for media lifecycle actions', async () => {
    const { server, projectId, getRequestContext } = await createMemorixServer(
      projectRoot,
      undefined,
      undefined,
      { toolProfile: 'lite' },
    );
    expect(getRequestContext()).toMatchObject({ projectId, explicit: false, source: 'startup-cwd' });
    const sessionStart = getHandler(server as any, 'memorix_session_start');
    const started = await sessionStart({ projectRoot, agent: 'media-mcp-test' });
    expect(started.isError).not.toBe(true);
    expect(getRequestContext()).toMatchObject({
      projectId,
      projectRoot,
      explicit: true,
      source: 'explicit-project-root',
    });
    const media = getHandler(server as any, 'memorix_media');

    const imported = readJson(await media({
      action: 'import',
      path: path.join(projectRoot, 'diagram.png'),
      title: 'Architecture diagram',
      attach: true,
    }));
    expect(imported).toMatchObject({ action: 'import', projectId, asset: { kind: 'image' } });
    expect(imported.observation).toMatchObject({ projectId, title: 'Architecture diagram' });

    const listed = readJson(await media({ action: 'list', kind: 'image' }));
    expect(listed.assets).toHaveLength(1);

    const shown = readJson(await media({ action: 'show', assetId: imported.asset.id }));
    expect(shown.links).toHaveLength(1);
    expect(shown.links[0]).toMatchObject({ role: 'attachment', observationId: imported.observation.id });
  });

  it('queues video generation without placing provider credentials in MCP output', async () => {
    const { server } = await createMemorixServer(projectRoot, undefined, undefined, { toolProfile: 'lite' });
    const media = getHandler(server as any, 'memorix_media');

    const disabled = await media({
      action: 'generate-video',
      prompt: 'A tiny blue cube rotates slowly',
      model: 'MiniMax-H3',
    });
    expect(disabled.isError).toBe(true);
    expect(disabled.content?.[0]?.text).toContain('MCP media generation is disabled');

    process.env.MEMORIX_MCP_MEDIA_GENERATION = '1';

    const queued = readJson(await media({
      action: 'generate-video',
      prompt: 'A tiny blue cube rotates slowly',
      model: 'MiniMax-H3',
      ratio: '16:9',
    }));
    expect(queued).toMatchObject({
      action: 'generate-video',
      mediaJob: { kind: 'minimax-video-generation', status: 'queued' },
      maintenanceJob: { kind: 'media-video-generation' },
    });
    expect(JSON.stringify(queued)).not.toContain('mcp-test-key');

    delete process.env.MEMORIX_MCP_MEDIA_GENERATION;
    const cancelled = readJson(await media({ action: 'cancel', jobId: queued.mediaJob.id }));
    expect(cancelled).toMatchObject({
      action: 'cancel',
      projectId: queued.projectId,
      job: { id: queued.mediaJob.id, status: 'cancelled' },
    });
  });

  it('keeps the legacy image tool on the controlled asset lifecycle', async () => {
    const { server, projectId } = await createMemorixServer(projectRoot, undefined, undefined, { toolProfile: 'full' });
    const legacyIngest = getHandler(server as any, 'memorix_ingest_image');
    const legacyResult = await legacyIngest({
      base64: PNG_BYTES.toString('base64'),
      filename: 'legacy-diagram.png',
    });
    expect(legacyResult.isError).not.toBe(true);
    const text = legacyResult.content?.[0]?.text ?? '';
    expect(text).toContain('Image imported and analyzed');
    expect(text).toContain('Visual analysis fallback was used.');

    const media = getHandler(server as any, 'memorix_media');
    const listed = readJson(await media({ action: 'list', kind: 'image' }));
    expect(listed).toMatchObject({ projectId, assets: [{ sourceLabel: 'legacy-diagram.png' }] });
    const shown = readJson(await media({ action: 'show', assetId: listed.assets[0].id }));
    expect(shown.links).toHaveLength(1);
    expect(shown.derivations).toMatchObject([{ kind: 'description', status: 'ready' }]);
  });

  it('derives bounded PDF text through the same controlled MCP lifecycle', async () => {
    const { server } = await createMemorixServer(projectRoot, undefined, undefined, { toolProfile: 'lite' });
    const media = getHandler(server as any, 'memorix_media');
    const imported = readJson(await media({ action: 'import', path: path.join(projectRoot, 'design.pdf') }));

    const rawDerived = await media({
      action: 'derive-pdf',
      assetId: imported.asset.id,
      maxPages: 10,
      maxChars: 1_000,
      attach: true,
    });
    const derived = readJson(rawDerived);

    expect(derived).toMatchObject({
      action: 'derive-pdf',
      derivation: { kind: 'pdf-text', status: 'ready', metadata: { pageCount: 1 } },
    });
    expect(derived.observations).toHaveLength(1);
    expect(derived.derivation.content).toContain('MCP PDF evidence');
  });

  it('keeps MCP audio transcription opt-in and provider credentials out of its durable response', async () => {
    const { server } = await createMemorixServer(projectRoot, undefined, undefined, { toolProfile: 'lite' });
    const media = getHandler(server as any, 'memorix_media');
    const imported = readJson(await media({ action: 'import', path: path.join(projectRoot, 'meeting.wav') }));

    const disabled = await media({ action: 'derive-audio', assetId: imported.asset.id, provider: 'groq' });
    expect(disabled.isError).toBe(true);
    expect(disabled.content?.[0]?.text).toContain('MCP audio transcription is disabled');

    process.env.MEMORIX_MCP_MEDIA_TRANSCRIPTION = '1';
    const queued = readJson(await media({ action: 'derive-audio', assetId: imported.asset.id, provider: 'groq' }));
    expect(queued).toMatchObject({
      action: 'derive-audio',
      mediaJob: { kind: 'audio-transcription', sourceAssetId: imported.asset.id, status: 'queued' },
      maintenanceJob: { kind: 'media-audio-transcription' },
    });
    expect(JSON.stringify(queued)).not.toContain('mcp-groq-key');
  });

  it('rejects invalid legacy base64 before it can become a controlled asset', async () => {
    const { server, projectId } = await createMemorixServer(projectRoot, undefined, undefined, { toolProfile: 'full' });
    const legacyIngest = getHandler(server as any, 'memorix_ingest_image');
    const result = await legacyIngest({ base64: 'not base64' });
    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text).toContain('base64 image data is invalid');

    const media = getHandler(server as any, 'memorix_media');
    const listed = readJson(await media({ action: 'list', kind: 'image' }));
    expect(listed).toMatchObject({ projectId, assets: [] });
  });

  it('treats a subdirectory-discovered explicit root as an explicit binding', async () => {
    const { server, getRequestContext, handleTransportClose } = await createMemorixServer(
      root,
      undefined,
      undefined,
      {
        allowUntrackedFallback: false,
        deferProjectInitUntilBound: true,
        dashboardMode: 'control-plane',
        toolProfile: 'lite',
      },
    );
    try {
      const sessionStart = getHandler(server as any, 'memorix_session_start');
      const started = await sessionStart({ projectRoot: root, agent: 'nested-workspace-test' });
      expect(started.isError).not.toBe(true);
      expect(getRequestContext()).toMatchObject({
        projectRoot,
        explicit: true,
        source: 'explicit-project-root',
      });
    } finally {
      handleTransportClose();
    }
  });
});
