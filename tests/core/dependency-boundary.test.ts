import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('memory kernel dependency boundary', () => {
  it('does not import hosts, persistence, search adapters, or runtime jobs', async () => {
    const directory = path.resolve('src/core');
    const files = (await readdir(directory)).filter((name) => name.endsWith('.ts'));
    const violations: string[] = [];
    for (const file of files) {
      const source = await readFile(path.join(directory, file), 'utf8');
      const imports = source.matchAll(/(?:from\s*|import\s*\(\s*)['"](\.\.\/[^'"]+)['"]/g);
      for (const [, dependency] of imports) {
        if (/^\.\.\/(?:server|store|search|runtime|memory|cli|dashboard|codegraph)\//.test(dependency)) {
          violations.push(`${file}: ${dependency}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
