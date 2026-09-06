import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { installHooks, uninstallHooks, getProjectConfigPath, getGlobalConfigPath, getAgentRulesPath, getHookStatus } from '../../src/hooks/installers/index.js';
import { normalizeHookInput } from '../../src/hooks/normalizer.js';
import { formatHookOutput } from '../../src/hooks/handler.js';
import type { HookOutput } from '../../src/hooks/types.js';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function makeTmpDir(): string {
  return fsSync.mkdtempSync(path.join(os.tmpdir(), 'memorix-grok-hooks-'));
}

describe('Grok Build hooks', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('writes a standalone memorix.json for project installs', async () => {
    const result = await installHooks('grok', tmpDir, false);
    const hooksPath = path.join(tmpDir, '.grok', 'hooks', 'memorix.json');
    expect(result.configPath).toBe(hooksPath);
    expect(getProjectConfigPath('grok', tmpDir)).toBe(hooksPath);

    const config = JSON.parse(await fs.readFile(hooksPath, 'utf-8'));
    const expectedCmd = process.platform === 'win32'
      ? 'memorix.cmd hook --agent grok'
      : 'memorix hook --agent grok';
    expect(config.hooks.UserPromptSubmit[0].hooks[0].command).toBe(expectedCmd);
    expect(config.hooks.UserPromptSubmit[0].hooks[0].command.includes(' ')).toBe(true);
    expect(config.hooks.SessionStart[0].hooks[0].timeout).toBe(10);
    expect(config.hooks.SessionEnd).toBeDefined();
    expect(config.hooks.Stop).toBeDefined();
    expect(config.hooks.StopFailure).toBeDefined();
    expect(config.hooks.PreCompact).toBeDefined();
    expect(config.hooks.PostCompact).toBeDefined();
    expect(config.hooks.PostToolUseFailure).toBeDefined();
    expect(config.hooks.PostToolUse).toBeDefined();
    expect(config.version).toBeUndefined();
    expect(config.mcp_servers).toBeUndefined();
  });

  it('preserves unrelated Grok hooks when installing and uninstalling', async () => {
    const hooksPath = path.join(tmpDir, '.grok', 'hooks', 'memorix.json');
    await fs.mkdir(path.dirname(hooksPath), { recursive: true });
    await fs.writeFile(hooksPath, JSON.stringify({
      custom: 'keep-me',
      hooks: {
        UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'echo user-hook' }] }],
        Stop: [{ hooks: [{ type: 'command', command: 'echo stop-hook' }] }],
      },
    }), 'utf-8');

    await installHooks('grok', tmpDir, false);
    const installed = JSON.parse(await fs.readFile(hooksPath, 'utf-8'));
    expect(installed.custom).toBe('keep-me');
    expect(installed.hooks.UserPromptSubmit).toHaveLength(2);
    expect(installed.hooks.UserPromptSubmit[0].hooks[0].command).toBe('echo user-hook');

    await uninstallHooks('grok', tmpDir, false);
    const uninstalled = JSON.parse(await fs.readFile(hooksPath, 'utf-8'));
    expect(uninstalled.custom).toBe('keep-me');
    expect(uninstalled.hooks.UserPromptSubmit).toHaveLength(1);
    expect(uninstalled.hooks.UserPromptSubmit[0].hooks[0].command).toBe('echo user-hook');
    expect(uninstalled.hooks.Stop).toHaveLength(1);
    expect(uninstalled.hooks.Stop[0].hooks[0].command).toBe('echo stop-hook');
  });

  it('does not overwrite an invalid Grok hook file', async () => {
    const hooksPath = path.join(tmpDir, '.grok', 'hooks', 'memorix.json');
    await fs.mkdir(path.dirname(hooksPath), { recursive: true });
    await fs.writeFile(hooksPath, '{invalid json', 'utf-8');

    await expect(installHooks('grok', tmpDir, false)).rejects.toThrow('Cannot safely update Grok hook config');
    expect(await fs.readFile(hooksPath, 'utf-8')).toBe('{invalid json');
  });

  it('points global install at ~/.grok/hooks/memorix.json, not RuleSync dest', () => {
    const globalPath = getGlobalConfigPath('grok');
    expect(globalPath).toBe(path.join(os.homedir(), '.grok', 'hooks', 'memorix.json'));
    expect(globalPath.includes('rulesync.json')).toBe(false);
  });

  it('honors GROK_HOME for global hooks and rules', () => {
    const previous = process.env.GROK_HOME;
    const grokHome = path.join(tmpDir, 'custom-grok-home');
    process.env.GROK_HOME = grokHome;
    try {
      expect(getGlobalConfigPath('grok')).toBe(path.join(grokHome, 'hooks', 'memorix.json'));
      expect(getAgentRulesPath('grok', os.homedir(), true)).toBe(path.join(grokHome, 'AGENTS.md'));
    } finally {
      if (previous === undefined) delete process.env.GROK_HOME;
      else process.env.GROK_HOME = previous;
    }
  });

  it('normalizes the official Grok camelCase payload shape', () => {
    const prompt = normalizeHookInput({ hookEventName: 'user_prompt_submit', sessionId: 's', workspaceRoot: tmpDir, prompt: 'continue the release', _memorix_agent: 'grok' });
    expect(prompt.event).toBe('user_prompt');
    expect(prompt.sessionId).toBe('s');
    expect(prompt.cwd).toBe(tmpDir);
    expect(prompt.userPrompt).toBe('continue the release');

    const tool = normalizeHookInput({ hookEventName: 'post_tool_use', sessionId: 's', workspaceRoot: tmpDir, toolName: 'run_terminal_command', toolInput: { command: 'git status' }, toolResult: { stdout: 'clean' }, _memorix_agent: 'grok' });
    expect(tool.event).toBe('post_tool');
    expect(tool.agent).toBe('grok');
    expect(tool.cwd).toBe(tmpDir);
    expect(tool.command).toBe('git status');
    expect(tool.toolResult).toBe('{"stdout":"clean"}');

    const edit = normalizeHookInput({ hookEventName: 'post_tool_use', sessionId: 's', cwd: tmpDir, toolName: 'search_replace', toolInput: { path: 'src/index.ts' }, _memorix_agent: 'grok' });
    expect(edit.filePath).toBe('src/index.ts');
  });

  it('normalizes Grok compaction and failure events without inventing summaries', () => {
    const compact = normalizeHookInput({ hookEventName: 'pre_compact', sessionId: 's', cwd: tmpDir, reason: 'auto', tokensBefore: 1234, _memorix_agent: 'grok' });
    expect(compact.event).toBe('pre_compact');
    expect(compact.compaction).toEqual({ reason: 'auto', tokensBefore: 1234 });

    const failure = normalizeHookInput({ hookEventName: 'post_tool_use_failure', sessionId: 's', cwd: tmpDir, toolName: 'run_terminal_command', toolInput: { command: 'npm test' }, error: 'failed', _memorix_agent: 'grok' });
    expect(failure.event).toBe('post_tool');
    expect(failure.command).toBe('npm test');
    expect(failure.toolResult).toBe('failed');
  });

  it('uses Grok rules locations and keeps Grok hook output passive', () => {
    expect(getAgentRulesPath('grok', tmpDir)).toBe(path.join(tmpDir, 'AGENTS.md'));
    expect(getAgentRulesPath('grok', os.homedir(), true)).toBe(path.join(os.homedir(), '.grok', 'AGENTS.md'));

    const output: HookOutput = { continue: true, systemMessage: 'context that must not become a Grok decision' };
    expect(formatHookOutput('grok', 'UserPromptSubmit', output)).toEqual({});
    expect(formatHookOutput('grok', 'SessionStart', output)).toEqual({});
  });

  it('does not claim an untrusted project hook is runtime-verified', async () => {
    await installHooks('grok', tmpDir, false);
    const status = await getHookStatus(tmpDir);
    expect(status.find((entry) => entry.agent === 'grok')).toMatchObject({
      installed: true,
      verified: false,
    });
  });

  it('uninstalls the project memorix.json', async () => {
    await installHooks('grok', tmpDir, false);
    const hooksPath = path.join(tmpDir, '.grok', 'hooks', 'memorix.json');
    expect(fsSync.existsSync(hooksPath)).toBe(true);
    await uninstallHooks('grok', tmpDir);
    expect(fsSync.existsSync(hooksPath)).toBe(false);
  });
});
