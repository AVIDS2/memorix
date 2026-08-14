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
import { homedir } from 'node:os';
import { parse as parseYamlDocument } from 'yaml';
import { getGlobalYamlPath, getProjectYamlPath } from './config-paths.js';

// ─── Types ───────────────────────────────────────────────────────────

export interface MemorixYamlConfig {
  /** LLM provider configuration */
  llm?: {
    provider?: 'openai' | 'anthropic' | 'openrouter' | string;
    model?: string;
    apiKey?: string;
    baseUrl?: string;
  };

  /** TUI / chat agent LLM provider configuration */
  agent?: {
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
    /** Additional commit message phrases to treat as noise (literal, case-insensitive) */
    noiseKeywords?: string[];
  };

  /** CodeGraph / Project Context configuration */
  codegraph?: {
    /** File patterns to exclude from CodeGraph indexing and context suggestions */
    excludePatterns?: string[];
    /** Maximum source file size to parse into CodeGraph Memory */
    maxFileBytes?: number;
    /** Use a healthy pre-existing local CodeGraph index when present (default: auto). */
    externalContext?: 'auto' | 'off';
    /** Optional CodeGraph executable path when it is not available on PATH. */
    externalCommand?: string;
    /** Bound for one local semantic context request. */
    externalTimeoutMs?: number;
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

  /** Orchestration coordination settings */
  team?: {
    /** Enable orchestration coordination features */
    enabled?: boolean;
    /** Shared workspace memory collection */
    workspaceCollection?: string;
  };

  // NOTE: a previous `mcpServers` declaration ("Memorix as an MCP hub") was
  // removed — no code ever consumed it. Unknown top-level keys are ignored,
  // so existing files with the old key keep loading without error.
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
 * Clear the global project root used by no-arg loadYamlConfig().
 * Useful when a long-lived process switches to a project whose root is unknown.
 */
export function clearProjectRoot(): void {
  globalProjectRoot = null;
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

  const userYaml = getGlobalYamlPath(homedir());
  const projectYaml = resolvedRoot ? getProjectYamlPath(resolvedRoot) : null;

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
    agent: { ...userConfig.agent, ...projectConfig.agent },
    embedding: { ...userConfig.embedding, ...projectConfig.embedding },
    git: { ...userConfig.git, ...projectConfig.git },
    codegraph: { ...userConfig.codegraph, ...projectConfig.codegraph },
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

function parseYaml(content: string): MemorixYamlConfig {
  try {
    const parsed = parseYamlDocument(content);
    return (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
      ? parsed as MemorixYamlConfig
      : {};
  } catch {
    console.error('[memorix] YAML parse failed — check memorix.yml syntax');
    return {};
  }
}
