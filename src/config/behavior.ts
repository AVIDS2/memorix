/**
 * Behavior configuration resolved through the same TOML/YAML/legacy chain as
 * the rest of the runtime. Legacy config.json remains a fallback only.
 */

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { getLegacyConfigJsonPath } from './config-paths.js';
import { getResolvedConfig } from './resolved-config.js';
import { detectProject } from '../project/detector.js';

export interface BehaviorConfig {
  sessionInject: 'full' | 'minimal' | 'silent';
  syncAdvisory: boolean;
  autoCleanup: boolean;
  formationMode: 'shadow' | 'active' | 'fallback';
}

export interface BehaviorConfigOptions {
  projectRoot?: string | null;
  homeDir?: string;
}

const DEFAULTS: BehaviorConfig = {
  sessionInject: 'minimal',
  syncAdvisory: true,
  autoCleanup: true,
  formationMode: 'active',
};

const cache = new Map<string, BehaviorConfig>();

function isSessionInject(value: unknown): value is BehaviorConfig['sessionInject'] {
  return value === 'full' || value === 'minimal' || value === 'silent';
}

function isFormationMode(value: unknown): value is BehaviorConfig['formationMode'] {
  return value === 'shadow' || value === 'active' || value === 'fallback';
}

function legacyBehavior(homeDir: string): Record<string, unknown> {
  const configPath = getLegacyConfigJsonPath(homeDir);
  try {
    if (!existsSync(configPath)) return {};
    const parsed = JSON.parse(readFileSync(configPath, 'utf-8')) as { behavior?: unknown };
    return parsed.behavior && typeof parsed.behavior === 'object' && !Array.isArray(parsed.behavior)
      ? parsed.behavior as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

/**
 * Resolve behavior through project TOML/YAML first, then legacy config.json.
 * Passing projectRoot is important for HTTP sessions whose process cwd belongs
 * to a different project than the MCP session.
 */
export function getBehaviorConfig(options: BehaviorConfigOptions = {}): BehaviorConfig {
  const homeDir = options.homeDir ?? homedir();
  const projectRoot = options.projectRoot === undefined
    ? detectProject()?.rootPath ?? null
    : options.projectRoot;
  const cacheKey = `${homeDir}\0${projectRoot ?? ''}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const legacy = legacyBehavior(homeDir);
  let resolved: Partial<ReturnType<typeof getResolvedConfig>['memory']> = {};
  try {
    resolved = getResolvedConfig({ projectRoot, homeDir }).memory;
  } catch {
    // Behavior settings must not make hooks or MCP startup unavailable when a
    // user is in the middle of fixing a malformed TOML/YAML file.
  }
  const config: BehaviorConfig = {
    sessionInject: isSessionInject(resolved.inject)
      ? resolved.inject
      : isSessionInject(legacy.sessionInject) ? legacy.sessionInject : DEFAULTS.sessionInject,
    syncAdvisory: typeof resolved.syncAdvisory === 'boolean'
      ? resolved.syncAdvisory
      : typeof legacy.syncAdvisory === 'boolean' ? legacy.syncAdvisory : DEFAULTS.syncAdvisory,
    autoCleanup: typeof resolved.autoCleanup === 'boolean'
      ? resolved.autoCleanup
      : typeof legacy.autoCleanup === 'boolean' ? legacy.autoCleanup : DEFAULTS.autoCleanup,
    formationMode: isFormationMode(resolved.formation)
      ? resolved.formation
      : isFormationMode(legacy.formationMode) ? legacy.formationMode : DEFAULTS.formationMode,
  };
  cache.set(cacheKey, config);
  return config;
}

/** Reset cached resolved behavior. Used after config changes and in tests. */
export function resetBehaviorConfigCache(): void {
  cache.clear();
}
