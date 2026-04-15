/**
 * Capability Router — Phase 6f: Role-based agent selection.
 *
 * Matches task roles to the most suitable agent adapter instead of
 * naive round-robin. Configurable via CLI override or defaults.
 * Pays D11 debt partially — configurable from day 1.
 */

import type { AgentAdapter } from './adapters/types.js';

// ── Types ──────────────────────────────────────────────────────────

export interface RoutingConfig {
  /** User-specified overrides: "pm=claude,engineer=codex" */
  overrides?: Record<string, string[]>;
  /** Per-adapter-type concurrent quota: { claude: 2, codex: 1, ... } */
  quotaMap?: Record<string, number>;
}

// ── Defaults ───────────────────────────────────────────────────────

const DEFAULT_ROLE_PREFERENCES: Record<string, string[]> = {
  planner:  ['claude', 'gemini', 'codex', 'opencode'],
  pm:       ['claude', 'gemini', 'codex', 'opencode'],
  engineer: ['codex', 'claude', 'opencode', 'gemini'],
  qa:       ['claude', 'codex', 'gemini', 'opencode'],
  reviewer: ['claude', 'gemini', 'codex', 'opencode'],
};

// ── Router ─────────────────────────────────────────────────────────

/**
 * Pick the best available adapter for a given role.
 *
 * Priority: user override > default preference > first available.
 * Respects per-type quota: an adapter whose active dispatch count >= quota
 * is treated as "full" and skipped.
 * Falls back to busyNames (legacy) if no quotaMap is provided.
 */
export function pickAdapter(
  role: string,
  available: AgentAdapter[],
  busyNames?: Set<string>,
  config?: RoutingConfig,
  /** Count of active dispatches per adapter name */
  dispatchCounts?: Record<string, number>,
  /** Agents to exclude (e.g. previously failed on this task) */
  excludeAgents?: Set<string>,
): AgentAdapter {
  if (available.length === 0) {
    throw new Error('capability-router: no adapters available');
  }

  const normalizedRole = role.toLowerCase();
  const quotaMap = config?.quotaMap;
  const excluded = excludeAgents ?? new Set<string>();

  // Helper: check if an adapter has available capacity and is not excluded
  const isAvailable = (name: string): boolean => {
    if (excluded.has(name)) return false;
    if (quotaMap && dispatchCounts) {
      const quota = quotaMap[name] ?? 1;
      const active = dispatchCounts[name] ?? 0;
      return active < quota;
    }
    // Legacy fallback: use busyNames set
    return !(busyNames ?? new Set<string>()).has(name);
  };

  // Build preference list
  const prefs = config?.overrides?.[normalizedRole]
    ?? DEFAULT_ROLE_PREFERENCES[normalizedRole]
    ?? [];

  // Try preferences first (skip full/excluded ones)
  for (const pref of prefs) {
    const adapter = available.find(a => a.name === pref && isAvailable(a.name));
    if (adapter) return adapter;
  }

  // Fallback: any adapter with capacity and not excluded
  for (const adapter of available) {
    if (isAvailable(adapter.name)) return adapter;
  }

  // Last resort: any non-excluded adapter
  const nonExcluded = available.find(a => !excluded.has(a.name));
  return nonExcluded ?? available[0];
}

/**
 * Parse routing config from CLI string: "pm=claude,engineer=codex"
 */
export function parseRoutingOverrides(raw: string): Record<string, string[]> {
  const overrides: Record<string, string[]> = {};
  if (!raw) return overrides;

  for (const pair of raw.split(',')) {
    const [role, agents] = pair.split('=').map(s => s.trim());
    if (role && agents) {
      overrides[role.toLowerCase()] = agents.split('+').map(s => s.trim().toLowerCase());
    }
  }
  return overrides;
}

/**
 * Extract role from task description.
 * Looks for [Role: <roleName>] pattern.
 */
export function extractRoleFromDescription(description: string): string {
  const match = description.match(/\[Role:\s*([^\]—\-]+)/i);
  if (match) {
    const raw = match[1].trim().toLowerCase();
    // Map common role names to our canonical roles
    if (raw.includes('pm') || raw.includes('ux')) return 'pm';
    if (raw.includes('planner')) return 'planner';
    if (raw.includes('engineer') || raw.includes('developer')) return 'engineer';
    if (raw.includes('qa') || raw.includes('test')) return 'qa';
    if (raw.includes('review')) return 'reviewer';
    return raw;
  }
  return 'engineer'; // default if no role tag found
}
