import { spawnSync } from 'node:child_process';

const SESSION_ID = `pi-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

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

function runHook(payload) {
  const data = JSON.stringify({
    agent: 'pi',
    session_id: SESSION_ID,
    timestamp: new Date().toISOString(),
    ...payload,
  });
  const command = process.platform === 'win32' ? 'memorix.cmd' : 'memorix';
  try {
    const result = spawnSync(command, ['hook', '--agent', 'pi'], {
      input: data,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
      timeout: 10_000,
    });
    if (result.status !== 0) {
      console.error(
        '[memorix-pi] hook failed:',
        payload.hook_event_name,
        (result.stderr || result.stdout || '').slice(0, 240),
      );
    }
    return result.stdout ? JSON.parse(result.stdout) : undefined;
  } catch (error) {
    console.error('[memorix-pi] hook delivery failed:', payload.hook_event_name, error?.message ?? error);
    return undefined;
  }
}

export default function memorixPiExtension(pi) {
  let sessionContextMessage = '';

  pi.on('session_start', (event, ctx) => {
    const output = runHook({
      hook_event_name: 'pi.session_start',
      cwd: ctx.cwd,
      reason: event.reason,
    });
    if (output?.systemMessage) {
      sessionContextMessage = output.systemMessage;
    }
  });

  pi.on('before_agent_start', (event, ctx) => {
    const output = runHook({
      hook_event_name: 'pi.before_agent_start',
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
      hook_event_name: 'pi.tool_result',
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
      hook_event_name: 'pi.tool_execution_end',
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
      hook_event_name: 'pi.agent_end',
      cwd: ctx.cwd,
      ai_response: text,
    });
  });

  pi.on('session_before_compact', (event, ctx) => {
    runHook({
      hook_event_name: 'pi.session_before_compact',
      cwd: ctx.cwd,
    });
  });

  pi.on('session_compact', (event, ctx) => {
    runHook({
      hook_event_name: 'pi.session_compact',
      cwd: ctx.cwd,
    });
  });

  pi.on('session_shutdown', (event, ctx) => {
    runHook({
      hook_event_name: 'pi.session_shutdown',
      cwd: ctx.cwd,
      reason: event.reason,
    });
  });
}
