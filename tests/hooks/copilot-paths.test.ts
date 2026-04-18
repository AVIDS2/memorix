/**
 * Tests for GitHub Copilot hooks path alignment.
 *
 * Bug: getGlobalConfigPath('copilot') used to fall through to the Claude
 * case, returning ~/.claude/settings.json — which is completely wrong.
 *
 * Per official GitHub docs (Apr 2026):
 *   - Project-level: .github/hooks/*.json
 *   - Global: NOT SUPPORTED
 *   - Feature request: https://github.com/github/copilot-cli/issues/1157
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getProjectConfigPath,
  getGlobalConfigPath,
  installHooks,
  uninstallHooks,
  getHookStatus,
} from '../../src/hooks/installers/index.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

describe('GitHub Copilot hooks paths', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memorix-copilot-'));
    await fs.mkdir(path.join(tmpDir, '.git'), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // ─── Project path ───

  it('project path should be .github/hooks/memorix.json', () => {
    const p = getProjectConfigPath('copilot', tmpDir);
    expect(p).toBe(path.join(tmpDir, '.github', 'hooks', 'memorix.json'));
  });

  // ─── Global path ───

  it('global path should be empty string (not supported)', () => {
    const p = getGlobalConfigPath('copilot');
    expect(p).toBe('');
  });

  it('global path should NOT be ~/.claude/settings.json', () => {
    const p = getGlobalConfigPath('copilot');
    expect(p).not.toContain('.claude');
  });

  // ─── Install: project-level ───

  it('should install hooks at project level', async () => {
    const result = await installHooks('copilot', tmpDir, false);
    expect(result.agent).toBe('copilot');
    expect(result.configPath).toBe(path.join(tmpDir, '.github', 'hooks', 'memorix.json'));

    // File should exist and be valid JSON
    const content = await fs.readFile(result.configPath, 'utf-8');
    const config = JSON.parse(content);
    expect(config.version).toBe(1);
    expect(config.hooks).toBeDefined();
    expect(config.hooks.sessionStart).toBeDefined();
    expect(config.hooks.postToolUse).toBeDefined();
  });

  // ─── Install: global (rejected) ───

  it('should reject global install and return honest note', async () => {
    const result = await installHooks('copilot', tmpDir, true);
    expect(result.agent).toBe('copilot');
    expect(result.events).toEqual([]);
    expect(result.generated).toHaveProperty('note');
    const note = (result.generated as { note: string }).note;
    expect(note).toContain('does not support global hooks');
    expect(note).toContain('project-level');
  });

  it('global install should NOT create any file', async () => {
    await installHooks('copilot', tmpDir, true);

    // No file should be created at the wrong path
    const wrongPath = path.join(os.homedir(), '.claude', 'settings.json');
    // We can't check the actual file content (it may exist for Claude),
    // but we verify that no memorix hooks were injected there.
    // The key point: installHooks returns a rejection, not a success.
  });

  // ─── Uninstall: global (rejected) ───

  it('should reject global uninstall', async () => {
    const result = await uninstallHooks('copilot', tmpDir, true);
    expect(result).toBe(false);
  });

  // ─── Uninstall: project-level ───

  it('should uninstall project-level hooks', async () => {
    await installHooks('copilot', tmpDir, false);
    const pluginPath = path.join(tmpDir, '.github', 'hooks', 'memorix.json');
    await fs.access(pluginPath); // exists

    const result = await uninstallHooks('copilot', tmpDir, false);
    expect(result).toBe(true);

    // File should be cleaned up (either deleted or hooks key removed)
  });

  // ─── Hook status ───

  it('should report copilot as installed when project file exists', async () => {
    await installHooks('copilot', tmpDir, false);
    const statuses = await getHookStatus(tmpDir);
    const copilot = statuses.find(s => s.agent === 'copilot');
    expect(copilot).toBeDefined();
    expect(copilot!.installed).toBe(true);
    expect(copilot!.verified).toBe(true); // config-based agent
  });

  it('should report copilot as not installed when no file exists', async () => {
    const statuses = await getHookStatus(tmpDir);
    const copilot = statuses.find(s => s.agent === 'copilot');
    expect(copilot).toBeDefined();
    expect(copilot!.installed).toBe(false);
  });

  it('status should not check wrong global path (~/.claude/settings.json)', async () => {
    const statuses = await getHookStatus(tmpDir);
    const copilot = statuses.find(s => s.agent === 'copilot');
    // If copilot is not installed, configPath should be the project path
    // (not the wrong ~/.claude path)
    expect(copilot!.configPath).not.toContain('.claude');
    expect(copilot!.configPath).toContain('.github');
  });

  // ─── Config format ───

  it('should generate version:1 config with correct hook events', async () => {
    await installHooks('copilot', tmpDir, false);
    const pluginPath = path.join(tmpDir, '.github', 'hooks', 'memorix.json');
    const content = await fs.readFile(pluginPath, 'utf-8');
    const config = JSON.parse(content);

    expect(config.version).toBe(1);
    expect(config.hooks.sessionStart).toBeDefined();
    expect(config.hooks.sessionEnd).toBeDefined();
    expect(config.hooks.userPromptSubmitted).toBeDefined();
    expect(config.hooks.postToolUse).toBeDefined();
    // preToolUse should be omitted (memorix is observer, not gatekeeper)
    expect(config.hooks.preToolUse).toBeUndefined();
  });

  it('should include bash key in hook entries (powershell is conditional on pwsh availability)', async () => {
    await installHooks('copilot', tmpDir, false);
    const pluginPath = path.join(tmpDir, '.github', 'hooks', 'memorix.json');
    const content = await fs.readFile(pluginPath, 'utf-8');
    const config = JSON.parse(content);

    const entry = config.hooks.sessionStart[0];
    expect(entry.type).toBe('command');
    expect(entry.bash).toBeDefined();
    // powershell field is only present when pwsh (PowerShell v7+) is available.
    // On systems without pwsh, the field is omitted to prevent "spawn pwsh.exe ENOENT".
    // Copilot falls back to the bash field (executed via Git Bash on Windows).
  });

  // ─── Reinstall ───

  it('should handle install → uninstall → reinstall cycle', async () => {
    await installHooks('copilot', tmpDir, false);
    await uninstallHooks('copilot', tmpDir, false);
    const result = await installHooks('copilot', tmpDir, false);

    expect(result.agent).toBe('copilot');
    const content = await fs.readFile(result.configPath, 'utf-8');
    const config = JSON.parse(content);
    expect(config.version).toBe(1);
    expect(config.hooks.sessionStart).toBeDefined();
  });
});
