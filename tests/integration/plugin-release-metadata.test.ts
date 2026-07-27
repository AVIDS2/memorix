import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { getCliVersion } from '../../src/cli/version.js';

const versionedPluginManifests = [
  'plugins/claude/memorix/.claude-plugin/plugin.json',
  'plugins/codex/memorix/.codex-plugin/plugin.json',
  'plugins/copilot/memorix/plugin.json',
  'plugins/gemini/memorix/gemini-extension.json',
  'plugins/omp/memorix/package.json',
  'plugins/openclaw/memorix/.codex-plugin/plugin.json',
  'plugins/pi/memorix/package.json',
];

describe('shipped plugin release metadata', () => {
  it('keeps every versioned plugin manifest aligned with the published CLI release', async () => {
    for (const manifestPath of versionedPluginManifests) {
      const manifest = JSON.parse(await readFile(path.join(process.cwd(), manifestPath), 'utf-8')) as {
        version?: unknown;
      };
      expect(manifest.version, manifestPath).toBe(getCliVersion());
    }
  });
});
