import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const childProcess = vi.hoisted(() => ({
  execSync: vi.fn(),
}));

vi.mock('node:child_process', () => childProcess);

import { detectProjectWithDiagnostics } from '../../src/project/detector.js';

describe('Windows CLI child process behavior', () => {
  afterEach(() => {
    childProcess.execSync.mockReset();
  });

  it('hides the heap-size restart subprocess in the published CLI banner', () => {
    const config = readFileSync(join(process.cwd(), 'tsup.config.ts'), 'utf8');
    expect(config).toContain('windowsHide:true');
  });

  it('does not create a detached Windows console for the background service', () => {
    const command = readFileSync(join(process.cwd(), 'src/cli/commands/background.ts'), 'utf8');
    expect(command).toContain("detached: process.platform !== 'win32'");
    expect(command).toContain('windowsHide: true');
  });

  it('hides the slow-path Git probes used by normal CLI commands', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'memorix-window-hide-'));
    try {
      childProcess.execSync
        .mockReturnValueOnce(workspace)
        .mockReturnValueOnce('https://github.com/AVIDS2/memorix.git');

      const result = detectProjectWithDiagnostics(workspace);

      expect(result.project?.id).toBe('AVIDS2/memorix');
      expect(childProcess.execSync).toHaveBeenCalledTimes(2);
      const [rootCommand, rootOptions] = childProcess.execSync.mock.calls[0]!;
      const [remoteCommand, remoteOptions] = childProcess.execSync.mock.calls[1]!;
      expect(rootCommand).toBe('git -c safe.directory=* rev-parse --show-toplevel');
      expect(rootOptions.windowsHide).toBe(true);
      expect(remoteCommand).toBe('git -c safe.directory=* remote get-url origin');
      expect(remoteOptions.windowsHide).toBe(true);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});
