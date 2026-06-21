import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { ensureMemorixPackageRoot, importBundledMemcode } from '../../src/cli/memcode-bootstrap.js';

describe('memcode bootstrap helpers', () => {
  let tempRoot: string | undefined;

  afterEach(() => {
    delete process.env.MEMORIX_PACKAGE_ROOT;
    delete process.env.MEMCODE_PACKAGE_DIR;
    delete process.env.PI_PACKAGE_DIR;
    if (tempRoot) {
      rmSync(tempRoot, { recursive: true, force: true });
      tempRoot = undefined;
    }
  });

  it('sets MEMORIX_PACKAGE_ROOT from a bundled dist/cli entrypoint', () => {
    tempRoot = mkdtempSync(join(tmpdir(), 'memorix-cli-root-'));
    mkdirSync(join(tempRoot, 'dist', 'cli'), { recursive: true });
    writeFileSync(join(tempRoot, 'package.json'), JSON.stringify({ name: 'memorix' }));

    const found = ensureMemorixPackageRoot(join(tempRoot, 'dist', 'cli'));

    expect(found).toBe(tempRoot);
    expect(process.env.MEMORIX_PACKAGE_ROOT).toBe(tempRoot);
  });

  it('loads memcode from the bundled dist entrypoint when present', async () => {
    tempRoot = mkdtempSync(join(tmpdir(), 'memorix-cli-root-'));
    mkdirSync(join(tempRoot, 'dist', 'cli'), { recursive: true });
    mkdirSync(join(tempRoot, 'dist', 'memcode'), { recursive: true });
    mkdirSync(join(tempRoot, 'dist', 'memcode-runtime'), { recursive: true });
    writeFileSync(join(tempRoot, 'package.json'), JSON.stringify({ name: 'memorix' }));
    writeFileSync(join(tempRoot, 'dist', 'memcode-runtime', 'package.json'), JSON.stringify({ name: '@memorix/memcode' }));
    writeFileSync(
      join(tempRoot, 'dist', 'memcode', 'index.js'),
      "export const marker = 'bundled';\nexport function runCli() {}\n",
    );

    const mod = await importBundledMemcode(join(tempRoot, 'dist', 'cli'));

    expect(typeof mod.runCli).toBe('function');
    expect((mod as { marker?: string }).marker).toBe('bundled');
    expect(process.env.MEMORIX_PACKAGE_ROOT).toBe(tempRoot);
    expect(process.env.MEMCODE_PACKAGE_DIR).toBe(join(tempRoot, 'dist', 'memcode-runtime'));
  });

  it('does not overwrite an explicit MEMCODE_PACKAGE_DIR override', async () => {
    tempRoot = mkdtempSync(join(tmpdir(), 'memorix-cli-root-'));
    const explicitPackageDir = join(tempRoot, 'custom-memcode-runtime');
    mkdirSync(join(tempRoot, 'dist', 'cli'), { recursive: true });
    mkdirSync(join(tempRoot, 'dist', 'memcode'), { recursive: true });
    mkdirSync(join(tempRoot, 'dist', 'memcode-runtime'), { recursive: true });
    mkdirSync(explicitPackageDir, { recursive: true });
    process.env.MEMCODE_PACKAGE_DIR = explicitPackageDir;
    writeFileSync(join(tempRoot, 'package.json'), JSON.stringify({ name: 'memorix' }));
    writeFileSync(join(tempRoot, 'dist', 'memcode-runtime', 'package.json'), JSON.stringify({ name: '@memorix/memcode' }));
    writeFileSync(
      join(tempRoot, 'dist', 'memcode', 'index.js'),
      "export const marker = 'bundled-explicit';\nexport function runCli() {}\n",
    );

    const mod = await importBundledMemcode(join(tempRoot, 'dist', 'cli'));

    expect((mod as { marker?: string }).marker).toBe('bundled-explicit');
    expect(process.env.MEMCODE_PACKAGE_DIR).toBe(explicitPackageDir);
  });

  it('does not overwrite an explicit MEMORIX_PACKAGE_ROOT override', () => {
    process.env.MEMORIX_PACKAGE_ROOT = 'E:\\custom\\memorix';

    const found = ensureMemorixPackageRoot('E:\\other\\dist\\cli');

    expect(found).toBe('E:\\custom\\memorix');
    expect(process.env.MEMORIX_PACKAGE_ROOT).toBe('E:\\custom\\memorix');
  });
});
