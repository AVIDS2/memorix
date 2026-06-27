import { spawnSync } from 'node:child_process';

const SESSION_ID = `openclaw-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const COMMAND_LABEL = 'memorix hook --agent openclaw';

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({ unserializable: true });
  }
}

function runMemorixHook(payload: Record<string, unknown>): Record<string, unknown> | undefined {
  const command = process.platform === 'win32' ? 'memorix.cmd' : 'memorix';
  try {
    const result = spawnSync(command, ['hook', '--agent', 'openclaw'], {
      input: safeJson({
        agent: 'openclaw',
        session_id: SESSION_ID,
        timestamp: new Date().toISOString(),
        ...payload,
      }),
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
      timeout: 10_000,
    });

    if (result.status !== 0) {
      console.error('[memorix-openclaw] hook failed:', COMMAND_LABEL, (result.stderr || result.stdout || '').slice(0, 240));
      return undefined;
    }
    return result.stdout ? JSON.parse(result.stdout) : undefined;
  } catch (error) {
    console.error('[memorix-openclaw] hook delivery failed:', COMMAND_LABEL, error instanceof Error ? error.message : error);
    return undefined;
  }
}

export default async function handler(event: Record<string, unknown>): Promise<void> {
  const type = typeof event.type === 'string' ? event.type : 'event';
  const action = typeof event.action === 'string' ? event.action : 'unknown';
  const hookEventName = `${type}:${action}`;
  const output = runMemorixHook({
    hook_event_name: `openclaw.${hookEventName}`,
    openclaw_event: event,
  });

  const systemMessage = typeof output?.systemMessage === 'string' ? output.systemMessage : '';
  const context = event.context as { bootstrapFiles?: unknown[] } | undefined;
  if (hookEventName === 'agent:bootstrap' && systemMessage && Array.isArray(context?.bootstrapFiles)) {
    context.bootstrapFiles.push({
      path: 'MEMORIX.md',
      content: systemMessage,
    });
  }
}
