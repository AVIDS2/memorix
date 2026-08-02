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

  it('links both READMEs to human-facing Registry and Toplist pages', async () => {
    for (const readme of ['README.md', 'README.zh-CN.md']) {
      const content = await readFile(path.join(repoRoot, readme), 'utf-8');
      expect(content).toContain('https://registry.modelcontextprotocol.io/?q=io.github.AVIDS2%2Fmemorix');
      expect(content).toContain('https://mcptoplist.com/badge/io.github.AVIDS2%2Fmemorix.svg');
      expect(content).toContain('https://mcptoplist.com/server/io.github.AVIDS2%2Fmemorix');
      expect(content).not.toContain('registry.modelcontextprotocol.io/v0/servers?search=');
      expect(content).not.toContain('api.star-history.com');
      expect(content).toContain('https://github.com/AVIDS2/memorix/stargazers');
      expect(content).toContain('assets/star-history-light.svg');
      expect(content).toContain('assets/star-history-dark.svg');
    }

    for (const asset of ['star-history.json', 'star-history-light.svg', 'star-history-dark.svg']) {
      const content = await readFile(path.join(repoRoot, 'assets', asset), 'utf-8');
      expect(content.length, asset).toBeGreaterThan(0);
    }
  });

  it('refreshes self-hosted star history assets without a long-lived secret', async () => {
    const workflow = await readFile(path.join(repoRoot, '.github', 'workflows', 'star-history.yml'), 'utf-8');

    expect(workflow).toContain('schedule:');
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toContain('GITHUB_TOKEN: ${{ github.token }}');
    expect(workflow).toContain('contents: write');
    expect(workflow).not.toContain('STAR_HISTORY_TOKEN');
  });
});
