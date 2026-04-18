/**
 * Permission — Phase 7, Step 10: Risk classification + monitoring for agent tools.
 *
 * Classifies tool calls by risk tier and records them for post-run audit.
 * Does NOT block or restrict agent tools (Non-Invasiveness principle).
 * The primary use case is monitoring and reporting:
 *   - Which high-risk tools were used and how often
 *   - Whether agents used filesystem-destructive or network operations
 *   - Per-task risk summary in the evidence directory
 *
 * Three tiers:
 *   - safe:      read-only operations (Read, Grep, List, etc.)
 *   - moderate:  write operations (Edit, Write, Execute safe commands)
 *   - dangerous: destructive/network/exec operations (Delete, Bash, Deploy, etc.)
 */

// ── Types ──────────────────────────────────────────────────────────

export type RiskTier = 'safe' | 'moderate' | 'dangerous';

export interface ToolUsageRecord {
  tool: string;
  tier: RiskTier;
  count: number;
  firstSeen: number;
  lastSeen: number;
}

export interface TaskRiskProfile {
  taskId: string;
  /** Highest risk tier used by this task */
  maxTier: RiskTier;
  /** Total tool calls */
  totalCalls: number;
  /** Tool usage breakdown */
  tools: ToolUsageRecord[];
}

// ── Classification Registry ────────────────────────────────────────

const SAFE_TOOLS = new Set([
  'read_file', 'grep_search', 'find_by_name', 'list_dir', 'code_search',
  'read_notebook', 'read_url_content', 'view_content_chunk',
  'memorix_search', 'memorix_detail', 'memorix_search_reasoning',
  'mcp_query', 'search_web',
]);

const MODERATE_TOOLS = new Set([
  'edit', 'multi_edit', 'write_to_file', 'edit_notebook',
  'memorix_store', 'memorix_store_reasoning', 'memorix_resolve',
  'memorix_session_start', 'memorix_handoff', 'memorix_poll',
  'git_commit', 'git_add', 'git_checkout',
]);

const DANGEROUS_TOOLS = new Set([
  'run_command', 'bash', 'execute_command', 'terminal',
  'delete_file', 'remove_directory',
  'deploy_web_app', 'browser_navigate', 'browser_click',
  'http_request', 'fetch_url',
]);

// ── Core ───────────────────────────────────────────────────────────

/**
 * Classify a tool name into a risk tier.
 * Unknown tools default to 'moderate' (conservative but not alarming).
 */
export function classifyTool(toolName: string): RiskTier {
  const name = toolName.toLowerCase().replace(/[^a-z0-9_]/g, '_');
  if (SAFE_TOOLS.has(name)) return 'safe';
  if (DANGEROUS_TOOLS.has(name)) return 'dangerous';
  if (MODERATE_TOOLS.has(name)) return 'moderate';
  // Heuristic fallback: tools with 'write', 'delete', 'exec', 'run' in name
  if (/delete|remove|exec|run|deploy|bash|terminal/.test(name)) return 'dangerous';
  if (/write|edit|create|update|store|commit/.test(name)) return 'moderate';
  return 'moderate'; // Unknown → moderate (safe default)
}

/**
 * Task-level tool usage tracker. Create one per dispatched task.
 */
export class TaskToolTracker {
  private tools = new Map<string, ToolUsageRecord>();
  readonly taskId: string;

  constructor(taskId: string) {
    this.taskId = taskId;
  }

  /** Record a tool call. Call this when an agent uses a tool. */
  record(toolName: string): void {
    const tier = classifyTool(toolName);
    const now = Date.now();
    const existing = this.tools.get(toolName);

    if (existing) {
      existing.count++;
      existing.lastSeen = now;
    } else {
      this.tools.set(toolName, {
        tool: toolName,
        tier,
        count: 1,
        firstSeen: now,
        lastSeen: now,
      });
    }
  }

  /** Get the risk profile for this task. */
  getProfile(): TaskRiskProfile {
    const tools = Array.from(this.tools.values());
    const totalCalls = tools.reduce((sum, t) => sum + t.count, 0);

    let maxTier: RiskTier = 'safe';
    for (const t of tools) {
      if (t.tier === 'dangerous') { maxTier = 'dangerous'; break; }
      if (t.tier === 'moderate') maxTier = 'moderate';
    }

    return {
      taskId: this.taskId,
      maxTier,
      totalCalls,
      tools,
    };
  }

  /** Format a human-readable risk summary. */
  formatSummary(): string {
    const profile = this.getProfile();
    const lines = [`Risk: ${profile.maxTier} (${profile.totalCalls} tool calls)`];

    const dangerous = profile.tools.filter(t => t.tier === 'dangerous');
    if (dangerous.length > 0) {
      lines.push('  Dangerous tools:');
      for (const t of dangerous) {
        lines.push(`    - ${t.tool}: ${t.count}x`);
      }
    }

    return lines.join('\n');
  }
}

/**
 * Compare two risk tiers. Returns positive if a > b, negative if a < b, 0 if equal.
 */
export function compareTiers(a: RiskTier, b: RiskTier): number {
  const order: Record<RiskTier, number> = { safe: 0, moderate: 1, dangerous: 2 };
  return order[a] - order[b];
}
