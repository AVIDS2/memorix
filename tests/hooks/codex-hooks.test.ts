import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatHookOutput, handleHookEvent } from '../../src/hooks/handler.js';
import { normalizeHookInput } from '../../src/hooks/normalizer.js';

describe('Codex hooks', () => {
  it('normalizes official Codex hook payloads when the plugin sets the agent identity', () => {
    const input = normalizeHookInput({
      _memorix_agent: 'codex',
      hook_event_name: 'PostToolUse',
      session_id: 'codex-session-1',
      cwd: 'E:\\work\\project',
      tool_name: 'apply_patch',
      tool_input: { patch: '*** Begin Patch' },
      tool_response: 'Done!',
    });

    expect(input.agent).toBe('codex');
    expect(input.event).toBe('post_tool');
    expect(input.sessionId).toBe('codex-session-1');
    expect(input.toolName).toBe('apply_patch');
  });

  it('preserves Codex lifecycle event names instead of falling back to post_tool', () => {
    const input = normalizeHookInput({
      _memorix_agent: 'codex',
      hook_event_name: 'SessionStart',
      session_id: 'codex-session-2',
      cwd: 'E:\\work\\project',
      source: 'startup',
    });

    expect(input.agent).toBe('codex');
    expect(input.event).toBe('session_start');
  });

  it('captures the final Codex response from Stop payloads', async () => {
    const input = normalizeHookInput({
      _memorix_agent: 'codex',
      hook_event_name: 'Stop',
      session_id: 'codex-session-3',
      cwd: 'E:\\work\\project',
      last_assistant_message: 'Implemented the Codex hook adapter, added the regression tests, and verified the plugin package in an isolated runtime.',
    });

    expect(input.event).toBe('session_end');
    expect(input.aiResponse).toContain('Codex hook adapter');
    await expect(handleHookEvent(input)).resolves.toMatchObject({
      observation: expect.objectContaining({
        narrative: expect.stringContaining('Codex hook adapter'),
      }),
    });
  });

  it('injects the SessionStart brief through Codex hookSpecificOutput', () => {
    const output = formatHookOutput('codex', 'SessionStart', {
      continue: true,
      systemMessage: 'Memorix Autopilot Brief for memorix',
    });

    expect(output).toEqual({
      continue: true,
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: 'Memorix Autopilot Brief for memorix',
      },
    });
  });

  it('keeps automatic capture events quiet in Codex', () => {
    const output = formatHookOutput('codex', 'PostToolUse', {
      continue: true,
      systemMessage: '[CHANGE] Memorix saved: handler.ts [what-changed]',
    });

    expect(output).toEqual({ continue: true });
  });

  it('ships only documented Codex lifecycle hooks with a Windows command override', async () => {
    const pluginRoot = path.join(process.cwd(), 'plugins', 'codex', 'memorix');
    const hooks = JSON.parse(await readFile(path.join(pluginRoot, 'hooks', 'hooks.json'), 'utf-8'));
    const manifest = JSON.parse(await readFile(path.join(pluginRoot, '.codex-plugin', 'plugin.json'), 'utf-8'));

    expect(Object.keys(hooks.hooks)).toHaveLength(5);
    expect(Object.keys(hooks.hooks)).toEqual(expect.arrayContaining([
      'SessionStart',
      'UserPromptSubmit',
      'PostToolUse',
      'PreCompact',
      'Stop',
    ]));
    expect(hooks.hooks.SessionStart[0].matcher).toBe('startup|resume|clear|compact');
    expect(hooks.hooks.PostToolUse[0].matcher).toBe('*');
    expect(hooks.hooks.PreCompact[0].matcher).toBe('manual|auto');
    expect(hooks.hooks.SessionStart[0].hooks[0]).toMatchObject({
      type: 'command',
      command: 'memorix hook --agent codex',
      commandWindows: 'memorix.cmd hook --agent codex',
    });
    expect(manifest.hooks).toBe('./hooks/hooks.json');
  });
});
