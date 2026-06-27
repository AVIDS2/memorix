import { spawnSync } from 'node:child_process';

const SESSION_ID = `omp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

function asText(value) {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object' && typeof item.text === 'string') return item.text;
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function latestAssistantText(messages) {
  if (!Array.isArray(messages)) return '';
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || typeof message !== 'object') continue;
    if (message.role && message.role !== 'assistant') continue;
    const content = message.content ?? message.message?.content;
    const text = asText(content).trim();
    if (text) return text;
  }
  return '';
}

function runMemorix(args, input) {
  const command = process.platform === 'win32' ? 'memorix.cmd' : 'memorix';
  const result = spawnSync(command, args, {
    input,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
    timeout: 10_000,
  });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || '').slice(0, 500));
  }
  return result.stdout;
}

function runHook(payload) {
  const data = JSON.stringify({
    agent: 'omp',
    session_id: SESSION_ID,
    timestamp: new Date().toISOString(),
    ...payload,
  });
  try {
    const stdout = runMemorix(['hook', '--agent', 'omp'], data);
    return stdout ? JSON.parse(stdout) : undefined;
  } catch (error) {
    console.error('[memorix-omp] hook delivery failed:', payload.hook_event_name, error?.message ?? error);
    return undefined;
  }
}

function runCli(args) {
  try {
    const stdout = runMemorix(args);
    return stdout.trim() || 'Memorix command completed.';
  } catch (error) {
    return `Memorix command failed: ${error?.message ?? error}`;
  }
}

export default function memorixOmpExtension(pi) {
  let sessionContextMessage = '';

  pi.on('session_start', (event, ctx) => {
    const output = runHook({
      hook_event_name: 'omp.session_start',
      cwd: ctx.cwd,
      reason: event.reason,
    });
    if (output?.systemMessage) {
      sessionContextMessage = output.systemMessage;
    }
  });

  pi.on('before_agent_start', (event, ctx) => {
    const output = runHook({
      hook_event_name: 'omp.before_agent_start',
      cwd: ctx.cwd,
      prompt: event.prompt,
    });
    const content = [sessionContextMessage, output?.systemMessage].filter(Boolean).join('\n');
    if (!content) return undefined;
    return {
      message: {
        customType: 'memorix',
        content,
        display: false,
      },
    };
  });

  pi.on('tool_result', (event, ctx) => {
    runHook({
      hook_event_name: 'omp.tool_result',
      cwd: ctx.cwd,
      tool_name: event.toolName,
      tool_input: event.input,
      tool_result: {
        content: event.content,
        details: event.details,
        isError: event.isError,
      },
    });
  });

  pi.on('tool_execution_end', (event, ctx) => {
    runHook({
      hook_event_name: 'omp.tool_execution_end',
      cwd: ctx.cwd,
      tool_name: event.toolName,
      tool_result: event.result,
      is_error: event.isError,
    });
  });

  pi.on('agent_end', (event, ctx) => {
    const text = latestAssistantText(event.messages);
    if (!text) return;
    runHook({
      hook_event_name: 'omp.agent_end',
      cwd: ctx.cwd,
      ai_response: text,
    });
  });

  pi.on('session_before_compact', (event, ctx) => {
    runHook({
      hook_event_name: 'omp.session_before_compact',
      cwd: ctx.cwd,
    });
  });

  pi.on('session_compact', (event, ctx) => {
    runHook({
      hook_event_name: 'omp.session_compact',
      cwd: ctx.cwd,
    });
  });

  pi.on('session_shutdown', (event, ctx) => {
    runHook({
      hook_event_name: 'omp.session_shutdown',
      cwd: ctx.cwd,
      reason: event.reason,
    });
  });

  pi.registerCommand('memorix', {
    description: 'Search Memorix project memory',
    handler: async (rawArgs) => {
      const query = Array.isArray(rawArgs) ? rawArgs.join(' ') : asText(rawArgs);
      return query.trim()
        ? runCli(['search', query])
        : runCli(['recent', '--limit', '5']);
    },
  });
}
