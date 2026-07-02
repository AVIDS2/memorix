/**
 * Tool Profile System — Progressive Disclosure for MCP tools
 *
 * The full Memorix tool set contains 40+ tools, but most users only ever
 * use a small subset (store / search / detail). Exposing all of them at
 * tools/list time causes cognitive overload.
 *
 * We provide four profiles:
 *   - "micro" (stdio default): Agent-ready project context + basic memory CRUD — 7 tools.
 *     Suitable for normal MCP clients where every tool schema costs context tokens.
 *   - "lite": Core memory CRUD, sessions, reasoning, retention, backup — 17 tools.
 *     Suitable for solo users who want the full memory surface without team tools.
 *   - "team" (HTTP default): lite + orchestration coordination tools + dashboard — 24 tools.
 *     Suitable when an operator explicitly wants task/message/lock surfaces.
 *   - "full": Everything, including niche / advanced tools (consolidate, dedup,
 *     formation metrics, skills, rules/workspace sync, KG-official, image ingest).
 *     Opt in via `MEMORIX_MODE=full` or `--mode full`.
 *
 * Users can override at any time via the `MEMORIX_MODE` env var, the `--mode`
 * CLI flag, or programmatically via `createMemorixServer({ toolProfile: ... })`.
 */

export type ToolProfile = 'micro' | 'lite' | 'team' | 'full';

/**
 * Canonical tool name → which profile(s) include it.
 * Every `registerTool` call in server.ts MUST consult this map.
 */
export const TOOL_PROFILES: Record<string, ReadonlyArray<ToolProfile>> = Object.freeze({
  // ── micro: default agent-facing surface — keep tools/list tiny ────
  memorix_store:              ['micro', 'lite', 'team', 'full'],
  memorix_search:             ['micro', 'lite', 'team', 'full'],
  memorix_detail:             ['micro', 'lite', 'team', 'full'],
  memorix_project_context:    ['micro', 'lite', 'team', 'full'],
  memorix_context_pack:       ['micro', 'lite', 'team', 'full'],
  memorix_codegraph_status:   ['micro', 'lite', 'team', 'full'],
  memorix_resolve:            ['micro', 'lite', 'team', 'full'],

  // ── lite: extended solo memory surface ────────────────────────────
  memorix_graph_context:      ['lite', 'team', 'full'],
  memorix_timeline:           ['lite', 'team', 'full'],
  memorix_suggest_topic_key:  ['lite', 'team', 'full'],
  memorix_session_start:      ['lite', 'team', 'full'],
  memorix_session_end:        ['lite', 'team', 'full'],
  memorix_session_context:    ['lite', 'team', 'full'],
  memorix_store_reasoning:    ['lite', 'team', 'full'],
  memorix_search_reasoning:   ['lite', 'team', 'full'],
  memorix_transfer:           ['lite', 'team', 'full'],
  memorix_retention:          ['lite', 'team', 'full'],

  // ── team: orchestration coordination surfaces — HTTP default ──────
  memorix_dashboard:          ['team', 'full'],
  memorix_handoff:            ['team', 'full'],
  memorix_poll:               ['team', 'full'],
  team_manage:                ['team', 'full'],
  team_message:               ['team', 'full'],
  team_task:                  ['team', 'full'],
  team_file_lock:             ['team', 'full'],

  // ── full: advanced / specialized — opt-in only ───────────────────
  memorix_audit_project:      ['full'],
  memorix_deduplicate:        ['full'],
  memorix_consolidate:        ['full'],
  memorix_formation_metrics:  ['full'],
  memorix_skills:             ['full'],
  memorix_promote:            ['full'],
  memorix_rules_sync:         ['full'],
  memorix_workspace_sync:     ['full'],
  memorix_ingest_image:       ['full'],

  // ── MCP Official Memory Server compatibility (KG tools) ──────────
  // These are only useful to users specifically migrating from the
  // reference mcp-memory server. Hide them unless explicitly enabled.
  create_entities:            ['full'],
  create_relations:           ['full'],
  add_observations:           ['full'],
  delete_entities:            ['full'],
  delete_observations:        ['full'],
  delete_relations:           ['full'],
  read_graph:                 ['full'],
  search_nodes:               ['full'],
  open_nodes:                 ['full'],
});

/**
 * Check whether a tool should be registered under the given profile.
 *
 * Unknown tool names default to `full` (so accidentally-unlisted tools
 * remain available via full mode but are hidden by default).
 */
export function isToolInProfile(toolName: string, profile: ToolProfile): boolean {
  const profiles = TOOL_PROFILES[toolName];
  if (!profiles) {
    // Unknown tool: conservative default — only show under 'full'
    return profile === 'full';
  }
  return profiles.includes(profile);
}

export interface ResolveToolProfileOpts {
  /** Explicit profile from caller (highest priority). */
  explicit?: ToolProfile | string | null;
  /** Raw env var value, e.g. from process.env.MEMORIX_MODE. */
  envValue?: string | null;
  /** Default when nothing is set — typically 'lite' for stdio, 'team' for HTTP. */
  fallback: ToolProfile;
}

/**
 * Resolve the effective tool profile.
 *
 * Priority: explicit option > MEMORIX_MODE env > fallback.
 * Invalid values fall through to the next level so users never silently
 * lose tools due to a typo.
 */
export function resolveToolProfile(opts: ResolveToolProfileOpts): ToolProfile {
  const normalize = (v: string | null | undefined): ToolProfile | null => {
    if (!v) return null;
    const s = String(v).trim().toLowerCase();
    if (s === 'micro' || s === 'lite' || s === 'team' || s === 'full') return s;
    return null;
  };

  return (
    normalize(opts.explicit as string | null | undefined) ??
    normalize(opts.envValue) ??
    opts.fallback
  );
}

/**
 * Human-readable description for logs / diagnostics.
 */
export function describeProfile(profile: ToolProfile): string {
  switch (profile) {
    case 'micro': return 'micro (agent-ready context + basic memory, ~7 tools)';
    case 'lite': return 'lite (core memory + sessions, ~17 tools)';
    case 'team': return 'team (lite + coordination tools + dashboard, ~24 tools)';
    case 'full': return 'full (all tools including advanced / KG-compat)';
  }
}

/**
 * Count tools registered under each profile — useful for docs and tests.
 */
export function countToolsInProfile(profile: ToolProfile): number {
  let n = 0;
  for (const name of Object.keys(TOOL_PROFILES)) {
    if (isToolInProfile(name, profile)) n++;
  }
  return n;
}
