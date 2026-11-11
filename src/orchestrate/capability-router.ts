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
  /** Scheduling policy: 'best-fit' (default) or 'balanced' (round-robin tiebreaker) */
  scheduling?: 'best-fit' | 'balanced';
}

/** Reason why a specific adapter was selected */
export type RoutingReason =
  | 'default_preference'   // selected via DEFAULT_ROLE_PREFERENCES
  | 'cli_override'         // selected via --routing override
  | 'quota_fallback'      // preferred adapter at quota capacity, fell back to next
  | 'excluded_failed'     // preferred adapter excluded due to prior failure
  | 'last_resort';        // no adapter with capacity found, picked any non-excluded

/** Explainability record for a routing decision */
export interface RoutingDecision {
  role: string;
  available: string[];
  selected: string;
  reason: RoutingReason;
  /** Which preference list was consulted (if any) */
  preferenceList?: string[];
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
  if (config?.scheduling === 'balanced' && prefs.length > 0) {
    // Balanced: collect all available adapters at the same preference rank level,
    // then round-robin among them for fairness
    const availableAtRank: AgentAdapter[] = [];
    for (const pref of prefs) {
      const adapter = available.find(a => a.name === pref && isAvailable(a.name));
      if (adapter) availableAtRank.push(adapter);
    }
    if (availableAtRank.length > 0) {
      if (availableAtRank.length === 1) return availableAtRank[0];
      // Round-robin tiebreaker
      const key = normalizedRole;
      const idx = (rrCounters.get(key) ?? 0) % availableAtRank.length;
      rrCounters.set(key, idx + 1);
      return availableAtRank[idx];
    }
  } else {
    // Best-fit (default): first available preference wins
    for (const pref of prefs) {
      const adapter = available.find(a => a.name === pref && isAvailable(a.name));
      if (adapter) return adapter;
    }
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

/**
 * Extract role from a task object.
 * Prefers structured metadata.role (canonical source) over [Role: ...] text parsing.
 * Falls back to description text if metadata.role is absent.
 * Accepts both parsed metadata (Record) and raw JSON string (from TeamTaskRow).
 */
export function extractRole(task: { description: string; metadata?: Record<string, unknown> | string | null }): string {
  const rawMeta = task.metadata;
  if (rawMeta) {
    let parsed: Record<string, unknown> | undefined;
    if (typeof rawMeta === 'string') {
      try { parsed = JSON.parse(rawMeta); } catch { /* not valid JSON */ }
    } else {
      parsed = rawMeta;
    }
    const metaRole = parsed?.role;
    if (typeof metaRole === 'string' && metaRole.trim()) {
      return metaRole.trim().toLowerCase();
    }
  }
  return extractRoleFromDescription(task.description);
}

// ── Round-robin tiebreaker state (for balanced scheduling) ────────

const rrCounters = new Map<string, number>();

/**
 * Build an explainability record for a routing decision.
 * Called by coordinator after pickAdapter() returns — does NOT change routing logic.
 */
export function buildRoutingDecision(
  role: string,
  available: AgentAdapter[],
  selected: AgentAdapter,
  config?: RoutingConfig,
  dispatchCounts?: Record<string, number>,
  excludeAgents?: Set<string>,
): RoutingDecision {
  const normalizedRole = role.toLowerCase();
  const quotaMap = config?.quotaMap;
  const excluded = excludeAgents ?? new Set<string>();

  const isAvailable = (name: string): boolean => {
    if (excluded.has(name)) return false;
    if (quotaMap && dispatchCounts) {
      const quota = quotaMap[name] ?? 1;
      const active = dispatchCounts[name] ?? 0;
      return active < quota;
    }
    return true;
  };

  const prefs = config?.overrides?.[normalizedRole]
    ?? DEFAULT_ROLE_PREFERENCES[normalizedRole]
    ?? [];

  // Determine reason
  let reason: RoutingReason = 'last_resort';

  // Check if selected via CLI override
  const overridePrefs = config?.overrides?.[normalizedRole];
  if (overridePrefs && overridePrefs.includes(selected.name)) {
    reason = 'cli_override';
  }
  // Check if selected via default preference
  else if (DEFAULT_ROLE_PREFERENCES[normalizedRole]?.includes(selected.name)) {
    // Was a higher-ranked preferred adapter skipped?
    const defaultPrefs = DEFAULT_ROLE_PREFERENCES[normalizedRole] ?? [];
    const selectedRank = defaultPrefs.indexOf(selected.name);
    const skippedHigher = defaultPrefs.slice(0, selectedRank).some(name =>
      available.some(a => a.name === name) && !isAvailable(name),
    );
    if (skippedHigher) {
      // Why was it skipped? Check excluded vs quota
      const skippedByExclusion = defaultPrefs.slice(0, selectedRank).some(name => excluded.has(name));
      reason = skippedByExclusion ? 'excluded_failed' : 'quota_fallback';
    } else {
      reason = 'default_preference';
    }
  }

  return {
    role: normalizedRole,
    available: available.map(a => a.name),
    selected: selected.name,
    reason,
    preferenceList: prefs.length > 0 ? prefs : undefined,
  };
}

/**
 * Compute idle-agent reasons for adapters that were in the pool but never dispatched.
 */
export function buildIdleReasons(
  available: AgentAdapter[],
  dispatchedNames: Set<string>,
  config?: RoutingConfig,
  excludeAgents?: Set<string>,
): Array<{ name: string; reason: string }> {
  const result: Array<{ name: string; reason: string }> = [];
  const excluded = excludeAgents ?? new Set<string>();

  for (const adapter of available) {
    if (dispatchedNames.has(adapter.name)) continue;
    const isExcluded = excluded.has(adapter.name);
    if (isExcluded) {
      result.push({ name: adapter.name, reason: 'excluded due to prior failure' });
    } else {
      // Check if this adapter appears in any preference list
      const inAnyPref = Object.values(DEFAULT_ROLE_PREFERENCES).some(prefs => prefs.includes(adapter.name));
      if (inAnyPref) {
        result.push({ name: adapter.name, reason: 'preference rank lower than selected adapter' });
      } else {
        result.push({ name: adapter.name, reason: 'no matching role preference' });
      }
    }
  }
  return result;
}
