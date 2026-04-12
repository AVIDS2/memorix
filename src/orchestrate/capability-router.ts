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
 * Skips adapters currently in `busyNames` set (all parallel slots used).
 */
export function pickAdapter(
  role: string,
  available: AgentAdapter[],
  busyNames?: Set<string>,
  config?: RoutingConfig,
): AgentAdapter {
  if (available.length === 0) {
    throw new Error('capability-router: no adapters available');
  }

  const busy = busyNames ?? new Set<string>();
  const normalizedRole = role.toLowerCase();

  // Build preference list
  const prefs = config?.overrides?.[normalizedRole]
    ?? DEFAULT_ROLE_PREFERENCES[normalizedRole]
    ?? [];

  // Try preferences first (skip busy ones)
  for (const pref of prefs) {
    const adapter = available.find(a => a.name === pref && !busy.has(a.name));
    if (adapter) return adapter;
  }

  // Fallback: any non-busy adapter
  for (const adapter of available) {
    if (!busy.has(adapter.name)) return adapter;
  }

  // Last resort: any adapter (even busy — the coordinator manages parallel limits)
  return available[0];
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
