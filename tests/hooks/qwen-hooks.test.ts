import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { installHooks, uninstallHooks } from '../../src/hooks/installers/index.js';
import { normalizeHookInput } from '../../src/hooks/normalizer.js';

describe('Qwen Code hooks', () => {
  let projectRoot = '';

  afterEach(async () => {
    if (projectRoot) await rm(projectRoot, { recursive: true, force: true });
    projectRoot = '';
  });

  it('writes the official settings shape while preserving user settings', async () => {
    projectRoot = await mkdtemp(path.join(tmpdir(), 'memorix-qwen-hooks-'));
    const settingsPath = path.join(projectRoot, '.qwen', 'settings.json');
    await fsMkdir(path.dirname(settingsPath));
    await fsWrite(settingsPath, JSON.stringify({ model: 'custom-model', hooks: {
      UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'user-hook' }] }],
    }}));

    const result = await installHooks('qwen', projectRoot);
    const settings = JSON.parse(await readFile(settingsPath, 'utf8')) as Record<string, any>;

    expect(result.configPath).toBe(settingsPath);
    expect(settings.model).toBe('custom-model');
    expect(settings.hooks.UserPromptSubmit).toHaveLength(2);
    expect(settings.hooks.SessionStart[0].hooks[0]).toMatchObject({
      type: 'command',
      command: expect.stringContaining('hook --agent qwen'),
      timeout: 10,
    });
  });

  it('normalizes Qwen Claude-compatible event payloads', () => {
    const input = normalizeHookInput({
      _memorix_agent: 'qwen',
      hook_event_name: 'PostToolUse',
      session_id: 'qwen-session',
      cwd: 'C:/workspace',
      tool_name: 'write_file',
      tool_input: { file_path: 'src/index.ts' },
    });

    expect(input).toMatchObject({
      agent: 'qwen',
      event: 'post_tool',
      sessionId: 'qwen-session',
      cwd: 'C:/workspace',
      toolName: 'write_file',
      filePath: 'src/index.ts',
    });
  });

  it('removes only Memorix hooks during uninstall', async () => {
    projectRoot = await mkdtemp(path.join(tmpdir(), 'memorix-qwen-uninstall-'));
    const settingsPath = path.join(projectRoot, '.qwen', 'settings.json');
    await fsMkdir(path.dirname(settingsPath));
    await fsWrite(settingsPath, JSON.stringify({ model: 'custom-model' }));
    await installHooks('qwen', projectRoot);

    await expect(uninstallHooks('qwen', projectRoot)).resolves.toBe(true);
    const settings = JSON.parse(await readFile(settingsPath, 'utf8')) as Record<string, any>;
    expect(settings).toEqual({ model: 'custom-model' });
  });
});

async function fsMkdir(directory: string): Promise<void> {
  const { mkdir } = await import('node:fs/promises');
  await mkdir(directory, { recursive: true });
}

async function fsWrite(filePath: string, content: string): Promise<void> {
  const { writeFile } = await import('node:fs/promises');
  await writeFile(filePath, content, 'utf8');
}
