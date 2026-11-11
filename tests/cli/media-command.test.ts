import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { readSubjectImage } from '../../src/cli/commands/media-image.js';
import { MAX_VISION_IMAGE_BYTES } from '../../src/multimodal/image-payload.js';

describe('media command', () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
  });

  it('rejects an over-limit CLI reference image before reading it', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'memorix-media-command-'));
    temporaryDirectories.push(directory);
    const imagePath = path.join(directory, 'large.png');
    await writeFile(imagePath, '');
    await truncate(imagePath, MAX_VISION_IMAGE_BYTES + 1);

    await expect(readSubjectImage(imagePath)).rejects.toThrow(
      `Reference image exceeds the ${MAX_VISION_IMAGE_BYTES}-byte visual analysis limit`,
    );
  });
});
