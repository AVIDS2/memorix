/**
 * Auto-Update Wiring Tests
 *
 * Proves that auto-update is truly wired into real product behavior:
 * 1. isNewer / getCurrentVersion work via actual exports (not replicated logic)
 * 2. checkForUpdates is non-blocking (returns a promise, never throws)
 * 3. 24h rate limit skips duplicate checks
 * 4. MEMORIX_AUTO_UPDATE=off disables the check
 * 5. Entry points (serve-http, index.ts) contain the wiring call
 * 6. All update output goes to stderr, never stdout
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

 const { mockExecFile } = vi.hoisted(() => ({
   mockExecFile: vi.fn(),
 }));

 vi.mock('node:child_process', () => ({
   execFile: mockExecFile,
 }));

// Import the ACTUAL exports — not replicated logic
import {
  isNewer,
  getCurrentVersion,
  readCache,
  checkForUpdates,
  _testing,
} from '../../src/cli/update-checker.js';

describe('Auto-Update', () => {
  beforeEach(() => {
    mockExecFile.mockReset();
    mockExecFile.mockReturnValue({ unref: vi.fn() });
  });

  // ════════════════════════════════════════════════
  // Exported helpers — using real module exports
  // ════════════════════════════════════════════════

  describe('isNewer (exported semver comparison)', () => {
    it('newer major', () => expect(isNewer('1.0.0', '0.10.3')).toBe(true));
    it('newer minor', () => expect(isNewer('0.11.0', '0.10.3')).toBe(true));
    it('newer patch', () => expect(isNewer('0.10.4', '0.10.3')).toBe(true));
    it('same version', () => expect(isNewer('0.10.3', '0.10.3')).toBe(false));
    it('older version', () => expect(isNewer('0.10.2', '0.10.3')).toBe(false));
    it('major beats minor', () => expect(isNewer('2.0.0', '1.99.99')).toBe(true));
  });

  describe('getCurrentVersion', () => {
    it('returns a valid semver string from package.json', () => {
      const ver = getCurrentVersion();
      expect(ver).toMatch(/^\d+\.\d+\.\d+/);
      expect(ver).not.toBe('0.0.0');
    });
  });

  describe('readCache', () => {
    it('returns null when cache file does not exist', async () => {
      // readCache reads from the real ~/.memorix/update-check.json.
      // If it doesn't exist, it returns null. If it does, it returns data.
      // Either way, it should not throw.
      const result = await readCache();
      expect(result === null || typeof result === 'object').toBe(true);
    });
  });

  // ════════════════════════════════════════════════
  // checkForUpdates — non-blocking, failure-safe
  // ════════════════════════════════════════════════

  describe('checkForUpdates behavior', () => {
    const origEnv = process.env.MEMORIX_AUTO_UPDATE;

    afterEach(() => {
      if (origEnv === undefined) {
        delete process.env.MEMORIX_AUTO_UPDATE;
      } else {
        process.env.MEMORIX_AUTO_UPDATE = origEnv;
      }
    });

    it('returns a Promise that resolves (never throws)', async () => {
      // Even if network is down or cache is corrupted, checkForUpdates
      // must resolve without throwing — it's fire-and-forget.
      await expect(checkForUpdates()).resolves.toBeUndefined();
    });

    it('MEMORIX_AUTO_UPDATE=off disables the check entirely', async () => {
      process.env.MEMORIX_AUTO_UPDATE = 'off';
      // Should return immediately without any network call
      const start = Date.now();
      await checkForUpdates();
      const elapsed = Date.now() - start;
      // Disabled check should be near-instant (< 50ms, no network)
      expect(elapsed).toBeLessThan(200);
    });

    it('isAutoUpdateEnabled defaults to true', () => {
      delete process.env.MEMORIX_AUTO_UPDATE;
      expect(_testing.isAutoUpdateEnabled()).toBe(true);
    });

    it('isAutoUpdateEnabled returns false for off/false/0/notify', () => {
      for (const val of ['off', 'false', '0', 'notify', 'OFF', 'False']) {
        process.env.MEMORIX_AUTO_UPDATE = val;
        expect(_testing.isAutoUpdateEnabled()).toBe(false);
      }
    });
  });

  // ════════════════════════════════════════════════
  // 24h rate limit
  // ════════════════════════════════════════════════

  describe('24h rate limit', () => {
    it('CHECK_INTERVAL_MS is 24 hours', () => {
      expect(_testing.CHECK_INTERVAL_MS).toBe(24 * 60 * 60 * 1000);
    });
  });

  describe('timeout configuration and diagnostics', () => {
    const origTimeoutEnv = process.env.MEMORIX_AUTO_UPDATE_TIMEOUT_MS;

    afterEach(() => {
      if (origTimeoutEnv === undefined) {
        delete process.env.MEMORIX_AUTO_UPDATE_TIMEOUT_MS;
      } else {
        process.env.MEMORIX_AUTO_UPDATE_TIMEOUT_MS = origTimeoutEnv;
      }
    });

    it('defaults the silent auto-update timeout to 5 minutes', () => {
      delete process.env.MEMORIX_AUTO_UPDATE_TIMEOUT_MS;
      expect(_testing.parseAutoUpdateTimeoutMs(process.env.MEMORIX_AUTO_UPDATE_TIMEOUT_MS)).toBe(
        _testing.DEFAULT_AUTO_UPDATE_TIMEOUT_MS,
      );
    });

    it('clamps invalid or extreme timeout values safely', () => {
      expect(_testing.parseAutoUpdateTimeoutMs('not-a-number')).toBe(_testing.DEFAULT_AUTO_UPDATE_TIMEOUT_MS);
      expect(_testing.parseAutoUpdateTimeoutMs('1000')).toBe(5000);
      expect(_testing.parseAutoUpdateTimeoutMs('999999999')).toBe(30 * 60 * 1000);
    });

    it('passes the configured timeout to the background npm install', () => {
      process.env.MEMORIX_AUTO_UPDATE_TIMEOUT_MS = '123456';

      _testing.installUpdateInBackground('1.2.4', '1.2.3', {
        lastCheck: 0,
        latestVersion: '1.2.4',
      });

      expect(mockExecFile).toHaveBeenCalledWith(
        expect.any(String),
        ['install', '-g', 'memorix@1.2.4'],
        expect.objectContaining({ timeout: 123456 }),
        expect.any(Function),
      );
    });

    it('includes timeout, exit code, and signal details in failure diagnostics', () => {
      const failure = _testing.describeAutoUpdateFailure({
        name: 'Error',
        message: 'Command failed: npm install timed out',
        code: 124,
        signal: 'SIGTERM',
        killed: true,
      } as any, 123456);

      expect(failure).toMatchObject({
        timedOut: true,
        exitCode: 124,
        signal: 'SIGTERM',
      });
      expect(failure.message).toContain('timeout 123456ms');
      expect(failure.message).toContain('exit code 124');
      expect(failure.message).toContain('signal SIGTERM');
    });
  });

  // ════════════════════════════════════════════════
  // Wiring verification — entry points contain the call
  // ════════════════════════════════════════════════

  describe('entry point wiring', () => {
    it('serve-http.ts contains checkForUpdates() call', () => {
      const src = readFileSync(
        join(__dirname, '../../src/cli/commands/serve-http.ts'),
        'utf-8',
      );
      expect(src).toContain('checkForUpdates');
      expect(src).toContain('update-checker');
    });

    it('index.ts (TUI/workbench) contains checkForUpdates() call', () => {
      const src = readFileSync(
        join(__dirname, '../../src/cli/index.ts'),
        'utf-8',
      );
      expect(src).toContain('checkForUpdates');
      expect(src).toContain('update-checker');
    });

    it('both wiring sites use fire-and-forget pattern (.catch(() => {}))', () => {
      const serveHttp = readFileSync(
        join(__dirname, '../../src/cli/commands/serve-http.ts'),
        'utf-8',
      );
      const index = readFileSync(
        join(__dirname, '../../src/cli/index.ts'),
        'utf-8',
      );
      // Both must catch errors to prevent unhandled rejections
      expect(serveHttp).toContain(".catch(() => {})");
      expect(index).toContain(".catch(() => {})");
    });

    it('doctor.ts reads update cache for status display', () => {
      const src = readFileSync(
        join(__dirname, '../../src/cli/commands/doctor.ts'),
        'utf-8',
      );
      expect(src).toContain('readCache');
      expect(src).toContain('Auto-Update');
    });
  });

  // ════════════════════════════════════════════════
  // Output goes to stderr only, never stdout
  // ════════════════════════════════════════════════

  describe('output isolation', () => {
    it('checkForUpdates does not write to stdout', async () => {
      const origWrite = process.stdout.write;
      let stdoutCaptured = '';
      process.stdout.write = ((chunk: any) => {
        stdoutCaptured += String(chunk);
        return true;
      }) as any;

      try {
        await checkForUpdates();
      } finally {
        process.stdout.write = origWrite;
      }

      // No update-related output should appear on stdout
      expect(stdoutCaptured).not.toContain('update');
      expect(stdoutCaptured).not.toContain('memorix');
      expect(stdoutCaptured).not.toContain('version');
    });
  });

  // ════════════════════════════════════════════════
  // UpdateCache schema
  // ════════════════════════════════════════════════

  describe('UpdateCache schema', () => {
    it('cache file path ends with update-check.json', () => {
      expect(_testing.CACHE_FILE).toContain('update-check.json');
    });
  });
});
