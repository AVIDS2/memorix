import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getProjectDataDir } from '../../src/store/persistence.js';
import { getResolvedConfig, resetResolvedConfigCache } from '../../src/config/resolved-config.js';
import { resetTomlConfigCache } from '../../src/config/toml-loader.js';
import { resetYamlConfigCache } from '../../src/config/yaml-loader.js';
import { resetConfigCache } from '../../src/config.js';

/**
 * The memory data directory must be controllable ONLY by user-level input
 * (the MEMORIX_DATA_DIR environment variable or the default home path).
 * A hostile repository must never be able to redirect Memorix storage
 * through a project config file. This mirrors the same boundary Claude
 * Code hardened for its Auto Memory directory: project settings are
 * deliberately excluded from the path resolution chain.
 */
describe('data directory boundary', () => {
  const originalDataDir = process.env.MEMORIX_DATA_DIR;
  const TMP = join(process.cwd(), '.tmp-data-dir-boundary-test');
  const HOME = join(TMP, 'home');
  const PROJECT = join(TMP, 'project');
  const ENV_DIR = join(TMP, 'env-data');
  const MALICIOUS_DIR = join(TMP, 'malicious-target');

  beforeEach(() => {
    vi.resetModules();
    rmSync(TMP, { recursive: true, force: true });
    mkdirSync(join(HOME, '.memorix'), { recursive: true });
    mkdirSync(PROJECT, { recursive: true });
    mkdirSync(ENV_DIR, { recursive: true });
    resetTomlConfigCache();
    resetYamlConfigCache();
    resetResolvedConfigCache();
    resetConfigCache();
  });

  afterEach(() => {
    if (originalDataDir === undefined) delete process.env.MEMORIX_DATA_DIR;
    else process.env.MEMORIX_DATA_DIR = originalDataDir;
    rmSync(TMP, { recursive: true, force: true });
  });

  it('ignores data-directory keys in the project TOML config', async () => {
    process.env.MEMORIX_DATA_DIR = ENV_DIR;
    writeFileSync(join(PROJECT, 'memorix.toml'), [
      'dataDir = ' + JSON.stringify(MALICIOUS_DIR),
      'data_dir = ' + JSON.stringify(MALICIOUS_DIR),
      '[memory]',
      'dataDir = ' + JSON.stringify(MALICIOUS_DIR),
      '[store]',
      'path = ' + JSON.stringify(MALICIOUS_DIR),
      '[server]',
      'port = 3211',
    ].join('\n'), 'utf-8');

    // Load the project config so the TOML file is actually parsed.
    const resolved = getResolvedConfig({ projectRoot: PROJECT, homeDir: HOME });
    expect(resolved).toBeDefined();

    const dataDir = await getProjectDataDir('any/project');
    expect(dataDir).toBe(ENV_DIR);
    expect(dataDir).not.toContain('malicious-target');
  });

  it('ignores data-directory keys in the legacy project YAML config', async () => {
    process.env.MEMORIX_DATA_DIR = ENV_DIR;
    writeFileSync(join(PROJECT, 'memorix.yml'), [
      'dataDir: ' + JSON.stringify(MALICIOUS_DIR),
      'memory:',
      '  dataDir: ' + JSON.stringify(MALICIOUS_DIR),
    ].join('\n'), 'utf-8');

    getResolvedConfig({ projectRoot: PROJECT, homeDir: HOME });

    const dataDir = await getProjectDataDir('any/project');
    expect(dataDir).toBe(ENV_DIR);
    expect(dataDir).not.toContain('malicious-target');
  });

  it('falls back to the user home default, never the project config, without the env var', async () => {
    delete process.env.MEMORIX_DATA_DIR;
    writeFileSync(join(PROJECT, 'memorix.toml'), [
      'dataDir = ' + JSON.stringify(MALICIOUS_DIR),
    ].join('\n'), 'utf-8');

    getResolvedConfig({ projectRoot: PROJECT, homeDir: HOME });

    const dataDir = await getProjectDataDir('any/project');
    expect(dataDir).not.toBe(MALICIOUS_DIR);
    expect(dataDir).not.toContain('malicious-target');
  });

  it('keeps the flat shared directory shape regardless of project config', async () => {
    process.env.MEMORIX_DATA_DIR = ENV_DIR;
    writeFileSync(join(PROJECT, 'memorix.toml'), [
      'dataDir = ' + JSON.stringify(MALICIOUS_DIR),
    ].join('\n'), 'utf-8');

    getResolvedConfig({ projectRoot: PROJECT, homeDir: HOME });

    // projectId is metadata only — the directory is the flat shared root.
    const dataDir = await getProjectDataDir('some/other/project');
    expect(dataDir).toBe(ENV_DIR);
  });
});
