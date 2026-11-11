import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { getCliVersion } from '../../src/cli/version.js';

const versionedPluginManifests = [
  { path: 'plugins/antigravity/memorix/plugin.json', format: 'json' },
  { path: 'plugins/claude/memorix/.claude-plugin/plugin.json', format: 'json' },
  { path: 'plugins/codex/memorix/.codex-plugin/plugin.json', format: 'json' },
  { path: 'plugins/copilot/memorix/plugin.json', format: 'json' },
  { path: 'plugins/gemini/memorix/gemini-extension.json', format: 'json' },
  { path: 'plugins/hermes/memorix/plugin.yaml', format: 'yaml' },
  { path: 'plugins/omp/memorix/package.json', format: 'json' },
  { path: 'plugins/openclaw/memorix/.codex-plugin/plugin.json', format: 'json' },
  { path: 'plugins/pi/memorix/package.json', format: 'json' },
];

describe('shipped plugin release metadata', () => {
  it('keeps every versioned plugin manifest aligned with the published CLI release', async () => {
    for (const entry of versionedPluginManifests) {
      const raw = await readFile(path.join(process.cwd(), entry.path), 'utf-8');
      const version = entry.format === 'json'
        ? (JSON.parse(raw) as { version?: unknown }).version
        : raw.match(/^version:\s*["']?([^"'\r\n]+)["']?\s*$/m)?.[1];
      expect(version, entry.path).toBe(getCliVersion());
    }
  });
});
