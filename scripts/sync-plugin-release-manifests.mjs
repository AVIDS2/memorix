import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const checkOnly = process.argv.includes('--check');

const versionedPluginManifests = [
  { path: 'plugins/antigravity/memorix/plugin.json', format: 'json' },
  { path: 'plugins/claude/memorix/.claude-plugin/plugin.json', format: 'json' },
  { path: 'plugins/codebuddy/memorix/.codebuddy-plugin/plugin.json', format: 'json' },
  { path: 'plugins/codex/memorix/.codex-plugin/plugin.json', format: 'json' },
  { path: 'plugins/copilot/memorix/plugin.json', format: 'json' },
  { path: 'plugins/gemini/memorix/gemini-extension.json', format: 'json' },
  { path: 'plugins/hermes/memorix/plugin.yaml', format: 'yaml' },
  { path: 'plugins/omp/memorix/package.json', format: 'json' },
  { path: 'plugins/openclaw/memorix/.codex-plugin/plugin.json', format: 'json' },
  { path: 'plugins/pi/memorix/package.json', format: 'json' },
];

const mismatches = [];

for (const entry of versionedPluginManifests) {
  const manifestPath = join(root, entry.path);
  const raw = await readFile(manifestPath, 'utf8');
  const currentVersion = entry.format === 'json'
    ? JSON.parse(raw).version
    : raw.match(/^version:\s*["']?([^"'\r\n]+)["']?\s*$/m)?.[1];

  if (currentVersion === packageJson.version) continue;

  mismatches.push(`${entry.path}: ${String(currentVersion)} -> ${packageJson.version}`);
  if (!checkOnly) {
    if (entry.format === 'json') {
      const manifest = JSON.parse(raw);
      manifest.version = packageJson.version;
      await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    } else {
      const next = raw.replace(/^(version:\s*)(["']?)[^"'\r\n]+\2(\s*)$/m, `$1"${packageJson.version}"$3`);
      if (next === raw) throw new Error(`Could not update version in ${entry.path}.`);
      await writeFile(manifestPath, next, 'utf8');
    }
  }
}

if (checkOnly && mismatches.length > 0) {
  throw new Error(`Plugin release metadata is out of sync:\n- ${mismatches.join('\n- ')}`);
}

if (mismatches.length === 0) {
  console.log(`Plugin release metadata already matches memorix@${packageJson.version}.`);
} else if (checkOnly) {
  console.log(`Plugin release metadata matches memorix@${packageJson.version}.`);
} else {
  console.log(`Synchronized plugin release metadata for memorix@${packageJson.version}.`);
}
