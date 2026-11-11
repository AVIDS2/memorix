import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const allowedTrackedSourceArtifacts = new Set([
  'src/dashboard/static/app.js',
  'src/embedding/fastembed.d.ts',
  'src/embedding/transformers.d.ts',
  'src/globals.d.ts',
  'src/types/memcode.d.ts',
]);

function siblingSourceForArtifact(file: string): string {
  return file
    .replace(/\.d\.ts\.map$/, '.ts')
    .replace(/\.d\.ts$/, '.ts')
    .replace(/\.js\.map$/, '.ts')
    .replace(/\.js$/, '.ts');
}

describe('source tree artifacts', () => {
  it('does not track TypeScript build sidecars beside src files', () => {
    const trackedFiles = execFileSync('git', ['ls-files', 'src'], { encoding: 'utf8' })
      .split(/\r?\n/)
      .filter(Boolean);

    const generatedSidecars = trackedFiles.filter((file) => {
      if (!/\.(js|js\.map|d\.ts|d\.ts\.map)$/.test(file)) return false;
      if (allowedTrackedSourceArtifacts.has(file)) return false;
      if (!existsSync(join(process.cwd(), file))) return false;
      return existsSync(join(process.cwd(), siblingSourceForArtifact(file)));
    });

    expect(generatedSidecars).toEqual([]);
  });
});
