import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const packagePath = join(root, 'package.json');
const manifestPath = join(root, 'server.json');

const packageJson = JSON.parse(await readFile(packagePath, 'utf8'));
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));

if (typeof packageJson.mcpName !== 'string' || packageJson.mcpName.length === 0) {
  throw new Error('package.json must declare mcpName before the Registry manifest can be synchronized.');
}

const npmPackage = manifest.packages?.find(
  (entry) => entry.registryType === 'npm' && entry.identifier === packageJson.name,
);

if (!npmPackage) {
  throw new Error(`server.json must contain an npm package entry for ${packageJson.name}.`);
}

manifest.name = packageJson.mcpName;
manifest.version = packageJson.version;
npmPackage.version = packageJson.version;

const next = `${JSON.stringify(manifest, null, 2)}\n`;
const current = await readFile(manifestPath, 'utf8');

if (current !== next) {
  await writeFile(manifestPath, next, 'utf8');
  console.log(`Synchronized server.json for memorix@${packageJson.version}.`);
} else {
  console.log(`server.json already matches memorix@${packageJson.version}.`);
}
