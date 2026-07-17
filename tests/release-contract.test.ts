import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '..');
const internalWorkspaces = [
  'packages/ai/package.json',
  'packages/agent-core/package.json',
  'packages/tui/package.json',
  'packages/memcode/package.json',
];

describe('release contract', () => {
  it('keeps implementation workspaces private', async () => {
    for (const workspace of internalWorkspaces) {
      const manifest = JSON.parse(await readFile(path.join(repoRoot, workspace), 'utf-8')) as { private?: boolean };
      expect(manifest.private, workspace).toBe(true);
    }
  });

  it('publishes only the supported root package', async () => {
    const workflow = await readFile(path.join(repoRoot, '.github', 'workflows', 'publish.yml'), 'utf-8');
    expect(workflow).toContain('npm publish --provenance --access public');
    expect(workflow).not.toContain('npm publish --workspace @memorix/');
  });

  it('keeps the live Star History image at the end of both READMEs', async () => {
    for (const readme of ['README.md', 'README.zh-CN.md']) {
      const content = await readFile(path.join(repoRoot, readme), 'utf-8');
      expect(content.trimEnd()).toMatch(/\[!\[Star History Chart\]\(https:\/\/api\.star-history\.com\/image\?repos=AVIDS2\/memorix&type=Date\)\]\(https:\/\/star-history\.com\/#AVIDS2\/memorix&Date\)$/);
    }
  });
});
