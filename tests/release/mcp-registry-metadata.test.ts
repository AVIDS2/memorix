import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

interface RegistryPackage {
  registryType: string;
  identifier: string;
  version: string;
  transport: { type: string };
  packageArguments?: Array<{ type: string; value?: string }>;
}

describe('MCP Registry release metadata', () => {
  it('binds the published npm package to the official Registry record', () => {
    const packageJson = readJson<{ name: string; version: string; mcpName: string; files: string[] }>(
      join(process.cwd(), 'package.json'),
    );
    const manifest = readJson<{
      $schema: string;
      name: string;
      version: string;
      description: string;
      packages: RegistryPackage[];
    }>(join(process.cwd(), 'server.json'));
    const npmPackage = manifest.packages.find(
      (entry) => entry.registryType === 'npm' && entry.identifier === packageJson.name,
    );

    expect(packageJson.mcpName).toBe('io.github.AVIDS2/memorix');
    expect(manifest.$schema).toBe('https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json');
    expect(manifest.name).toBe(packageJson.mcpName);
    expect(manifest.version).toBe(packageJson.version);
    expect(manifest.description.length).toBeLessThanOrEqual(100);
    expect(packageJson.files).toContain('server.json');
    expect(npmPackage).toMatchObject({
      version: packageJson.version,
      transport: { type: 'stdio' },
    });
    expect(npmPackage?.packageArguments).toContainEqual({ type: 'positional', value: 'serve' });
  });

  it('keeps Registry publication behind npm publication and GitHub OIDC', () => {
    const workflow = readFileSync(join(process.cwd(), '.github', 'workflows', 'publish.yml'), 'utf8');

    expect(workflow).toContain('npm publish --provenance --access public');
    expect(workflow).toContain('mcp-publisher login github-oidc');
    expect(workflow).toContain('mcp-publisher publish server.json');
    expect(workflow.indexOf('npm publish --provenance --access public')).toBeLessThan(
      workflow.indexOf('mcp-publisher publish server.json'),
    );
  });
});
