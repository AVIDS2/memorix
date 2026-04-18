/**
 * memorix.yml Configuration Loader
 *
 * Loads YAML configuration from project-level and user-level paths.
 * This is the platform-grade config format — Memorix as a central hub,
 * not just an MCP plugin.
 *
 * Priority chain (highest wins):
 *   1. Environment variables
 *   2. ./memorix.yml (project-level, in project root)
 *   3. ~/.memorix/memorix.yml (user-level, global defaults)
 *   4. ~/.memorix/config.json (legacy, backward compat)
 *   5. Hardcoded defaults
 *
 * Inspired by: Cipher's cipher.yml, Docker's docker-compose.yml
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

// ─── Types ───────────────────────────────────────────────────────────

export interface MemorixYamlConfig {
  /** LLM provider configuration */
  llm?: {
    provider?: 'openai' | 'anthropic' | 'openrouter' | string;
    model?: string;
    apiKey?: string;
    baseUrl?: string;
  };

  /** Embedding / vector search configuration */
  embedding?: {
    provider?: 'off' | 'api' | 'fastembed' | 'transformers' | 'auto';
    model?: string;
    apiKey?: string;
    baseUrl?: string;
    dimensions?: number;
  };

  /** Git-Memory pipeline configuration */
  git?: {
    /** Auto-install post-commit hook on first run (default: false) */
    autoHook?: boolean;
    /** Ingest commits as memories on post-commit (default: true when hook installed) */
    ingestOnCommit?: boolean;
    /** Maximum diff size (chars) to include in memory (default: 500) */
    maxDiffSize?: number;
    /** Skip merge commits (default: true) */
    skipMergeCommits?: boolean;
    /** File patterns to exclude from git memory (glob) */
    excludePatterns?: string[];
    /** Additional commit message patterns to treat as noise (regex strings) */
    noiseKeywords?: string[];
  };

  /** Behavior settings */
  behavior?: {
    /** Session start injection mode */
    sessionInject?: 'full' | 'minimal' | 'silent';
    /** Show sync advisory on first search */
    syncAdvisory?: boolean;
    /** Auto-archive expired memories on startup */
    autoCleanup?: boolean;
    /** Formation Pipeline mode */
    formationMode?: 'active' | 'shadow' | 'fallback';
  };

  /** MCP server mode configuration (when Memorix runs as hub) */
  server?: {
    /** Transport: stdio (default) or http */
    transport?: 'stdio' | 'http';
    /** HTTP port (only for http transport) */
    port?: number;
    /** Enable Web Dashboard */
    dashboard?: boolean;
    /** Dashboard port (default: 3210) */
    dashboardPort?: number;
  };

  /** Team collaboration settings */
  team?: {
    /** Enable team features */
    enabled?: boolean;
    /** Shared workspace memory collection */
    workspaceCollection?: string;
  };

  /** Additional MCP servers to aggregate (Memorix as hub) */
  mcpServers?: Record<string, {
    type?: 'stdio' | 'sse';
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    url?: string;
  }>;
}

// ─── Loader ──────────────────────────────────────────────────────────

// Per-project config cache — keyed by resolved projectRoot string.
// null key = user-level-only config (no project root).
const configCache = new Map<string | null, MemorixYamlConfig>();

/** Stored project root — set once by server init, used by all no-arg loadYamlConfig() calls */
let globalProjectRoot: string | null = null;

/**
 * Set the project root for YAML config resolution.
 * Call this once during server init so all config getters
 * (which call loadYamlConfig() without args) pick up project-level memorix.yml.
 *
 * In HTTP mode, this is called per-session/switchProject — the Map cache
 * preserves configs for all projects simultaneously.
 */
export function initProjectRoot(root: string): void {
  globalProjectRoot = root;
  // Invalidate this project's cache entry so file changes are picked up
  configCache.delete(root);
}

/**
 * Load memorix.yml from project root and/or user home.
 * Project-level overrides user-level (shallow merge per top-level key).
 */
export function loadYamlConfig(projectRoot?: string | null): MemorixYamlConfig {
  // When null is explicitly passed, skip global fallback (user-level config only).
  // When undefined (no arg), fall back to globally-initialized project root.
  const resolvedRoot = projectRoot === null ? null : (projectRoot ?? globalProjectRoot ?? null);

  // Per-project cache hit
  const cached = configCache.get(resolvedRoot ?? null);
  if (cached) return cached;

  const userYaml = join(homedir(), '.memorix', 'memorix.yml');
  const projectYaml = resolvedRoot ? join(resolvedRoot, 'memorix.yml') : null;

  let userConfig: MemorixYamlConfig = {};
  let projectConfig: MemorixYamlConfig = {};

  // Load user-level config
  if (existsSync(userYaml)) {
    try {
      userConfig = parseYaml(readFileSync(userYaml, 'utf-8'));
    } catch (err) {
      console.error(`[memorix] Warning: Failed to parse ${userYaml}: ${err}`);
    }
  }

  // Load project-level config (overrides user-level)
  if (projectYaml && existsSync(projectYaml)) {
    try {
      projectConfig = parseYaml(readFileSync(projectYaml, 'utf-8'));
    } catch (err) {
      console.error(`[memorix] Warning: Failed to parse ${projectYaml}: ${err}`);
    }
  }

  // Shallow merge: project-level top keys override user-level
  const merged: MemorixYamlConfig = {
    ...userConfig,
    ...projectConfig,
    // Deep merge for nested objects where both exist
    llm: { ...userConfig.llm, ...projectConfig.llm },
    embedding: { ...userConfig.embedding, ...projectConfig.embedding },
    git: { ...userConfig.git, ...projectConfig.git },
    behavior: { ...userConfig.behavior, ...projectConfig.behavior },
    server: { ...userConfig.server, ...projectConfig.server },
    team: { ...userConfig.team, ...projectConfig.team },
  };
  configCache.set(resolvedRoot ?? null, merged);

  return merged;
}

/**
 * Reset cached YAML config (for testing or project switching).
 * Invalidates all cached entries, or a specific projectRoot if provided.
 */
export function resetYamlConfigCache(projectRoot?: string | null): void {
  if (projectRoot !== undefined) {
    configCache.delete(projectRoot ?? null);
  } else {
    configCache.clear();
  }
}

/**
 * Parse YAML string using gray-matter's internal js-yaml.
 * gray-matter is already a dependency — no new deps needed.
 */
function parseYaml(content: string): MemorixYamlConfig {
  // gray-matter uses js-yaml internally; we import it from there
  // But for simplicity and reliability, use a basic YAML parser
  // that handles the flat config structure we need.
  try {
    // Dynamic import of js-yaml through gray-matter's dependency
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const yaml = require('js-yaml');
    return yaml.load(content) as MemorixYamlConfig ?? {};
  } catch {
    // Fallback: try gray-matter which wraps js-yaml
    try {
      const matter = require('gray-matter');
      const parsed = matter(`---\n${content}\n---`);
      return (parsed.data as MemorixYamlConfig) ?? {};
    } catch {
      console.error('[memorix] YAML parse failed — check memorix.yml syntax');
      return {};
    }
  }
}
