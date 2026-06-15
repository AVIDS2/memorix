import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  getResolvedAgentLane,
  getResolvedConfig,
  getResolvedEmbeddingLane,
  getResolvedMemoryLane,
  resetResolvedConfigCache,
} from '../../src/config/resolved-config.js';
import { resetTomlConfigCache } from '../../src/config/toml-loader.js';
import { resetYamlConfigCache } from '../../src/config/yaml-loader.js';
import { resetConfigCache } from '../../src/config.js';

const TMP = join(process.cwd(), '.tmp-resolved-config-test');
const HOME = join(TMP, 'home');
const PROJECT = join(TMP, 'project');

const ENV_KEYS = [
  'MEMORIX_AGENT_PROVIDER',
  'MEMORIX_AGENT_MODEL',
  'MEMORIX_AGENT_API_KEY',
  'MEMORIX_AGENT_BASE_URL',
  'MEMORIX_LLM_PROVIDER',
  'MEMORIX_LLM_MODEL',
  'MEMORIX_LLM_API_KEY',
  'MEMORIX_LLM_BASE_URL',
  'MEMORIX_API_KEY',
  'MEMORIX_EMBEDDING',
  'MEMORIX_EMBEDDING_API_KEY',
  'MEMORIX_EMBEDDING_BASE_URL',
  'MEMORIX_EMBEDDING_MODEL',
  'MEMORIX_EMBEDDING_DIMENSIONS',
  'OPENAI_API_KEY',
];

describe('resolved config', () => {
  beforeEach(() => {
    vi.resetModules();
    rmSync(TMP, { recursive: true, force: true });
    mkdirSync(join(HOME, '.memorix'), { recursive: true });
    mkdirSync(PROJECT, { recursive: true });
    resetTomlConfigCache();
    resetYamlConfigCache();
    resetResolvedConfigCache();
    resetConfigCache();
    for (const key of ENV_KEYS) delete process.env[key];
  });

  it('resolves TOML lanes above legacy YAML', () => {
    writeFileSync(join(HOME, '.memorix', 'config.toml'), [
      '[agent]',
      'provider = "agent-from-toml"',
      'model = "agent-model"',
      '',
      '[memory.llm]',
      'provider = "memory-from-toml"',
      'model = "memory-model"',
      '',
      '[embedding]',
      'provider = "api"',
      'model = "embed-model"',
    ].join('\n'), 'utf8');
    writeFileSync(join(HOME, '.memorix', 'memorix.yml'), 'agent:\n  provider: agent-from-yaml\n', 'utf8');

    const cfg = getResolvedConfig({ projectRoot: null, homeDir: HOME });

    expect(cfg.agent.provider).toBe('agent-from-toml');
    expect(cfg.memory.llm.provider).toBe('memory-from-toml');
    expect(cfg.embedding.provider).toBe('api');
  });

  it('lets project TOML override global TOML after project root is known', () => {
    writeFileSync(join(HOME, '.memorix', 'config.toml'), '[agent]\nmodel = "global-model"\n', 'utf8');
    writeFileSync(join(PROJECT, 'memorix.toml'), '[agent]\nmodel = "project-model"\n', 'utf8');

    expect(getResolvedAgentLane({ projectRoot: PROJECT, homeDir: HOME }).model).toBe('project-model');
  });

  it('keeps environment variables above TOML', () => {
    writeFileSync(join(HOME, '.memorix', 'config.toml'), '[agent]\nmodel = "toml-model"\n', 'utf8');
    process.env.MEMORIX_AGENT_MODEL = 'env-model';

    expect(getResolvedAgentLane({ projectRoot: null, homeDir: HOME }).model).toBe('env-model');
  });

  it('keeps embedding lane isolated from memory and agent credentials', () => {
    process.env.MEMORIX_API_KEY = 'memory-key';
    process.env.MEMORIX_AGENT_API_KEY = 'agent-key';

    expect(getResolvedEmbeddingLane({ projectRoot: null, homeDir: HOME }).apiKey).toBeUndefined();
  });

  it('returns memory LLM simple key from MEMORIX_API_KEY', () => {
    process.env.MEMORIX_API_KEY = 'memory-key';

    expect(getResolvedMemoryLane({ projectRoot: null, homeDir: HOME }).llm.apiKey).toBe('memory-key');
  });

  it('reports active TOML, legacy, and env config sources', () => {
    writeFileSync(join(HOME, '.memorix', 'config.toml'), '[agent]\nmodel = "global-model"\n', 'utf8');
    writeFileSync(join(PROJECT, 'memorix.toml'), '[agent]\nmodel = "project-model"\n', 'utf8');
    writeFileSync(join(HOME, '.memorix', 'memorix.yml'), 'llm:\n  model: yaml-model\n', 'utf8');
    process.env.MEMORIX_AGENT_MODEL = 'env-model';

    const cfg = getResolvedConfig({ projectRoot: PROJECT, homeDir: HOME });

    expect(cfg.sources.toml).toEqual([
      join(HOME, '.memorix', 'config.toml'),
      join(PROJECT, 'memorix.toml'),
    ]);
    expect(cfg.sources.legacy).toContain(join(HOME, '.memorix', 'memorix.yml'));
    expect(cfg.sources.env).toContain('MEMORIX_AGENT_MODEL');
  });
});
