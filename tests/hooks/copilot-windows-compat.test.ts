/**
 * Tests for Copilot hooks Windows runtime compatibility.
 *
 * Verifies that:
 *   - generateCopilotConfig omits `powershell` field when pwsh is not available
 *   - generateCopilotConfig includes `powershell` field when pwsh IS available
 *   - The `bash` field is always present (fallback for Windows without pwsh)
 *   - Install-time pwsh detection works correctly
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { installHooks, uninstallHooks, getHookStatus } from '../../src/hooks/installers/index.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

// Mock detectPwsh via module-level variable injection
// detectPwsh() uses require('node:child_process').execSync internally,
// which can't be spied in ESM. Instead we mock the entire module.
let mockPwshAvailable = false;

vi.mock('node:child_process', () => ({
  execSync: (cmd: string) => {
    if (cmd === 'pwsh --version' && mockPwshAvailable) return 'PowerShell 7.4.0';
    if (cmd === 'pwsh --version') throw new Error('pwsh not found');
    throw new Error('not found');
  },
  spawnSync: () => ({ status: 0, stdout: '', stderr: '' }),
}));

describe('Copilot hooks: Windows runtime compatibility', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memorix-copilot-win-'));
    await fs.mkdir(path.join(tmpDir, '.git'), { recursive: true });
    mockPwshAvailable = false; // default: pwsh not available
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('should always include bash field in copilot config', async () => {
    await installHooks('copilot', tmpDir);
    const configPath = path.join(tmpDir, '.github', 'hooks', 'memorix.json');
    const content = await fs.readFile(configPath, 'utf-8');
    const config = JSON.parse(content);

    // bash field must always be present (fallback for Windows without pwsh)
    const hooks = config.hooks as Record<string, unknown[]>;
    for (const [, entries] of Object.entries(hooks)) {
      for (const entry of entries as Record<string, unknown>[]) {
        expect(entry.bash).toBeDefined();
        expect(typeof entry.bash).toBe('string');
        expect(entry.bash).toContain('memorix');
      }
    }
  });

  it('should include powershell field when pwsh is available', async () => {
    mockPwshAvailable = true;

    await installHooks('copilot', tmpDir);
    const configPath = path.join(tmpDir, '.github', 'hooks', 'memorix.json');
    const content = await fs.readFile(configPath, 'utf-8');
    const config = JSON.parse(content);

    const hooks = config.hooks as Record<string, unknown[]>;
    for (const [, entries] of Object.entries(hooks)) {
      for (const entry of entries as Record<string, unknown>[]) {
        // When pwsh is available, powershell field should be present
        expect(entry.powershell).toBeDefined();
      }
    }
  });

  it('should omit powershell field when pwsh is not available', async () => {
    mockPwshAvailable = false;

    await installHooks('copilot', tmpDir);
    const configPath = path.join(tmpDir, '.github', 'hooks', 'memorix.json');
    const content = await fs.readFile(configPath, 'utf-8');
    const config = JSON.parse(content);

    const hooks = config.hooks as Record<string, unknown[]>;
    for (const [, entries] of Object.entries(hooks)) {
      for (const entry of entries as Record<string, unknown>[]) {
        // When pwsh is NOT available, powershell field should be ABSENT
        expect(entry.powershell).toBeUndefined();
        // bash field must still be present
        expect(entry.bash).toBeDefined();
      }
    }
  });

  it('should use memorix.cmd on Windows for bash field', async () => {
    await installHooks('copilot', tmpDir);
    const configPath = path.join(tmpDir, '.github', 'hooks', 'memorix.json');
    const content = await fs.readFile(configPath, 'utf-8');
    const config = JSON.parse(content);

    const hooks = config.hooks as Record<string, unknown[]>;
    const firstEntry = (Object.values(hooks)[0] as Record<string, unknown>[])[0];
    if (process.platform === 'win32') {
      expect(firstEntry.bash).toContain('memorix.cmd');
    } else {
      expect(firstEntry.bash).toContain('memorix');
    }
  });

  it('should soft-fail global=true for copilot (returns note, not rejection)', async () => {
    const result = await installHooks('copilot', tmpDir, true);
    // Copilot global install returns a result with a note instead of throwing
    expect(result.agent).toBe('copilot');
    const generated = result.generated as Record<string, unknown>;
    expect(generated.note).toContain('global');
  });

  it('should report copilot as installed at project level', async () => {
    await installHooks('copilot', tmpDir);
    const statuses = await getHookStatus(tmpDir);
    const copilot = statuses.find(s => s.agent === 'copilot');
    expect(copilot).toBeDefined();
    expect(copilot!.installed).toBe(true);
    expect(copilot!.configPath).toContain('.github');
  });
});
