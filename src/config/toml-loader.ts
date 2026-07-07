import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { getGlobalConfigTomlPath, getProjectConfigTomlPath } from './config-paths.js';

export interface MemorixTomlConfig {
  agent?: {
    provider?: string;
    model?: string;
    base_url?: string;
    api_key?: string;
  };
  memory?: {
    inject?: 'full' | 'minimal' | 'silent';
    formation?: 'active' | 'shadow' | 'fallback';
    auto_cleanup?: boolean;
    llm?: {
      provider?: string;
      model?: string;
      base_url?: string;
      api_key?: string;
    };
  };
  embedding?: {
    provider?: 'off' | 'api' | 'fastembed' | 'transformers' | 'auto' | string;
    model?: string;
    base_url?: string;
    api_key?: string;
    dimensions?: number;
  };
  hooks?: {
    native_memcode?: boolean;
    external_agents?: boolean;
  };
  git?: {
    auto_hook?: boolean;
    ingest_on_commit?: boolean;
    max_diff_size?: number;
    skip_merge_commits?: boolean;
    exclude_patterns?: string[];
    noise_keywords?: string[];
  };
  codegraph?: {
    exclude_patterns?: string[];
  };
  server?: {
    transport?: 'stdio' | 'http';
    dashboard?: boolean;
    dashboard_port?: number;
    port?: number;
  };
}

interface LoadTomlOptions {
  projectRoot?: string | null;
  homeDir?: string;
}

const configCache = new Map<string, MemorixTomlConfig>();

export function loadTomlConfig(options: LoadTomlOptions = {}): MemorixTomlConfig {
  const homeDir = options.homeDir ?? homedir();
  const projectRoot = options.projectRoot ?? null;
  const cacheKey = `${homeDir}\0${projectRoot ?? ''}`;
  const cached = configCache.get(cacheKey);
  if (cached) return cached;

  const userToml = getGlobalConfigTomlPath(homeDir);
  const projectToml = projectRoot ? getProjectConfigTomlPath(projectRoot) : null;

  const userConfig = existsSync(userToml) ? parseTomlConfig(readFileSync(userToml, 'utf8'), userToml) : {};
  const projectConfig = projectToml && existsSync(projectToml)
    ? parseTomlConfig(readFileSync(projectToml, 'utf8'), projectToml)
    : {};

  const merged = mergeTomlConfig(userConfig, projectConfig);
  configCache.set(cacheKey, merged);
  return merged;
}

export function resetTomlConfigCache(): void {
  configCache.clear();
}

function mergeTomlConfig(base: MemorixTomlConfig, override: MemorixTomlConfig): MemorixTomlConfig {
  return {
    ...base,
    ...override,
    agent: { ...base.agent, ...override.agent },
    memory: {
      ...base.memory,
      ...override.memory,
      llm: { ...base.memory?.llm, ...override.memory?.llm },
    },
    embedding: { ...base.embedding, ...override.embedding },
    hooks: { ...base.hooks, ...override.hooks },
    git: { ...base.git, ...override.git },
    codegraph: { ...base.codegraph, ...override.codegraph },
    server: { ...base.server, ...override.server },
  };
}

function parseTomlConfig(content: string, filePath: string): MemorixTomlConfig {
  const root: Record<string, unknown> = {};
  let current: Record<string, unknown> = root;

  for (const [index, rawLine] of content.split(/\r?\n/).entries()) {
    const line = stripComment(rawLine).trim();
    if (!line) continue;

    const tableMatch = line.match(/^\[([A-Za-z0-9_.-]+)\]$/);
    if (tableMatch) {
      current = ensureTable(root, tableMatch[1].split('.'));
      continue;
    }

    const assignment = line.match(/^([A-Za-z0-9_-]+)\s*=\s*(.+)$/);
    if (!assignment) {
      throw new Error(`Invalid TOML syntax in ${filePath}:${index + 1}`);
    }
    current[assignment[1]] = parseTomlValue(assignment[2].trim(), filePath, index + 1);
  }

  return root as MemorixTomlConfig;
}

function ensureTable(root: Record<string, unknown>, path: string[]): Record<string, unknown> {
  let cursor = root;
  for (const part of path) {
    const value = cursor[part];
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      cursor[part] = {};
    }
    cursor = cursor[part] as Record<string, unknown>;
  }
  return cursor;
}

function parseTomlValue(raw: string, filePath: string, line: number): unknown {
  if (raw.startsWith('"') && raw.endsWith('"')) {
    return raw.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (/^-?\d+$/.test(raw)) return Number.parseInt(raw, 10);
  if (/^-?\d+\.\d+$/.test(raw)) return Number.parseFloat(raw);
  if (raw.startsWith('[') && raw.endsWith(']')) {
    const body = raw.slice(1, -1).trim();
    if (!body) return [];
    return body.split(',').map((entry) => parseTomlValue(entry.trim(), filePath, line));
  }
  throw new Error(`Unsupported TOML value in ${filePath}:${line}`);
}

function stripComment(line: string): string {
  let inString = false;
  let escaped = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\' && inString) {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (char === '#' && !inString) {
      return line.slice(0, i);
    }
  }
  return line;
}
