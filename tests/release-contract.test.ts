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
    expect(workflow).toContain("grep --quiet 'TLOG_CREATE_ENTRY_ERROR'");
    expect(workflow).toContain('npm publish --access public --ignore-scripts');
    expect(workflow).toContain('npm view "memorix@$version" version');
    expect(workflow).not.toContain('npm publish --workspace @memorix/');
  });

  it('links both READMEs to human-facing Registry and Toplist pages', async () => {
    for (const readme of ['README.md', 'README.zh-CN.md']) {
      const content = await readFile(path.join(repoRoot, readme), 'utf-8');
      expect(content).toContain('https://registry.modelcontextprotocol.io/?q=io.github.AVIDS2%2Fmemorix');
      expect(content).toContain('https://mcptoplist.com/badge/io.github.AVIDS2%2Fmemorix.svg');
      expect(content).toContain('https://mcptoplist.com/server/io.github.AVIDS2%2Fmemorix');
      expect(content).not.toContain('registry.modelcontextprotocol.io/v0/servers?search=');
      expect(content).not.toContain('api.star-history.com');
      expect(content).toContain('https://github.com/AVIDS2/memorix/stargazers');
      expect(content).toContain('https://mem.rglens.com/metrics/star-history-light.svg');
      expect(content).toContain('https://mem.rglens.com/metrics/star-history-dark.svg');
      expect(content).not.toContain('assets/star-history-light.svg');
      expect(content).not.toContain('assets/star-history-dark.svg');
    }
  });

  it('keeps star metrics outside the release PR workflow', async () => {
    await expect(readFile(path.join(repoRoot, '.github', 'workflows', 'star-history.yml'), 'utf-8')).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
});
