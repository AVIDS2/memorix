import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  getResolvedAgentLane,
  getResolvedConfig,
  getResolvedConfigForCwd,
  getResolvedEmbeddingLane,
  getResolvedMemoryLane,
  getResolvedRerankLane,
  resetResolvedConfigCache,
} from '../../src/config/resolved-config.js';
import { resetTomlConfigCache } from '../../src/config/toml-loader.js';
import { resetYamlConfigCache } from '../../src/config/yaml-loader.js';
import { getGitConfig, resetConfigCache } from '../../src/config.js';

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
  'MEMORIX_RERANK_PROVIDER',
  'MEMORIX_RERANK_MODEL',
  'MEMORIX_RERANK_BASE_URL',
  'MEMORIX_RERANK_API_KEY',
  'MEMORIX_CODEGRAPH_EXTERNAL_CONTEXT',
  'MEMORIX_CODEGRAPH_EXTERNAL_COMMAND',
  'MEMORIX_CODEGRAPH_EXTERNAL_TIMEOUT_MS',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'OPENROUTER_API_KEY',
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

  it('loads dotenv before resolving lanes and switches project dotenv cleanly', () => {
    const projectB = join(TMP, 'project-b');
    mkdirSync(projectB, { recursive: true });
    writeFileSync(join(PROJECT, '.env'), 'MEMORIX_EMBEDDING_API_KEY=project-a-key\n', 'utf8');
    writeFileSync(join(projectB, '.env'), 'MEMORIX_EMBEDDING_API_KEY=project-b-key\n', 'utf8');

    expect(getResolvedEmbeddingLane({ projectRoot: PROJECT, homeDir: HOME }).apiKey).toBe('project-a-key');
    expect(getResolvedEmbeddingLane({ projectRoot: projectB, homeDir: HOME }).apiKey).toBe('project-b-key');
  });

  it('keeps embedding lane isolated from memory and agent credentials', () => {
    process.env.MEMORIX_API_KEY = 'memory-key';
    process.env.MEMORIX_AGENT_API_KEY = 'agent-key';

    expect(getResolvedEmbeddingLane({ projectRoot: null, homeDir: HOME }).apiKey).toBeUndefined();
  });

  it('uses an OpenRouter key for its embedding lane without enabling the memory LLM lane', () => {
    process.env.OPENROUTER_API_KEY = 'embedding-only-key';
    writeFileSync(join(HOME, '.memorix', 'config.toml'), [
      '[embedding]',
      'provider = "api"',
      'base_url = "https://openrouter.ai/api/v1"',
    ].join('\n'), 'utf8');

    const cfg = getResolvedConfig({ projectRoot: null, homeDir: HOME });

    expect(cfg.embedding.apiKey).toBe('embedding-only-key');
    expect(cfg.memory.llm.apiKey).toBeUndefined();
  });

  it('allows an OpenRouter key for an explicitly configured memory LLM lane', () => {
    process.env.OPENROUTER_API_KEY = 'memory-openrouter-key';
    process.env.MEMORIX_LLM_PROVIDER = 'openrouter';

    expect(getResolvedMemoryLane({ projectRoot: null, homeDir: HOME }).llm.apiKey).toBe('memory-openrouter-key');
  });

  it('recognizes an explicit OpenRouter memory base URL without a provider label', () => {
    process.env.OPENROUTER_API_KEY = 'memory-openrouter-base-url-key';
    process.env.MEMORIX_LLM_BASE_URL = 'https://openrouter.ai/api/v1';

    expect(getResolvedMemoryLane({ projectRoot: null, homeDir: HOME }).llm.apiKey).toBe('memory-openrouter-base-url-key');
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

  it('resolves project override from detected git root, not arbitrary nested cwd', () => {
    const nested = join(PROJECT, 'packages', 'app');
    mkdirSync(join(PROJECT, '.git'), { recursive: true });
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(PROJECT, 'memorix.toml'), '[agent]\nmodel = "git-root-model"\n', 'utf8');

    const previousHome = process.env.USERPROFILE;
    process.env.USERPROFILE = HOME;
    const cfg = getResolvedConfigForCwd(nested);
    if (previousHome === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = previousHome;

    expect(cfg.agent.model).toBe('git-root-model');
    expect(cfg.sources.toml).toContain(join(PROJECT, 'memorix.toml'));
  });

  it('resolves git settings from TOML above legacy YAML', () => {
    writeFileSync(join(HOME, '.memorix', 'config.toml'), [
      '[git]',
      'auto_hook = true',
      'ingest_on_commit = false',
      'max_diff_size = 2048',
      'skip_merge_commits = false',
      'exclude_patterns = ["dist/**", "*.lock"]',
    ].join('\n'), 'utf8');
    writeFileSync(join(HOME, '.memorix', 'memorix.yml'), [
      'git:',
      '  autoHook: false',
      '  maxDiffSize: 999',
    ].join('\n'), 'utf8');

    const cfg = getResolvedConfig({ projectRoot: null, homeDir: HOME });

    expect(cfg.git.autoHook).toBe(true);
    expect(cfg.git.ingestOnCommit).toBe(false);
    expect(cfg.git.maxDiffSize).toBe(2048);
    expect(cfg.git.skipMergeCommits).toBe(false);
    expect(cfg.git.excludePatterns).toEqual(['dist/**', '*.lock']);
  });

  it('resolves HTTP rerank from env above TOML and inherits the LLM bearer', () => {
    writeFileSync(join(HOME, '.memorix', 'config.toml'), [
      '[memory.llm]',
      'base_url = "https://llm.example/v1"',
      'api_key = "llm-key"',
      '',
      '[rerank]',
      'provider = "http"',
      'model = "rerank-model"',
    ].join('\n'), 'utf8');
    process.env.MEMORIX_RERANK_PROVIDER = 'http';

    const lane = getResolvedRerankLane({ projectRoot: null, homeDir: HOME });

    expect(lane.provider).toBe('http');
    expect(lane.model).toBe('rerank-model');
    expect(lane.baseUrl).toBe('https://llm.example/v1');
    expect(lane.apiKey).toBe('llm-key');
    expect(lane.canSendRequest).toBe(true);
    expect(getResolvedConfig({ projectRoot: null, homeDir: HOME }).sources.env).toContain('MEMORIX_RERANK_PROVIDER');
  });

  it('keeps an explicit public host when the user configured it', () => {
    process.env.MEMORIX_RERANK_PROVIDER = 'http';
    process.env.MEMORIX_RERANK_BASE_URL = 'https://api.example.com/v1';
    process.env.MEMORIX_RERANK_MODEL = 'rerank-model';
    process.env.MEMORIX_RERANK_API_KEY = 'rerank-key';

    const lane = getResolvedRerankLane({ projectRoot: null, homeDir: HOME });
    expect(lane.provider).toBe('http');
    expect(lane.baseUrl).toBe('https://api.example.com/v1');
    expect(lane.model).toBe('rerank-model');
  });

  it('inherits the memory LLM key when the explicit rerank URL is the same endpoint', () => {
    writeFileSync(join(HOME, '.memorix', 'config.toml'), [
      '[memory.llm]',
      'base_url = "https://llm.example/v1"',
      'api_key = "llm-key"',
      '',
      '[rerank]',
      'provider = "http"',
      'model = "rerank-model"',
      'base_url = "https://LLM.example/v1/"',
    ].join('\n'), 'utf8');

    const lane = getResolvedRerankLane({ projectRoot: null, homeDir: HOME });

    expect(lane.provider).toBe('http');
    expect(lane.baseUrl).toBe('https://LLM.example/v1/');
    expect(lane.apiKey).toBe('llm-key');
    expect(lane.canSendRequest).toBe(true);
  });

  it('does not inherit the memory LLM key when the rerank URL is a different endpoint', () => {
    writeFileSync(join(HOME, '.memorix', 'config.toml'), [
      '[memory.llm]',
      'base_url = "https://llm.example/v1"',
      'api_key = "llm-key"',
      '',
      '[rerank]',
      'provider = "http"',
      'model = "rerank-model"',
      'base_url = "https://api.example.com/v1"',
    ].join('\n'), 'utf8');

    const lane = getResolvedRerankLane({ projectRoot: null, homeDir: HOME });

    expect(lane.provider).toBe('http');
    expect(lane.baseUrl).toBe('https://api.example.com/v1');
    expect(lane.apiKey).toBeUndefined();
    expect(lane.canSendRequest).toBe(false);
  });

  it('uses a dedicated rerank key when the endpoint differs from the memory LLM', () => {
    writeFileSync(join(HOME, '.memorix', 'config.toml'), [
      '[memory.llm]',
      'base_url = "https://llm.example/v1"',
      'api_key = "llm-key"',
      '',
      '[rerank]',
      'provider = "http"',
      'model = "rerank-model"',
      'base_url = "https://api.example.com/v1"',
      'api_key = "rerank-key"',
    ].join('\n'), 'utf8');

    const lane = getResolvedRerankLane({ projectRoot: null, homeDir: HOME });

    expect(lane.apiKey).toBe('rerank-key');
    expect(lane.canSendRequest).toBe(true);
  });

  it('resolves CodeGraph scan limits from TOML above legacy YAML', () => {
    writeFileSync(join(HOME, '.memorix', 'config.toml'), [
      '[codegraph]',
      'exclude_patterns = ["vendor/**", "**/generated/**"]',
      'max_file_bytes = 524288',
    ].join('\n'), 'utf8');
    writeFileSync(join(HOME, '.memorix', 'memorix.yml'), [
      'codegraph:',
      '  excludePatterns:',
      '    - ignored-from-yaml/**',
      '  maxFileBytes: 123',
    ].join('\n'), 'utf8');

    const cfg = getResolvedConfig({ projectRoot: null, homeDir: HOME });

    expect(cfg.codegraph.excludePatterns).toEqual(['vendor/**', '**/generated/**']);
    expect(cfg.codegraph.maxFileBytes).toBe(524288);
  });

  it('resolves bounded external CodeGraph context settings without credentials', () => {
    writeFileSync(join(HOME, '.memorix', 'config.toml'), [
      '[codegraph]',
      'external_context = "off"',
      'external_command = "C:\\\\tools\\\\codegraph.cmd"',
      'external_timeout_ms = 900',
    ].join('\n'), 'utf8');
    process.env.MEMORIX_CODEGRAPH_EXTERNAL_CONTEXT = 'auto';
    process.env.MEMORIX_CODEGRAPH_EXTERNAL_TIMEOUT_MS = '700';

    const cfg = getResolvedConfig({ projectRoot: null, homeDir: HOME });

    expect(cfg.codegraph.externalContext).toBe('auto');
    expect(cfg.codegraph.externalCommand).toBe('C:\\tools\\codegraph.cmd');
    expect(cfg.codegraph.externalTimeoutMs).toBe(700);
    expect(cfg.sources.env).toEqual(expect.arrayContaining([
      'MEMORIX_CODEGRAPH_EXTERNAL_CONTEXT',
      'MEMORIX_CODEGRAPH_EXTERNAL_TIMEOUT_MS',
    ]));
  });

  it('uses git TOML settings in runtime getGitConfig after project root detection', () => {
    writeFileSync(join(PROJECT, 'memorix.toml'), [
      '[git]',
      'auto_hook = true',
      'max_diff_size = 4096',
      'skip_merge_commits = false',
    ].join('\n'), 'utf8');

    const cfg = getGitConfig({ projectRoot: PROJECT, homeDir: HOME });

    expect(cfg.autoHook).toBe(true);
    expect(cfg.maxDiffSize).toBe(4096);
    expect(cfg.skipMergeCommits).toBe(false);
  });
});
