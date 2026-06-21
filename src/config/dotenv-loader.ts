/**
 * .env Loader for Memorix
 *
 * Loads compatibility environment overrides from project/user .env files.
 * The primary product configuration is TOML:
 *   - ~/.memorix/config.toml
 *   - <git-root>/memorix.toml
 *
 * Design principle:
 *   TOML = normal user setup and structured behavior
 *   .env = compatibility, CI, launchers, and temporary overrides
 *
 * Priority (highest wins):
 *   1. System environment variables (from MCP host `env` field or shell)
 *   2. Project .env file (./  .env in project root)
 *   3. User .env file (~/.memorix/.env) — advanced, not promoted
 *
 * Do not promote .env as the default product surface. Keep it as an override
 * layer for users who need launcher-specific behavior.
 */

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { parse } from 'dotenv';
import { getGlobalDotenvPath, getProjectDotenvPath } from './config-paths.js';

// ─── State ───

let dotenvLoaded = false;
let dotenvProjectRoot: string | null = null;

/** Track which .env files were loaded (for diagnostics) */
const loadedEnvFiles: string[] = [];
/** Track keys injected by .env so project switches can cleanly restore process.env */
const injectedKeys = new Set<string>();

function loadEnvFile(filePath: string): void {
  if (!existsSync(filePath)) return;

  const parsed = parse(readFileSync(filePath, 'utf-8'));
  for (const [key, value] of Object.entries(parsed)) {
    if (!(key in process.env)) {
      process.env[key] = value;
      injectedKeys.add(key);
    }
  }

  loadedEnvFiles.push(filePath);
}

interface DotenvLoadOptions {
  userHomeDir?: string;
}

// ─── Public API ───

/**
 * Load .env files into process.env.
 * Called once during startup. Does NOT override existing env vars.
 *
 * @param projectRoot - Project root directory (for project-level .env)
 */
export function loadDotenv(projectRoot?: string, options: DotenvLoadOptions = {}): void {
  if (dotenvLoaded && dotenvProjectRoot === (projectRoot ?? null)) return;

  loadedEnvFiles.length = 0;

  // Loading order = priority order (with override: false, first value wins).
  // System env vars already exist in process.env, so they always win.

  // 1. Project-level .env — highest .env priority, load first
  if (projectRoot) {
    loadEnvFile(getProjectDotenvPath(projectRoot));
  }

  // 2. User-level .env (~/.memorix/.env) — lowest .env priority, load second
  //    (override: false means it only fills in keys not already set)
  loadEnvFile(getGlobalDotenvPath(options.userHomeDir ?? homedir()));

  dotenvLoaded = true;
  dotenvProjectRoot = projectRoot ?? null;
}

/**
 * Reset dotenv state (for testing or project switch).
 */
export function resetDotenv(): void {
  for (const key of injectedKeys) {
    delete process.env[key];
  }
  injectedKeys.clear();
  dotenvLoaded = false;
  dotenvProjectRoot = null;
  loadedEnvFiles.length = 0;
}

/**
 * Get list of .env files that were loaded (for diagnostics).
 */
export function getLoadedEnvFiles(): readonly string[] {
  return loadedEnvFiles;
}

// ─── Supported .env variables ───
// These are the ONLY variables Memorix reads from .env.
// All are secrets or endpoint URLs — no behavior config.
//
// MEMORIX_LLM_API_KEY       — Background memory LLM API key
// MEMORIX_LLM_BASE_URL      — Background memory LLM endpoint
// MEMORIX_AGENT_API_KEY     — TUI/chat coding agent API key
// MEMORIX_AGENT_BASE_URL    — TUI/chat coding agent endpoint
// MEMORIX_AGENT_LLM_API_KEY — Legacy alias for MEMORIX_AGENT_API_KEY
// MEMORIX_AGENT_LLM_BASE_URL — Legacy alias for MEMORIX_AGENT_BASE_URL
// MEMORIX_EMBEDDING_API_KEY — Embedding/vector API key
// MEMORIX_EMBEDDING_BASE_URL — Custom embedding endpoint
// MEMORIX_API_KEY           — Memory LLM simple key (not used for embedding or agent)
// OPENAI_API_KEY            — OpenAI compatibility fallback
// ANTHROPIC_API_KEY         — Anthropic compatibility fallback
// OPENROUTER_API_KEY        — OpenRouter compatibility fallback
