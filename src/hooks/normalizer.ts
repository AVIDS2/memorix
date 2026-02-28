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

  // Claude Code
  SessionStart: 'session_start',
  UserPromptSubmit: 'user_prompt',
  PreToolUse: 'post_tool', // we handle pre as post for memory purposes
  PostToolUse: 'post_tool',
  PreCompact: 'pre_compact',
  Stop: 'session_end',
  SessionEnd: 'session_end',

  // GitHub Copilot (camelCase, different names from Cursor)
  userPromptSubmitted: 'user_prompt',
  preToolUse: 'post_tool',
  postToolUse: 'post_tool',
  errorOccurred: 'session_end',

  // Gemini CLI / Antigravity (PascalCase, different events from Claude Code)
  BeforeAgent: 'user_prompt',
  AfterAgent: 'post_response',
  BeforeModel: 'user_prompt',
  AfterModel: 'post_response',
  BeforeToolSelection: 'post_tool',
  BeforeTool: 'post_tool',
  AfterTool: 'post_tool',
  PreCompress: 'pre_compact',
  Notification: 'post_response',

  // Windsurf
  pre_user_prompt: 'user_prompt',
  post_write_code: 'post_edit',
  post_read_code: 'post_tool',
  post_run_command: 'post_command',
  pre_mcp_tool_use: 'post_tool',
  post_mcp_tool_use: 'post_tool',
  post_cascade_response: 'post_response',

  // Cursor (camelCase event names — distinct from Copilot by hook_event_name field)
  sessionStart: 'session_start',
  sessionEnd: 'session_end',
  beforeSubmitPrompt: 'user_prompt',
  beforeShellExecution: 'post_command',
  afterShellExecution: 'post_command',
  beforeMCPExecution: 'post_tool',
  afterMCPExecution: 'post_tool',
  afterFileEdit: 'post_edit',
  preCompact: 'pre_compact',
  stop: 'session_end',

  // OpenCode (plugin events piped via Bun.spawn → memorix hook)
  'session.created': 'session_start',
  'session.idle': 'session_end',
  'session.compacted': 'pre_compact',
  'tool.execute.after': 'post_tool',
  'file.edited': 'post_edit',
  'command.executed': 'post_command',
  'message.updated': 'post_response',
};

/**
 * Detect which agent sent this hook event based on payload structure.
 */
function detectAgent(payload: Record<string, unknown>): AgentName {
  // Windsurf uses agent_action_name
  if ('agent_action_name' in payload) return 'windsurf';

  // Cursor sends hook_event_name + conversation_id + workspace_roots
  // Claude Code sends hook_event_name + session_id (no conversation_id)
  if ('conversation_id' in payload || 'cursor_version' in payload) return 'cursor';

  // Gemini CLI / Antigravity: uses hook_event_name but has GEMINI env vars or gemini-specific fields
  if ('gemini_session_id' in payload || 'gemini_project_dir' in payload) return 'antigravity';

  // OpenCode plugin sends agent: 'opencode' (must check BEFORE hook_event_name catch-all)
  if (payload.agent === 'opencode') return 'opencode';

  // Claude Code uses hook_event_name + session_id
  if ('hook_event_name' in payload && 'session_id' in payload) return 'claude';

  // Gemini CLI also uses hook_event_name but without session_id (check after claude)
  if ('hook_event_name' in payload) {
    // Distinguish: Claude Code has session_id, Gemini CLI might not
    // Default to claude for compatibility
    return 'claude';
  }

  // GitHub Copilot: uses toolName (camelCase) + timestamp (number ms)
  if ('toolName' in payload || 'initialPrompt' in payload || 'reason' in payload) return 'copilot';

  // Kiro uses event_type
  if ('event_type' in payload) return 'kiro';

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
      // Cursor sends hook_event_name; fall back to inference if missing
      return (payload.hook_event_name as string) ?? inferCursorEvent(payload);
    case 'claude':
      return (payload.hook_event_name as string) ?? '';
    case 'antigravity':
      // Gemini CLI uses hook_event_name (PascalCase)
      return (payload.hook_event_name as string) ?? '';
    case 'copilot':
      // Copilot: infer event from payload structure
      return inferCopilotEvent(payload);
    case 'opencode':
      // OpenCode plugin sends hook_event_name (e.g. 'session.created', 'tool.execute.after')
      return (payload.hook_event_name as string) ?? '';
    case 'kiro':
      return (payload.event_type as string) ?? '';
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

  // Extract prompt if present (UserPromptSubmit, PreCompact, etc.)
  if (payload.prompt) {
    result.userPrompt = payload.prompt as string;
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
      result.commandOutput = (toolInfo.output as string) ?? (toolInfo.stdout as string) ?? undefined;
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
 * Infer Copilot event from payload structure.
 * Copilot sends typed payloads without a single event name field.
 * See: https://docs.github.com/en/copilot/reference/hooks-configuration
 */
function inferCopilotEvent(payload: Record<string, unknown>): string {
  if ('source' in payload && 'initialPrompt' in payload) return 'sessionStart';
  if ('reason' in payload && !('toolName' in payload)) return 'sessionEnd';
  if ('prompt' in payload) return 'userPromptSubmitted';
  if ('toolName' in payload && 'toolResult' in payload) return 'postToolUse';
  if ('toolName' in payload) return 'preToolUse';
  if ('error' in payload) return 'errorOccurred';
  return '';
}

/**
 * Infer Cursor event type from payload fields.
 * Cursor doesn't send an event name — each hook fires a separate command.
 */
function inferCursorEvent(payload: Record<string, unknown>): string {
  if ('composer_mode' in payload) return 'sessionStart';
  if ('prompt' in payload) return 'beforeSubmitPrompt';
  if ('old_content' in payload || 'new_content' in payload) return 'afterFileEdit';
  if ('command' in payload && 'cwd' in payload) return 'beforeShellExecution';
  if ('trigger' in payload && 'context_usage_percent' in payload) return 'preCompact';
  if ('reason' in payload && 'duration_ms' in payload) return 'sessionEnd';
  if ('mcp_server_name' in payload) return 'afterMCPExecution';
  if ('reason' in payload) return 'stop';
  return '';
}

/**
 * Normalize a Cursor payload.
 */
function normalizeCursor(payload: Record<string, unknown>, event: HookEvent): Partial<NormalizedHookInput> {
  const result: Partial<NormalizedHookInput> = {
    sessionId: (payload.session_id as string) ?? (payload.conversation_id as string) ?? '',
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
    case 'post_tool':
      result.toolName = (payload.mcp_server_name as string) ?? '';
      result.toolInput = payload.mcp_tool_input as Record<string, unknown> | undefined;
      result.toolResult = payload.mcp_tool_output as string | undefined;
      break;
  }

  return result;
}

/**
 * Normalize a GitHub Copilot payload.
 * See: https://docs.github.com/en/copilot/reference/hooks-configuration
 */
function normalizeCopilot(payload: Record<string, unknown>, event: HookEvent): Partial<NormalizedHookInput> {
  const result: Partial<NormalizedHookInput> = {
    sessionId: '',
    cwd: (payload.cwd as string) ?? '',
  };

  switch (event) {
    case 'session_start':
      result.userPrompt = (payload.initialPrompt as string) ?? '';
      break;
    case 'user_prompt':
      result.userPrompt = (payload.prompt as string) ?? '';
      break;
    case 'post_tool': {
      result.toolName = (payload.toolName as string) ?? '';
      const toolArgs = payload.toolArgs as string | undefined;
      if (toolArgs) {
        try { result.toolInput = JSON.parse(toolArgs); } catch { /* ignore */ }
      }
      const toolResult = payload.toolResult as Record<string, unknown> | undefined;
      if (toolResult) {
        result.toolResult = (toolResult.textResultForLlm as string) ?? JSON.stringify(toolResult);
      }
      break;
    }
    case 'session_end':
      // reason: "complete" | "error" | "abort" | "timeout" | "user_exit"
      break;
  }

  return result;
}

/**
 * Normalize a Gemini CLI / Antigravity payload.
 * See: https://geminicli.com/docs/hooks/
 */
function normalizeGemini(payload: Record<string, unknown>, event: HookEvent): Partial<NormalizedHookInput> {
  const result: Partial<NormalizedHookInput> = {
    sessionId: (payload.gemini_session_id as string) ?? (payload.session_id as string) ?? '',
    cwd: (payload.cwd as string) ?? (payload.gemini_project_dir as string) ?? '',
  };

  // Gemini CLI payload structure is similar to Claude Code
  const toolName = (payload.tool_name as string) ?? '';
  if (toolName) {
    result.toolName = toolName;
    result.toolInput = payload.tool_input as Record<string, unknown> | undefined;
    const toolResponse = payload.tool_response ?? payload.tool_result;
    if (typeof toolResponse === 'string') {
      result.toolResult = toolResponse;
    } else if (toolResponse && typeof toolResponse === 'object') {
      result.toolResult = JSON.stringify(toolResponse);
    }
  }

  if (event === 'user_prompt') {
    result.userPrompt = (payload.prompt as string) ?? '';
  }

  return result;
}

/**
 * Normalize an OpenCode plugin payload.
 * OpenCode plugin pipes JSON with { agent: 'opencode', hook_event_name, tool_name, ... }
 */
function normalizeOpenCode(payload: Record<string, unknown>, event: HookEvent): Partial<NormalizedHookInput> {
  const result: Partial<NormalizedHookInput> = {
    sessionId: '',
    cwd: (payload.cwd as string) ?? '',
  };

  const toolName = (payload.tool_name as string) ?? '';
  if (toolName) {
    result.toolName = toolName;
    result.toolInput = payload.tool_input as Record<string, unknown> | undefined;
    const toolResult = payload.tool_result;
    if (typeof toolResult === 'string') {
      result.toolResult = toolResult;
    } else if (toolResult && typeof toolResult === 'object') {
      result.toolResult = JSON.stringify(toolResult);
    }
  }

  if (event === 'post_edit') {
    result.filePath = (payload.file_path as string) ?? '';
  }
  if (event === 'post_command') {
    result.command = (payload.command as string) ?? '';
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
      agentSpecific = normalizeClaude(payload, event);
      break;
    case 'copilot':
      agentSpecific = normalizeCopilot(payload, event);
      break;
    case 'windsurf':
      agentSpecific = normalizeWindsurf(payload, event);
      break;
    case 'cursor':
      agentSpecific = normalizeCursor(payload, event);
      break;
    case 'antigravity':
      agentSpecific = normalizeGemini(payload, event);
      break;
    case 'opencode':
      agentSpecific = normalizeOpenCode(payload, event);
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
