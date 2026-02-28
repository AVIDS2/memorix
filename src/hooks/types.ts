/**
 * Hook Types
 *
 * Unified type definitions for the cross-agent hooks system.
 */

/** Normalized event names (agent-agnostic) */
export type HookEvent =
  | 'session_start'
  | 'user_prompt'
  | 'post_edit'
  | 'post_command'
  | 'post_tool'
  | 'pre_compact'
  | 'session_end'
  | 'post_response';

/** Supported agent identifiers */
export type AgentName = 'claude' | 'copilot' | 'windsurf' | 'cursor' | 'kiro' | 'codex' | 'antigravity' | 'opencode';

/** Normalized hook input — agent-agnostic */
export interface NormalizedHookInput {
  event: HookEvent;
  agent: AgentName;
  timestamp: string;
  sessionId: string;
  cwd: string;

  /** User's prompt text (for user_prompt event) */
  userPrompt?: string;

  /** AI response text (for post_response event) */
  aiResponse?: string;

  /** File path affected (for post_edit event) */
  filePath?: string;

  /** File edit details (for post_edit event) */
  edits?: Array<{ oldString: string; newString: string }>;

  /** Command executed (for post_command event) */
  command?: string;

  /** Command output (for post_command event) */
  commandOutput?: string;

  /** Tool name used (for post_tool event) */
  toolName?: string;

  /** Tool input arguments (for post_tool event) */
  toolInput?: Record<string, unknown>;

  /** Tool result (for post_tool event) */
  toolResult?: string;

  /** Full transcript path (for pre_compact / session_end) */
  transcriptPath?: string;

  /** Raw agent-specific payload (preserved for debugging) */
  raw: Record<string, unknown>;
}

/** Hook output — controls agent behavior */
export interface HookOutput {
  /** Whether to continue the agent's operation */
  continue: boolean;

  /** Message to inject into agent context */
  systemMessage?: string;

  /** Reason for stopping (if continue=false) */
  stopReason?: string;

  /** For Windsurf: show output to user */
  showOutput?: boolean;
}

/** Pattern detection result */
export type PatternType =
  | 'decision'
  | 'error'
  | 'learning'
  | 'implementation'
  | 'configuration'
  | 'gotcha'
  | 'deployment';

export interface DetectedPattern {
  type: PatternType;
  confidence: number; // 0-1
  matchedKeywords: string[];
}

/** Hook configuration for an agent */
export interface AgentHookConfig {
  agent: AgentName;
  configPath: string;
  events: HookEvent[];
  generated: Record<string, unknown>;
}
