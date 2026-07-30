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

  it('links both READMEs to the official MCP Registry without stale listing images', async () => {
    for (const readme of ['README.md', 'README.zh-CN.md']) {
      const content = await readFile(path.join(repoRoot, readme), 'utf-8');
      expect(content).toContain('https://registry.modelcontextprotocol.io/v0/servers?search=io.github.AVIDS2%2Fmemorix');
      expect(content).not.toContain('mcptoplist.com');
      expect(content).not.toContain('api.star-history.com');
    }
  });
});
