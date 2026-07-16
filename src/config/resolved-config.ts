import { homedir } from 'node:os';
import { existsSync } from 'node:fs';
import { detectProject } from '../project/detector.js';
import {
  getGlobalConfigTomlPath,
  getGlobalYamlPath,
  getLegacyConfigJsonPath,
  getProjectConfigTomlPath,
  getProjectYamlPath,
} from './config-paths.js';
import { loadFileConfig } from './legacy-loader.js';
import { loadTomlConfig } from './toml-loader.js';
import { loadYamlConfig } from './yaml-loader.js';
import { loadDotenv } from './dotenv-loader.js';

export interface ResolvedLaneOptions {
  projectRoot?: string | null;
  homeDir?: string;
}

export interface ResolvedMemorixConfig {
  agent: {
    provider?: string;
    model?: string;
    baseUrl?: string;
    apiKey?: string;
  };
  memory: {
    inject?: 'full' | 'minimal' | 'silent';
    formation?: 'active' | 'shadow' | 'fallback';
    autoCleanup?: boolean;
    syncAdvisory?: boolean;
    llm: {
      provider?: string;
      model?: string;
      baseUrl?: string;
      apiKey?: string;
    };
  };
  embedding: {
    provider?: 'off' | 'fastembed' | 'transformers' | 'api' | 'auto' | string;
    model?: string;
    baseUrl?: string;
    apiKey?: string;
    dimensions?: number;
  };
  git: {
    autoHook?: boolean;
    ingestOnCommit?: boolean;
    maxDiffSize?: number;
    skipMergeCommits?: boolean;
    excludePatterns?: string[];
    noiseKeywords?: string[];
  };
  codegraph: {
    excludePatterns?: string[];
    maxFileBytes?: number;
  };
  server: {
    transport?: 'stdio' | 'http';
    dashboard?: boolean;
    dashboardPort?: number;
    port?: number;
  };
  sources: {
    toml: string[];
    legacy: string[];
    env: string[];
  };
}

export function getResolvedConfig(options: ResolvedLaneOptions = {}): ResolvedMemorixConfig {
  const homeDir = options.homeDir ?? homedir();
  const projectRoot = options.projectRoot === undefined ? detectProject()?.rootPath ?? null : options.projectRoot;

  // Make .env a first-class config source so every consumer of this resolved
  // config (embedding API key, LLM base URL, etc.) sees values from
  // ~/.memorix/.env / <project>/.env. loadDotenv() is idempotent — guarded by
  // a module-level `dotenvLoaded` flag — so repeat calls within one process
  // are essentially free, and it never overrides an already-set process env.
  loadDotenv(projectRoot === null ? undefined : projectRoot ?? undefined, { userHomeDir: homeDir });

  const toml = loadTomlConfig({ projectRoot: projectRoot ?? null, homeDir });
  const yaml = loadYamlConfig(projectRoot ?? null);
  const legacy = loadFileConfig();
  const embeddingBaseUrl = first(process.env.MEMORIX_EMBEDDING_BASE_URL, toml.embedding?.base_url, yaml.embedding?.baseUrl, legacy.embeddingApi?.baseUrl);
  const openRouterEmbeddingApiKey = isOpenRouterUrl(embeddingBaseUrl) ? process.env.OPENROUTER_API_KEY : undefined;

  const resolved: ResolvedMemorixConfig = {
    agent: {
      provider: first(
        process.env.MEMORIX_AGENT_PROVIDER,
        process.env.MEMORIX_AGENT_LLM_PROVIDER,
        toml.agent?.provider,
        yaml.agent?.provider,
        legacy.agent?.provider,
      ),
      model: first(
        process.env.MEMORIX_AGENT_MODEL,
        process.env.MEMORIX_AGENT_LLM_MODEL,
        toml.agent?.model,
        yaml.agent?.model,
        legacy.agent?.model,
      ),
      baseUrl: first(
        process.env.MEMORIX_AGENT_BASE_URL,
        process.env.MEMORIX_AGENT_LLM_BASE_URL,
        toml.agent?.base_url,
        yaml.agent?.baseUrl,
        legacy.agent?.baseUrl,
      ),
      apiKey: first(
        process.env.MEMORIX_AGENT_API_KEY,
        process.env.MEMORIX_AGENT_LLM_API_KEY,
        toml.agent?.api_key,
        yaml.agent?.apiKey,
        legacy.agent?.apiKey,
      ),
    },
    memory: {
      inject: first(toml.memory?.inject, yaml.behavior?.sessionInject),
      formation: first(toml.memory?.formation, yaml.behavior?.formationMode),
      autoCleanup: firstBool(toml.memory?.auto_cleanup, yaml.behavior?.autoCleanup),
      syncAdvisory: firstBool(toml.memory?.sync_advisory, yaml.behavior?.syncAdvisory),
      llm: {
        provider: first(process.env.MEMORIX_LLM_PROVIDER, toml.memory?.llm?.provider, yaml.llm?.provider, legacy.llm?.provider),
        model: first(process.env.MEMORIX_LLM_MODEL, toml.memory?.llm?.model, yaml.llm?.model, legacy.llm?.model),
        baseUrl: first(process.env.MEMORIX_LLM_BASE_URL, toml.memory?.llm?.base_url, yaml.llm?.baseUrl, legacy.llm?.baseUrl),
        apiKey: first(
          process.env.MEMORIX_LLM_API_KEY,
          process.env.MEMORIX_API_KEY,
          toml.memory?.llm?.api_key,
          yaml.llm?.apiKey,
          legacy.llm?.apiKey,
          process.env.OPENAI_API_KEY,
          process.env.ANTHROPIC_API_KEY,
          process.env.OPENROUTER_API_KEY,
        ),
      },
    },
    embedding: {
      provider: first(process.env.MEMORIX_EMBEDDING, toml.embedding?.provider, yaml.embedding?.provider, legacy.embedding, 'off'),
      model: first(process.env.MEMORIX_EMBEDDING_MODEL, toml.embedding?.model, yaml.embedding?.model, legacy.embeddingApi?.model),
      baseUrl: embeddingBaseUrl,
      apiKey: first(process.env.MEMORIX_EMBEDDING_API_KEY, toml.embedding?.api_key, yaml.embedding?.apiKey, legacy.embeddingApi?.apiKey, openRouterEmbeddingApiKey),
      dimensions: firstNumber(parseNumber(process.env.MEMORIX_EMBEDDING_DIMENSIONS), toml.embedding?.dimensions, yaml.embedding?.dimensions, legacy.embeddingApi?.dimensions),
    },
    git: {
      autoHook: firstBool(toml.git?.auto_hook, yaml.git?.autoHook),
      ingestOnCommit: firstBool(toml.git?.ingest_on_commit, yaml.git?.ingestOnCommit),
      maxDiffSize: firstNumber(toml.git?.max_diff_size, yaml.git?.maxDiffSize),
      skipMergeCommits: firstBool(toml.git?.skip_merge_commits, yaml.git?.skipMergeCommits),
      excludePatterns: firstArray(toml.git?.exclude_patterns, yaml.git?.excludePatterns),
      noiseKeywords: firstArray(toml.git?.noise_keywords, yaml.git?.noiseKeywords),
    },
    codegraph: {
      excludePatterns: firstArray(toml.codegraph?.exclude_patterns, yaml.codegraph?.excludePatterns),
      maxFileBytes: firstNumber(toml.codegraph?.max_file_bytes, yaml.codegraph?.maxFileBytes),
    },
    server: {
      transport: first(toml.server?.transport, yaml.server?.transport),
      dashboard: firstBool(toml.server?.dashboard, yaml.server?.dashboard),
      dashboardPort: firstNumber(toml.server?.dashboard_port, yaml.server?.dashboardPort),
      port: firstNumber(toml.server?.port, yaml.server?.port),
    },
    sources: {
      toml: getExistingConfigSources([
        getGlobalConfigTomlPath(homeDir),
        ...(projectRoot ? [getProjectConfigTomlPath(projectRoot)] : []),
      ]),
      legacy: getExistingConfigSources([
        getGlobalYamlPath(homeDir),
        ...(projectRoot ? [getProjectYamlPath(projectRoot)] : []),
        getLegacyConfigJsonPath(homeDir),
      ]),
      env: getEnvSourceNames(),
    },
  };

  return resolved;
}

export function getResolvedConfigForCwd(cwd = process.cwd()): ResolvedMemorixConfig {
  const project = detectProject(cwd);
  return getResolvedConfig({ projectRoot: project?.rootPath ?? null });
}

export function getResolvedAgentLane(options: ResolvedLaneOptions = {}): ResolvedMemorixConfig['agent'] {
  const resolved = getResolvedConfig(options);
  return {
    ...resolved.agent,
    provider: resolved.agent.provider ?? resolved.memory.llm.provider,
    model: resolved.agent.model ?? resolved.memory.llm.model,
    baseUrl: resolved.agent.baseUrl ?? resolved.memory.llm.baseUrl,
    apiKey: resolved.agent.apiKey ?? resolved.memory.llm.apiKey,
  };
}

export function getResolvedMemoryLane(options: ResolvedLaneOptions = {}): ResolvedMemorixConfig['memory'] {
  return getResolvedConfig(options).memory;
}

export function getResolvedEmbeddingLane(options: ResolvedLaneOptions = {}): ResolvedMemorixConfig['embedding'] {
  return getResolvedConfig(options).embedding;
}

export function resetResolvedConfigCache(): void {
  // Kept as a public test helper. File-level caches live in individual loaders.
}

function first<T>(...values: Array<T | null | undefined | ''>): T | undefined {
  return values.find((value): value is T => value !== undefined && value !== null && value !== '');
}

function firstBool(...values: Array<boolean | undefined>): boolean | undefined {
  return values.find((value): value is boolean => value !== undefined);
}

function firstNumber(...values: Array<number | undefined | null>): number | undefined {
  return values.find((value): value is number => value !== undefined && value !== null && Number.isFinite(value));
}

function firstArray<T>(...values: Array<T[] | undefined>): T[] | undefined {
  return values.find((value): value is T[] => Array.isArray(value));
}

function parseNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function getExistingConfigSources(paths: string[]): string[] {
  return paths.filter((filePath) => existsSync(filePath));
}

function getEnvSourceNames(): string[] {
  return [
    'MEMORIX_AGENT_PROVIDER',
    'MEMORIX_AGENT_MODEL',
    'MEMORIX_AGENT_API_KEY',
    'MEMORIX_AGENT_BASE_URL',
    'MEMORIX_AGENT_LLM_PROVIDER',
    'MEMORIX_AGENT_LLM_MODEL',
    'MEMORIX_AGENT_LLM_API_KEY',
    'MEMORIX_AGENT_LLM_BASE_URL',
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
    'OPENROUTER_API_KEY',
  ].filter((name) => process.env[name]);
}

function isOpenRouterUrl(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.hostname.toLowerCase() === 'openrouter.ai' || url.hostname.toLowerCase().endsWith('.openrouter.ai');
  } catch {
    return /(^|\.)openrouter\.ai(?::|\/|$)/i.test(value);
  }
}
