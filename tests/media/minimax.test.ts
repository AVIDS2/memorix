import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { readMediaAsset } from '../../src/media/asset-store.js';
import { generateMiniMaxImages } from '../../src/media/minimax.js';
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

  it('requires a configured API key before creating a billable request', async () => {
    const fixture = await createFixture();
    await expect(generateMiniMaxImages({
      dataDir: fixture.dataDir,
      projectId: fixture.projectId,
      prompt: 'A small blue square',
      apiKey: '',
    })).rejects.toThrow('MINIMAX_API_KEY is required');
  });
});
