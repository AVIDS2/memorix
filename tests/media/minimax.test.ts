import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { readMediaAsset } from '../../src/media/asset-store.js';
import {
  createMiniMaxVideoTask,
  generateMiniMaxImages,
  queryMiniMaxVideoTask,
} from '../../src/media/minimax.js';
import { closeDatabase } from '../../src/store/sqlite-db.js';

const roots: Array<{ root: string; dataDir: string }> = [];
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+XWZ0AAAAASUVORK5CYII=',
  'base64',
);

async function createFixture(): Promise<{ root: string; dataDir: string; projectId: string }> {
  const root = await mkdtemp(path.join(tmpdir(), 'memorix-minimax-'));
  const dataDir = path.join(root, 'data');
  roots.push({ root, dataDir });
  return { root, dataDir, projectId: 'test/minimax-project' };
}

afterEach(async () => {
  for (const item of roots.splice(0)) {
    closeDatabase(item.dataDir);
    await rm(item.root, { recursive: true, force: true });
  }
});

describe('MiniMax controlled image generation', () => {
  it('imports explicit generated output as a controlled asset without auto-attaching memory', async () => {
    const fixture = await createFixture();
    const generate = async (request: any) => {
      expect(request).toMatchObject({
        provider: 'minimax',
        model: 'image-01',
        apiKey: 'test-key',
        prompt: 'A small blue square',
      });
      return {
        responseId: 'provider-image-request',
        output: [{ type: 'image' as const, mimeType: 'image/png', data: PNG_BYTES.toString('base64') }],
      };
    };

    const result = await generateMiniMaxImages({
      dataDir: fixture.dataDir,
      projectId: fixture.projectId,
      apiKey: 'test-key',
      prompt: 'A small blue square',
    }, { generate });

    expect(result).toMatchObject({ provider: 'minimax', model: 'image-01', responseId: 'provider-image-request' });
    expect(result.assets).toHaveLength(1);
    expect(result.assets[0].asset).toMatchObject({
      kind: 'image',
      sourceKind: 'minimax-image',
      sourceLabel: 'minimax-image-01-1',
      provider: 'minimax',
      model: 'image-01',
    });
    await expect(readMediaAsset(fixture.dataDir, result.assets[0].asset)).resolves.toEqual(PNG_BYTES);
  });

  it('forwards reference images to the image generator for image-to-image', async () => {
    const fixture = await createFixture();
    const generate = async (request: any) => {
      expect(request).toMatchObject({
        provider: 'minimax',
        model: 'image-01',
        apiKey: 'test-key',
        prompt: 'Keep the subject and change the background',
        subjectImages: [{ data: PNG_BYTES.toString('base64'), mimeType: 'image/png' }],
      });
      return {
        responseId: 'provider-image-request-2',
        output: [{ type: 'image' as const, mimeType: 'image/png', data: PNG_BYTES.toString('base64') }],
      };
    };

    const result = await generateMiniMaxImages({
      dataDir: fixture.dataDir,
      projectId: fixture.projectId,
      apiKey: 'test-key',
      prompt: 'Keep the subject and change the background',
      subjectImages: [{ data: PNG_BYTES.toString('base64'), mimeType: 'image/png' }],
    }, { generate });

    expect(result).toMatchObject({ provider: 'minimax', model: 'image-01', responseId: 'provider-image-request-2' });
    expect(result.assets).toHaveLength(1);
  });

  it('requires a configured API key before creating a billable request', async () => {
    const fixture = await createFixture();
    await expect(generateMiniMaxImages({
      dataDir: fixture.dataDir,
      projectId: fixture.projectId,
      prompt: 'A small blue square',
      apiKey: '',
    })).rejects.toThrow('MINIMAX_API_KEY is required');
  });

  it('submits the documented V2 video task shape without retrying the request', async () => {
    const fetchMock = async (url: string | URL, request?: RequestInit) => {
      expect(url.toString()).toBe('https://api.example.test/v2/video_generation');
      expect(request).toMatchObject({ method: 'POST' });
      expect(new Headers(request?.headers).get('authorization')).toBe('Bearer test-key');
      expect(JSON.parse(String(request?.body))).toEqual({
        model: 'MiniMax-H3',
        content: [{ type: 'text', text: 'A small test video' }],
        resolution: '2K',
        duration: 5,
        ratio: 'adaptive',
      });
      return new Response(JSON.stringify({ task_id: 'video-task-1' }), { status: 200 });
    };

    await expect(createMiniMaxVideoTask({
      apiKey: 'test-key',
      baseUrl: 'https://api.example.test',
      prompt: 'A small test video',
    }, { fetch: fetchMock as typeof fetch })).resolves.toEqual({ taskId: 'video-task-1', status: 'pending' });
  });

  it('normalizes a succeeded V2 video task and returns its temporary download URL', async () => {
    const fetchMock = async (url: string | URL, request?: RequestInit) => {
      expect(url.toString()).toBe('https://api.example.test/v2/query/video_generation/video-task-1');
      expect(request).toMatchObject({ method: 'GET' });
      return new Response(JSON.stringify({
        task: {
          id: 'video-task-1',
          status: 'succeeded',
          content: { url: 'https://cdn.example.test/result.mp4?temporary=1' },
        },
      }), { status: 200 });
    };

    await expect(queryMiniMaxVideoTask({
      apiKey: 'test-key',
      baseUrl: 'https://api.example.test',
      model: 'MiniMax-H3',
      taskId: 'video-task-1',
    }, { fetch: fetchMock as typeof fetch })).resolves.toEqual({
      taskId: 'video-task-1',
      status: 'succeeded',
      downloadUrl: 'https://cdn.example.test/result.mp4?temporary=1',
    });
  });
});
