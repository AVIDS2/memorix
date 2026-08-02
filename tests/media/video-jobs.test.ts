import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { MediaStore } from '../../src/media/media-store.js';
import {
  queueMiniMaxVideoGeneration,
  runMiniMaxVideoGenerationJob,
} from '../../src/media/video-jobs.js';
import { closeDatabase } from '../../src/store/sqlite-db.js';

const roots: Array<{ root: string; dataDir: string }> = [];
const originalApiKey = process.env.MINIMAX_API_KEY;
const MP4_BYTES = Buffer.from([
  0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70,
  0x69, 0x73, 0x6f, 0x6d, 0x00, 0x00, 0x02, 0x00,
]);

async function createFixture(): Promise<{ root: string; dataDir: string; projectId: string }> {
  const root = await mkdtemp(path.join(tmpdir(), 'memorix-video-job-'));
  const dataDir = path.join(root, 'data');
  roots.push({ root, dataDir });
  process.env.MINIMAX_API_KEY = 'test-video-key';
  return { root, dataDir, projectId: 'test/video-job-project' };
}

afterEach(async () => {
  if (originalApiKey === undefined) delete process.env.MINIMAX_API_KEY;
  else process.env.MINIMAX_API_KEY = originalApiKey;
  for (const item of roots.splice(0)) {
    closeDatabase(item.dataDir);
    await rm(item.root, { recursive: true, force: true });
  }
});

describe('MiniMax durable video jobs', () => {
  it('stores only a safe durable request, then imports a completed result into the asset store', async () => {
    const fixture = await createFixture();
    const queued = queueMiniMaxVideoGeneration({
      dataDir: fixture.dataDir,
      projectId: fixture.projectId,
      prompt: 'A tiny blue cube rotates',
      ratio: '16:9',
    });

    expect(queued.mediaJob).toMatchObject({ status: 'queued', kind: 'minimax-video-generation' });
    expect(queued.maintenanceJob).toMatchObject({ kind: 'media-video-generation' });
    expect(queued.maintenanceJob.payload).toEqual({ mediaJobId: queued.mediaJob.id });
    expect(JSON.stringify(queued.mediaJob)).not.toContain('test-video-key');

    const submitted = await runMiniMaxVideoGenerationJob(
      queued.maintenanceJob,
      fixture,
      { createTask: async () => ({ taskId: 'provider-video-1', status: 'pending' }) },
    );
    expect(submitted).toMatchObject({ action: 'reschedule' });

    const afterSubmit = new MediaStore(fixture.dataDir).getJob(fixture.projectId, queued.mediaJob.id)!;
    expect(afterSubmit).toMatchObject({ status: 'provider-pending', providerTaskId: 'provider-video-1', attempts: 1 });

    const finished = await runMiniMaxVideoGenerationJob(
      queued.maintenanceJob,
      fixture,
      {
        queryTask: async () => ({
          taskId: 'provider-video-1',
          status: 'succeeded',
          downloadUrl: 'https://cdn.example.test/private-result.mp4?signature=not-persisted',
        }),
        download: async () => MP4_BYTES,
      },
    );
    expect(finished).toEqual({ action: 'complete' });

    const completed = new MediaStore(fixture.dataDir).getJob(fixture.projectId, queued.mediaJob.id)!;
    expect(completed).toMatchObject({ status: 'completed', providerTaskId: 'provider-video-1' });
    expect(completed.assetId).toBeTruthy();
    expect(JSON.stringify(completed)).not.toContain('private-result');

    const asset = new MediaStore(fixture.dataDir).getAsset(fixture.projectId, completed.assetId!)!;
    expect(asset).toMatchObject({ kind: 'video', mimeType: 'video/mp4', sourceKind: 'minimax-video' });
    expect(asset.sourceLabel).not.toContain('private-result');
  });

  it('fails a submission exactly once instead of resubmitting a possibly billable request', async () => {
    const fixture = await createFixture();
    const queued = queueMiniMaxVideoGeneration({
      dataDir: fixture.dataDir,
      projectId: fixture.projectId,
      prompt: 'A failed submission must not be duplicated',
    });

    await expect(runMiniMaxVideoGenerationJob(
      queued.maintenanceJob,
      fixture,
      { createTask: async () => { throw new Error('provider submission timeout'); } },
    )).resolves.toEqual({ action: 'complete' });

    const job = new MediaStore(fixture.dataDir).getJob(fixture.projectId, queued.mediaJob.id)!;
    expect(job).toMatchObject({ status: 'failed', attempts: 1 });
    expect(job.providerTaskId).toBeUndefined();
  });

  it('does not call the provider after an operator cancels the job', async () => {
    const fixture = await createFixture();
    const queued = queueMiniMaxVideoGeneration({
      dataDir: fixture.dataDir,
      projectId: fixture.projectId,
      prompt: 'Do not submit after cancellation',
    });
    new MediaStore(fixture.dataDir).cancelJob(fixture.projectId, queued.mediaJob.id);
    let createCalled = false;

    await expect(runMiniMaxVideoGenerationJob(
      queued.maintenanceJob,
      fixture,
      { createTask: async () => { createCalled = true; return { taskId: 'unexpected', status: 'pending' }; } },
    )).resolves.toEqual({ action: 'complete' });

    expect(createCalled).toBe(false);
  });

  it('sanitizes request text and the deferred observation title before job persistence', async () => {
    const fixture = await createFixture();
    const promptSecret = 'sk-abcdefghijklmnopqrstuvwxyz1234';
    const titleSecret = 'api_key=supersecretvalue';
    const queued = queueMiniMaxVideoGeneration({
      dataDir: fixture.dataDir,
      projectId: fixture.projectId,
      prompt: `Render this token ${promptSecret}`,
      observationTitle: `Generated media ${titleSecret}`,
    });

    const stored = new MediaStore(fixture.dataDir).getJob(fixture.projectId, queued.mediaJob.id)!;
    expect(JSON.stringify(stored)).toContain('[REDACTED]');
    expect(JSON.stringify(stored)).not.toContain(promptSecret);
    expect(JSON.stringify(stored)).not.toContain('supersecretvalue');
  });
});
