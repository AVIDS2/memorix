import { beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  getGlobalConfigTomlPath,
  getProjectConfigTomlPath,
} from '../../src/config/config-paths.js';
import { loadTomlConfig, resetTomlConfigCache } from '../../src/config/toml-loader.js';

describe('config paths', () => {
  it('builds global and project TOML paths deterministically', () => {
    expect(getGlobalConfigTomlPath('C:\\Users\\Test')).toBe(join('C:\\Users\\Test', '.memorix', 'config.toml'));
    expect(getProjectConfigTomlPath('E:\\repo\\demo')).toBe(join('E:\\repo\\demo', 'memorix.toml'));
  });
});

const TMP = join(process.cwd(), '.tmp-toml-loader-test');
const HOME = join(TMP, 'home');
const PROJECT = join(TMP, 'project');

describe('loadTomlConfig', () => {
  beforeEach(() => {
    rmSync(TMP, { recursive: true, force: true });
    mkdirSync(join(HOME, '.memorix'), { recursive: true });
    mkdirSync(PROJECT, { recursive: true });
    resetTomlConfigCache();
  });

  it('loads global config.toml', () => {
    writeFileSync(join(HOME, '.memorix', 'config.toml'), '[memory]\ninject = "minimal"\n', 'utf8');

    expect(loadTomlConfig({ projectRoot: null, homeDir: HOME }).memory?.inject).toBe('minimal');
  });

  it('lets project memorix.toml override global config.toml', () => {
    writeFileSync(join(HOME, '.memorix', 'config.toml'), '[memory]\ninject = "silent"\n', 'utf8');
    writeFileSync(join(PROJECT, 'memorix.toml'), '[memory]\ninject = "full"\n', 'utf8');

    expect(loadTomlConfig({ projectRoot: PROJECT, homeDir: HOME }).memory?.inject).toBe('full');
  });

  it('parses nested tables and primitive values used by Memorix config', () => {
    writeFileSync(join(HOME, '.memorix', 'config.toml'), [
      '[agent]',
      'provider = "deepseek"',
      'model = "deepseek-chat"',
      'base_url = "https://api.deepseek.com/v1"',
      '',
      '[memory.llm]',
      'provider = "openai"',
      '',
      '[embedding]',
      'provider = "api"',
      'dimensions = 1024',
      '',
      '[server]',
      'dashboard = true',
      '',
      '[git]',
      'auto_hook = true',
      'ingest_on_commit = false',
      'max_diff_size = 2048',
      'skip_merge_commits = false',
      'exclude_patterns = ["dist/**", "*.lock"]',
      '',
      '[codegraph]',
      'exclude_patterns = ["vendor/**", "**/generated/**"]',
    ].join('\n'), 'utf8');

    const cfg = loadTomlConfig({ projectRoot: null, homeDir: HOME });

    expect(cfg.agent?.provider).toBe('deepseek');
    expect(cfg.memory?.llm?.provider).toBe('openai');
    expect(cfg.embedding?.dimensions).toBe(1024);
    expect(cfg.server?.dashboard).toBe(true);
    expect(cfg.git?.auto_hook).toBe(true);
    expect(cfg.git?.ingest_on_commit).toBe(false);
    expect(cfg.git?.max_diff_size).toBe(2048);
    expect(cfg.git?.skip_merge_commits).toBe(false);
    expect(cfg.git?.exclude_patterns).toEqual(['dist/**', '*.lock']);
    expect(cfg.codegraph?.exclude_patterns).toEqual(['vendor/**', '**/generated/**']);
  });
});
