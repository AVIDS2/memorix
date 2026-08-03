import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const checkOnly = process.argv.includes('--check');

const versionedPluginManifests = [
  'plugins/claude/memorix/.claude-plugin/plugin.json',
  'plugins/codex/memorix/.codex-plugin/plugin.json',
  'plugins/copilot/memorix/plugin.json',
  'plugins/gemini/memorix/gemini-extension.json',
  'plugins/omp/memorix/package.json',
  'plugins/openclaw/memorix/.codex-plugin/plugin.json',
  'plugins/pi/memorix/package.json',
];

const mismatches = [];

for (const relativePath of versionedPluginManifests) {
  const manifestPath = join(root, relativePath);
  const raw = await readFile(manifestPath, 'utf8');
  const manifest = JSON.parse(raw);

  if (manifest.version === packageJson.version) continue;

  mismatches.push(`${relativePath}: ${String(manifest.version)} -> ${packageJson.version}`);
  if (!checkOnly) {
    manifest.version = packageJson.version;
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
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
