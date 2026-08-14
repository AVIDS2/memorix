import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatHookOutput } from '../../src/hooks/handler.js';

describe('CodeBuddy plugin hooks', () => {
  it('uses the official SessionStart additionalContext output shape', () => {
    expect(formatHookOutput('codebuddy', 'SessionStart', {
      continue: true,
      systemMessage: 'Memorix Autopilot Brief for project',
    })).toEqual({
      continue: true,
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: 'Memorix Autopilot Brief for project',
      },
    });
  });

  it('ships only the documented lifecycle hook set and a bundled stdio MCP server', async () => {
    const root = path.join(process.cwd(), 'plugins', 'codebuddy', 'memorix');
    const hooks = JSON.parse(await readFile(path.join(root, 'hooks', 'hooks.json'), 'utf-8'));
    const manifest = JSON.parse(await readFile(path.join(root, '.codebuddy-plugin', 'plugin.json'), 'utf-8'));
    const mcp = JSON.parse(await readFile(path.join(root, '.mcp.json'), 'utf-8'));

    expect(Object.keys(hooks.hooks)).toEqual([
      'SessionStart', 'UserPromptSubmit', 'PostToolUse', 'PreCompact', 'Stop',
    ]);
    expect(hooks.hooks.SessionStart[0].hooks[0]).toMatchObject({
      type: 'command', command: 'memorix hook --agent codebuddy', timeout: 10,
    });
    expect(manifest).toMatchObject({
      name: 'memorix', skills: './skills', hooks: './hooks/hooks.json', mcpServers: './.mcp.json',
    });
    expect(mcp.mcpServers.memorix).toMatchObject({
      type: 'stdio', command: 'memorix', args: ['serve', '--mode', 'lite'],
    });
  });
});
