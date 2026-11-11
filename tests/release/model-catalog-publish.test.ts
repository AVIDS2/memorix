import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, afterEach } from 'vitest';
import {
  assertModelCatalogRefreshSafe,
  countGeneratedModels,
} from '../../packages/ai/scripts/generate-models.ts';
import {
  assertImageModelCatalogRefreshSafe,
  countGeneratedImageModels,
} from '../../packages/ai/scripts/generate-image-models.ts';

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

describe('model catalog release safety', () => {
  const oldOverride = process.env.MEMORIX_ALLOW_MODEL_CATALOG_SHRINK;

  afterEach(() => {
    if (oldOverride === undefined) {
      delete process.env.MEMORIX_ALLOW_MODEL_CATALOG_SHRINK;
    } else {
      process.env.MEMORIX_ALLOW_MODEL_CATALOG_SHRINK = oldOverride;
    }
  });

  it('keeps live model refresh out of build and prepublish scripts', () => {
    const rootPackage = readJson<{ scripts: Record<string, string> }>(join(process.cwd(), 'package.json'));
    const aiPackage = readJson<{ scripts: Record<string, string> }>(join(process.cwd(), 'packages/ai/package.json'));

    expect(rootPackage.scripts['update-models']).toBe('npm --workspace @memorix/ai run update-models');
    expect(aiPackage.scripts['update-models']).toBe('npm run generate-models && npm run generate-image-models');
    expect(aiPackage.scripts.build).toBe('tsc -p tsconfig.build.json');
    expect(aiPackage.scripts.prepublishOnly).toBe('npm run clean && npm run build');

    const publishPath = `${rootPackage.scripts.prepublishOnly}\n${aiPackage.scripts.build}\n${aiPackage.scripts.prepublishOnly}`;
    expect(publishPath).not.toMatch(/generate-models|generate-image-models|update-models/);
  });

  it('documents generated catalogs as explicit maintenance artifacts', () => {
    const modelHeader = readFileSync(join(process.cwd(), 'packages/ai/src/models.generated.ts'), 'utf8')
      .split(/\r?\n/)
      .slice(0, 2)
      .join('\n');
    const imageHeader = readFileSync(join(process.cwd(), 'packages/ai/src/image-models.generated.ts'), 'utf8')
      .split(/\r?\n/)
      .slice(0, 2)
      .join('\n');

    expect(modelHeader).toContain("run 'npm run update-models' to update");
    expect(imageHeader).toContain("run 'npm run update-models' to update");
  });

  it('rejects shrunken live catalog refreshes unless explicitly overridden', () => {
    expect(countGeneratedModels({ openrouter: { a: {}, b: {} }, anthropic: { c: {} } })).toBe(3);
    expect(countGeneratedImageModels({ openrouter: { a: {}, b: {} } })).toBe(2);

    expect(() => assertModelCatalogRefreshSafe(400, 1000)).toThrow(/Refusing to write shrunken model catalog/);
    expect(() => assertImageModelCatalogRefreshSafe(10, 35)).toThrow(/Refusing to write shrunken image model catalog/);

    process.env.MEMORIX_ALLOW_MODEL_CATALOG_SHRINK = '1';
    expect(() => assertModelCatalogRefreshSafe(400, 1000)).not.toThrow();
    expect(() => assertImageModelCatalogRefreshSafe(10, 35)).not.toThrow();
  });
});
