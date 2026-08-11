import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { importMediaBuffer, removeMediaAsset } from '../../src/media/asset-store.js';
import { MediaStore } from '../../src/media/media-store.js';
import { queueAudioTranscription, runAudioTranscriptionJob } from '../../src/media/audio-jobs.js';
import { closeDatabase } from '../../src/store/sqlite-db.js';

const roots: Array<{ root: string; dataDir: string }> = [];
const originalOpenAiKey = process.env.OPENAI_API_KEY;
const originalGroqKey = process.env.GROQ_API_KEY;
const originalProvider = process.env.MEMORIX_TRANSCRIPTION_PROVIDER;
const WAV_BYTES = Buffer.concat([
  Buffer.from('RIFF'), Buffer.from([36, 0, 0, 0]), Buffer.from('WAVEfmt '),
  Buffer.from([16, 0, 0, 0, 1, 0, 1, 0, 0x40, 0x1f, 0, 0, 0x80, 0x3e, 0, 0, 2, 0, 16, 0]),
  Buffer.from('data'), Buffer.from([0, 0, 0, 0]),
]);

async function fixture(): Promise<{ root: string; dataDir: string; projectId: string; assetId: string }> {
  const root = await mkdtemp(path.join(tmpdir(), 'memorix-audio-job-'));
  const dataDir = path.join(root, 'data');
  roots.push({ root, dataDir });
  const projectId = 'test/audio-job-project';
  const asset = await importMediaBuffer({ dataDir, projectId, bytes: WAV_BYTES, filename: 'meeting.wav', sourceKind: 'import' });
  return { root, dataDir, projectId, assetId: asset.asset.id };
}

afterEach(async () => {
  vi.unstubAllGlobals();
  if (originalOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalOpenAiKey;
  if (originalGroqKey === undefined) delete process.env.GROQ_API_KEY;
  else process.env.GROQ_API_KEY = originalGroqKey;
  if (originalProvider === undefined) delete process.env.MEMORIX_TRANSCRIPTION_PROVIDER;
  else process.env.MEMORIX_TRANSCRIPTION_PROVIDER = originalProvider;
  for (const item of roots.splice(0)) {
    closeDatabase(item.dataDir);
    await rm(item.root, { recursive: true, force: true });
  }
});

describe('controlled audio transcript derivations', () => {
  it('queues a provider-specific request and stores a transcript derivative without credentials', async () => {
    const input = await fixture();
    process.env.GROQ_API_KEY = 'groq-secret-for-test';
    const queued = queueAudioTranscription({
      ...input,
      assetId: input.assetId,
      provider: 'groq',
      model: 'whisper-large-v3-turbo',
      language: 'en',
    });

    expect(queued.mediaJob).toMatchObject({ kind: 'audio-transcription', status: 'queued', sourceAssetId: input.assetId });
    expect(queued.maintenanceJob).toMatchObject({ kind: 'media-audio-transcription' });
    expect(JSON.stringify(queued.mediaJob)).not.toContain('groq-secret-for-test');

    await expect(runAudioTranscriptionJob(queued.maintenanceJob, input, {
      transcribe: async () => ({ text: 'A durable decision was recorded.', durationSeconds: 3.2, usage: { seconds: 4 } }),
    })).resolves.toEqual({ action: 'complete' });

    const store = new MediaStore(input.dataDir);
    expect(store.getJob(input.projectId, queued.mediaJob.id)).toMatchObject({ status: 'completed', sourceAssetId: input.assetId });
    expect(store.listDerivations(input.projectId, input.assetId)).toMatchObject([{
      kind: 'audio-transcript',
      status: 'ready',
      content: 'A durable decision was recorded.',
      metadata: {
        extractor: 'audio-transcription', provider: 'groq', model: 'whisper-large-v3-turbo',
        billing: { costStatus: 'not-reported', inputAudioSeconds: 4 },
      },
    }]);
  });

  it('fails closed for an unavailable provider before creating a job', async () => {
    const input = await fixture();
    delete process.env.OPENAI_API_KEY;
    await expect(Promise.resolve().then(() => queueAudioTranscription({ ...input, assetId: input.assetId, provider: 'openai' })))
      .rejects.toThrow('OPENAI_API_KEY is required');
    expect(new MediaStore(input.dataDir).listAssets(input.projectId)).toHaveLength(1);
  });

  it('does not call a provider after cancellation or source deletion', async () => {
    const input = await fixture();
    process.env.OPENAI_API_KEY = 'openai-secret-for-test';
    const queued = queueAudioTranscription({ ...input, assetId: input.assetId });
    new MediaStore(input.dataDir).cancelJob(input.projectId, queued.mediaJob.id);
    const transcribe = vi.fn(async () => ({ text: 'must not run' }));
    await runAudioTranscriptionJob(queued.maintenanceJob, input, { transcribe });
    expect(transcribe).not.toHaveBeenCalled();

    const second = queueAudioTranscription({ ...input, assetId: input.assetId });
    await removeMediaAsset({ ...input, assetId: input.assetId });
    await runAudioTranscriptionJob(second.maintenanceJob, input, { transcribe });
    expect(transcribe).not.toHaveBeenCalled();
    expect(new MediaStore(input.dataDir).getJob(input.projectId, second.mediaJob.id)).toMatchObject({ status: 'cancelled' });
  });

  it('retries an explicit provider 429 and uses the Groq-specific endpoint and credential', async () => {
    const input = await fixture();
    process.env.GROQ_API_KEY = 'groq-key-only';
    const queued = queueAudioTranscription({ ...input, assetId: input.assetId, provider: 'groq' });
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe('https://api.groq.com/openai/v1/audio/transcriptions');
      expect(init.headers).toEqual({ Authorization: 'Bearer groq-key-only' });
      return new Response('slow down', { status: 429 });
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(runAudioTranscriptionJob(queued.maintenanceJob, input)).resolves.toMatchObject({ action: 'reschedule', status: 'retry' });
    expect(new MediaStore(input.dataDir).getJob(input.projectId, queued.mediaJob.id)).toMatchObject({ status: 'retry', attempts: 2 });
  });
});
