import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const childProcess = vi.hoisted(() => ({
  execSync: vi.fn(),
}));

vi.mock('node:child_process', () => childProcess);

import { detectProjectWithDiagnostics } from '../../src/project/detector.js';
import { buildCliHeapBannerPrelude } from '../../src/cli/heap.js';

describe('Windows CLI child process behavior', () => {
  afterEach(() => {
    childProcess.execSync.mockReset();
  });

  it('hides the heap-size restart subprocess in the published CLI banner', () => {
    expect(buildCliHeapBannerPrelude()).toContain('windowsHide:true');
  });

  it('uses the hidden Windows launcher for the background service', () => {
    const command = readFileSync(join(process.cwd(), 'src/cli/commands/background.ts'), 'utf8');
    expect(command).toContain("spawn('powershell.exe'");
    expect(command).toContain('Start-Process');
    expect(command).toContain('-WindowStyle Hidden');
    expect(command).toContain('windowsHide: true');
  });

  it('hides verification commands launched by orchestration', () => {
    const verifyGate = readFileSync(join(process.cwd(), 'src/orchestrate/verify-gate.ts'), 'utf8');
    expect(verifyGate).toContain('shell: true');
    expect(verifyGate).toContain('windowsHide: true');
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
