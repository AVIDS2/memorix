import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = join(__dirname, '../..');
const dockerfilePath = join(repoRoot, 'Dockerfile');
const composePath = join(repoRoot, 'compose.yaml');
const readmePath = join(repoRoot, 'README.md');
const setupPath = join(repoRoot, 'docs/SETUP.md');

describe('official Docker deployment artifacts', () => {
  it('ships a Dockerfile that starts the HTTP control plane', () => {
    const dockerfile = readFileSync(dockerfilePath, 'utf8');

    expect(dockerfile).toContain('serve-http');
    expect(dockerfile).toContain('0.0.0.0');
    expect(dockerfile).toContain('3211');
    expect(dockerfile).toMatch(/^USER\s+node\s*$/m);
  });

  it('ships a compose file with port 3211 and a healthcheck', () => {
    expect(existsSync(composePath)).toBe(true);

    const compose = readFileSync(composePath, 'utf8');
    expect(compose).toContain('3211:3211');
    expect(compose.toLowerCase()).toContain('healthcheck');
    expect(compose).toContain('/health');
  });

  it('documents Docker as an official HTTP control-plane deployment path', () => {
    const readme = readFileSync(readmePath, 'utf8');
    const setup = readFileSync(setupPath, 'utf8');

    expect(readme).toContain('Docker');
    expect(readme).toContain('compose');
    expect(setup).toContain('Docker');
    expect(setup).toContain('compose');
    expect(setup).toContain('3211');
  });
});
