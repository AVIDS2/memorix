import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const manifest = JSON.parse(await readFile(join(root, 'server.json'), 'utf8'));
const failures = [];

const npmPackage = manifest.packages?.find(
  (entry) => entry.registryType === 'npm' && entry.identifier === packageJson.name,
);

if (manifest.$schema !== 'https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json') {
  failures.push('server.json must use the supported official MCP Registry schema.');
}

if (manifest.name !== packageJson.mcpName) {
  failures.push('server.json name must match package.json mcpName.');
}

if (manifest.version !== packageJson.version) {
  failures.push('server.json version must match package.json version.');
}

if (!npmPackage) {
  failures.push(`server.json must contain an npm package entry for ${packageJson.name}.`);
} else {
  if (npmPackage.version !== packageJson.version) {
    failures.push('server.json npm package version must match package.json version.');
  }

  if (npmPackage.transport?.type !== 'stdio') {
    failures.push('Memorix Registry metadata must describe the stdio transport.');
  }

  const startsStdioServer = npmPackage.packageArguments?.some(
    (argument) => argument.type === 'positional' && argument.value === 'serve',
  );
  if (!startsStdioServer) {
    failures.push('Memorix Registry metadata must invoke the memorix serve command.');
  }
}

if (typeof manifest.description !== 'string' || manifest.description.length === 0 || manifest.description.length > 100) {
  failures.push('server.json description must be non-empty and at most 100 characters.');
}

if (!Array.isArray(packageJson.files) || !packageJson.files.includes('server.json')) {
  failures.push('package.json files must include server.json.');
}

if (failures.length > 0) {
  throw new Error(`MCP Registry metadata check failed:\n- ${failures.join('\n- ')}`);
}

console.log(`MCP Registry metadata is ready for ${manifest.name}@${manifest.version}.`);
