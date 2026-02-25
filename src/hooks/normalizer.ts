/**
 * Hook Normalizer
 *
 * Converts agent-specific stdin JSON into a unified NormalizedHookInput.
 * Each agent has a different event naming convention and payload structure,
 * but they all communicate via stdin/stdout JSON.
 */

import type { AgentName, HookEvent, NormalizedHookInput } from './types.js';

/**
 * Map agent-specific event names → normalized event names.
 */
const EVENT_MAP: Record<string, HookEvent> = {
  // Identity mappings — already-normalized event names
  // This allows direct payloads like { event: 'session_start' } to work
  session_start: 'session_start',
  user_prompt: 'user_prompt',
  post_edit: 'post_edit',
  post_command: 'post_command',
  post_tool: 'post_tool',
  pre_compact: 'pre_compact',
  session_end: 'session_end',
  post_response: 'post_response',

  // Claude Code / VS Code Copilot
  SessionStart: 'session_start',
  UserPromptSubmit: 'user_prompt',
  PreToolUse: 'post_tool', // we handle pre as post for memory purposes
  PostToolUse: 'post_tool',
  PreCompact: 'pre_compact',
  Stop: 'session_end',

  // Windsurf
  pre_user_prompt: 'user_prompt',
  post_write_code: 'post_edit',
  post_read_code: 'post_tool',
  post_run_command: 'post_command',
  pre_mcp_tool_use: 'post_tool',
  post_mcp_tool_use: 'post_tool',
  post_cascade_response: 'post_response',

  // Cursor
  beforeSubmitPrompt: 'user_prompt',
  beforeShellExecution: 'post_command',
  beforeMCPExecution: 'post_tool',
  afterFileEdit: 'post_edit',
  stop: 'session_end',
};

/**
 * Detect which agent sent this hook event based on payload structure.
 */
function detectAgent(payload: Record<string, unknown>): AgentName {
  // Windsurf uses agent_action_name
  if ('agent_action_name' in payload) return 'windsurf';

  // Cursor uses hook_event_name (snake_case) + conversation_id
  if ('hook_event_name' in payload && 'conversation_id' in payload) return 'cursor';

  // Claude Code uses hook_event_name (snake_case) WITHOUT conversation_id
  // Official payload: { hook_event_name: "PostToolUse", session_id: "...", ... }
  if ('hook_event_name' in payload) return 'claude';

  // VS Code Copilot uses hookEventName (camelCase)
  if ('hookEventName' in payload) return 'copilot';

  // Kiro uses event_type
  if ('event_type' in payload) return 'kiro';

  // Codex
  if ('hook_type' in payload) return 'codex';

  return 'claude'; // default fallback
}

/**
 * Extract the raw event name string from agent-specific payload.
 */
function extractEventName(payload: Record<string, unknown>, agent: AgentName): string {
  switch (agent) {
    case 'windsurf':
      return (payload.agent_action_name as string) ?? '';
    case 'cursor':
      return (payload.hook_event_name as string) ?? '';
    case 'claude':
      // Claude Code uses hook_event_name (snake_case)
      return (payload.hook_event_name as string) ?? (payload.hookEventName as string) ?? '';
    case 'copilot':
      return (payload.hookEventName as string) ?? '';
    case 'kiro':
      return (payload.event_type as string) ?? '';
    case 'codex':
      return (payload.hook_type as string) ?? '';
    default:
      return '';
  }
}

/**
 * Normalize a Claude Code / VS Code Copilot payload.
 */
function normalizeClaude(payload: Record<string, unknown>, event: HookEvent): Partial<NormalizedHookInput> {
  // Claude Code uses snake_case fields: session_id, hook_event_name, tool_response
  const result: Partial<NormalizedHookInput> = {
    sessionId: (payload.session_id as string) ?? (payload.sessionId as string) ?? '',
    cwd: (payload.cwd as string) ?? '',
    transcriptPath: payload.transcript_path as string | undefined,
  };

  // PostToolUse / PreToolUse with tool info
  const toolName = (payload.tool_name as string) ?? '';
  if (toolName) {
    result.toolName = toolName;
    result.toolInput = payload.tool_input as Record<string, unknown> | undefined;

    // Claude Code sends tool_response (object), not tool_result (string)
    const toolResponse = payload.tool_response ?? payload.tool_result;
    if (typeof toolResponse === 'string') {
      result.toolResult = toolResponse;
    } else if (toolResponse && typeof toolResponse === 'object') {
      result.toolResult = JSON.stringify(toolResponse);
    }

    // Extract command from Bash tool input
    const toolInput = payload.tool_input as Record<string, unknown> | undefined;
    if (/^bash$/i.test(toolName) && toolInput?.command) {
      result.command = toolInput.command as string;
    }

    // Detect file edits (Write, Edit, MultiEditTool, etc.)
    if (/^(write|edit|multi_edit|multiedittool)$/i.test(toolName)) {
      result.filePath = (toolInput?.file_path as string) ?? (toolInput?.filePath as string);
    }
  }

  // UserPromptSubmit
  if (event === 'user_prompt') {
    result.userPrompt = (payload.prompt as string) ?? '';
  }

  return result;
}

/**
 * Normalize a Windsurf payload.
 */
function normalizeWindsurf(payload: Record<string, unknown>, event: HookEvent): Partial<NormalizedHookInput> {
  const toolInfo = (payload.tool_info as Record<string, unknown>) ?? {};
  const result: Partial<NormalizedHookInput> = {
    sessionId: (payload.trajectory_id as string) ?? '',
    cwd: '',
  };

  switch (event) {
    case 'post_edit':
      result.filePath = toolInfo.file_path as string | undefined;
      if (Array.isArray(toolInfo.edits)) {
        result.edits = (toolInfo.edits as Array<Record<string, string>>).map((e) => ({
          oldString: e.old_string ?? '',
          newString: e.new_string ?? '',
        }));
      }
      break;
    case 'post_command':
      result.command = toolInfo.command_line as string | undefined;
      result.cwd = (toolInfo.cwd as string) ?? '';
      break;
    case 'post_tool':
      result.toolName = toolInfo.mcp_tool_name as string | undefined;
      result.toolInput = toolInfo.mcp_tool_arguments as Record<string, unknown> | undefined;
      result.toolResult = toolInfo.mcp_result as string | undefined;
      break;
    case 'user_prompt':
      result.userPrompt = toolInfo.user_prompt as string | undefined;
      break;
    case 'post_response':
      result.aiResponse = toolInfo.response as string | undefined;
      break;
  }

  return result;
}

/**
 * Normalize a Cursor payload.
 */
function normalizeCursor(payload: Record<string, unknown>, event: HookEvent): Partial<NormalizedHookInput> {
  const result: Partial<NormalizedHookInput> = {
    sessionId: (payload.conversation_id as string) ?? '',
    cwd: (payload.cwd as string) ?? '',
  };

  const roots = payload.workspace_roots as string[] | undefined;
  if (roots?.length && !result.cwd) {
    result.cwd = roots[0];
  }

  switch (event) {
    case 'user_prompt':
      result.userPrompt = (payload.prompt as string) ?? '';
      break;
    case 'post_command':
      result.command = (payload.command as string) ?? '';
      break;
    case 'post_edit':
      result.filePath = (payload.file_path as string) ?? '';
      break;
  }

  return result;
}

/**
 * Main normalizer: convert any agent's stdin payload → NormalizedHookInput.
 */
export function normalizeHookInput(payload: Record<string, unknown>): NormalizedHookInput {
  // Support direct/standard payloads: { event: 'session_start', cwd: '...' }
  // This is used by MCP server internals, CLI, and testing scenarios.
  const directEvent = typeof payload.event === 'string' ? EVENT_MAP[payload.event] : undefined;

  const agent = detectAgent(payload);
  const rawEventName = extractEventName(payload, agent);
  const event: HookEvent = directEvent ?? EVENT_MAP[rawEventName] ?? 'post_tool';
  const timestamp = (payload.timestamp as string) ?? new Date().toISOString();

  let agentSpecific: Partial<NormalizedHookInput> = {};
  switch (agent) {
    case 'claude':
    case 'copilot':
      agentSpecific = normalizeClaude(payload, event);
      break;
    case 'windsurf':
      agentSpecific = normalizeWindsurf(payload, event);
      break;
    case 'cursor':
      agentSpecific = normalizeCursor(payload, event);
      break;
    default:
      agentSpecific = { sessionId: '', cwd: '' };
  }

  return {
    event,
    agent,
    timestamp,
    sessionId: agentSpecific.sessionId ?? '',
    cwd: agentSpecific.cwd ?? '',
    raw: payload,
    ...agentSpecific,
  };
}
