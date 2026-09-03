import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { installHooks, uninstallHooks, getProjectConfigPath, getGlobalConfigPath } from '../../src/hooks/installers/index.js';
import { normalizeHookInput } from '../../src/hooks/normalizer.js';
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
    expect(config.hooks.UserPromptSubmit[0].hooks[0].command).toBe('memorix hook --agent grok');
    expect(config.hooks.SessionStart[0].hooks[0].timeout).toBe(10);
    expect(config.hooks.Stop).toBeDefined();
    expect(config.hooks.PreCompact).toBeDefined();
    expect(config.hooks.PostToolUse).toBeDefined();
  });

  it('points global install at ~/.grok/hooks/memorix.json, not RuleSync dest', () => {
    const globalPath = getGlobalConfigPath('grok');
    expect(globalPath).toBe(path.join(os.homedir(), '.grok', 'hooks', 'memorix.json'));
    expect(globalPath.includes('rulesync.json')).toBe(false);
  });

  it('normalizes Grok snake_case hookEventName values', () => {
    const prompt = normalizeHookInput({ hookEventName: 'user_prompt_submit', sessionId: 's', cwd: tmpDir, _memorix_agent: 'grok' });
    expect(prompt.event).toBe('user_prompt');
    const tool = normalizeHookInput({ hookEventName: 'post_tool_use', sessionId: 's', cwd: tmpDir, toolName: 'run_terminal_command', toolInput: { command: 'ls' } });
    expect(tool.event).toBe('post_tool');
    expect(tool.agent).toBe('grok');
    expect(tool.command).toBe('ls');
  });

  it('uninstalls the project memorix.json', async () => {
    await installHooks('grok', tmpDir, false);
    const hooksPath = path.join(tmpDir, '.grok', 'hooks', 'memorix.json');
    expect(fsSync.existsSync(hooksPath)).toBe(true);
    await uninstallHooks('grok', tmpDir);
    expect(fsSync.existsSync(hooksPath)).toBe(false);
  });
});
