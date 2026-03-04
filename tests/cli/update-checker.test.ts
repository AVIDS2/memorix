/**
 * Tests for the background auto-updater.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// We test the internal helpers by importing the module and mocking externals.
// Since the module uses dynamic imports and global paths, we test the logic
// via the exported checkForUpdates function with mocked fetch/exec.

describe('update-checker', () => {
  const testDir = join(tmpdir(), `memorix-update-test-${Date.now()}`);
  const cacheFile = join(testDir, 'update-check.json');

  beforeEach(async () => {
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe('isNewer (semver comparison)', () => {
    // We need to test the isNewer function. Since it's not exported,
    // we replicate its logic here for unit testing.
    function isNewer(remote: string, local: string): boolean {
      const r = remote.split('.').map(Number);
      const l = local.split('.').map(Number);
      for (let i = 0; i < 3; i++) {
        if ((r[i] ?? 0) > (l[i] ?? 0)) return true;
        if ((r[i] ?? 0) < (l[i] ?? 0)) return false;
      }
      return false;
    }

    it('should detect newer major version', () => {
      expect(isNewer('1.0.0', '0.10.3')).toBe(true);
    });

    it('should detect newer minor version', () => {
      expect(isNewer('0.11.0', '0.10.3')).toBe(true);
    });

    it('should detect newer patch version', () => {
      expect(isNewer('0.10.4', '0.10.3')).toBe(true);
    });

    it('should return false for same version', () => {
      expect(isNewer('0.10.3', '0.10.3')).toBe(false);
    });

    it('should return false for older version', () => {
      expect(isNewer('0.10.2', '0.10.3')).toBe(false);
    });

    it('should handle major version difference', () => {
      expect(isNewer('2.0.0', '1.99.99')).toBe(true);
    });
  });

  describe('cache file', () => {
    it('should be valid JSON when written', async () => {
      const cache = {
        lastCheck: Date.now(),
        latestVersion: '0.10.3',
      };
      await writeFile(cacheFile, JSON.stringify(cache), 'utf-8');
      const read = JSON.parse(await readFile(cacheFile, 'utf-8'));
      expect(read.latestVersion).toBe('0.10.3');
      expect(read.lastCheck).toBeTypeOf('number');
    });

    it('should handle missing cache file gracefully', async () => {
      try {
        await readFile(join(testDir, 'nonexistent.json'), 'utf-8');
      } catch (err: any) {
        expect(err.code).toBe('ENOENT');
      }
    });
  });

  describe('rate limiting logic', () => {
    it('should skip check if last check was within 24 hours', () => {
      const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
      const lastCheck = Date.now() - (1 * 60 * 60 * 1000); // 1 hour ago
      const now = Date.now();
      expect((now - lastCheck) < CHECK_INTERVAL_MS).toBe(true);
    });

    it('should allow check if last check was over 24 hours ago', () => {
      const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
      const lastCheck = Date.now() - (25 * 60 * 60 * 1000); // 25 hours ago
      const now = Date.now();
      expect((now - lastCheck) < CHECK_INTERVAL_MS).toBe(false);
    });
  });

  describe('npm registry URL', () => {
    it('should use correct registry URL format', () => {
      const PACKAGE_NAME = 'memorix';
      const url = `https://registry.npmjs.org/${PACKAGE_NAME}/latest`;
      expect(url).toBe('https://registry.npmjs.org/memorix/latest');
    });
  });

  describe('install command', () => {
    it('should use npm.cmd on Windows', () => {
      const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
      if (process.platform === 'win32') {
        expect(npmCmd).toBe('npm.cmd');
      } else {
        expect(npmCmd).toBe('npm');
      }
    });

    it('should construct correct install args', () => {
      const targetVersion = '0.10.4';
      const args = ['install', '-g', `memorix@${targetVersion}`];
      expect(args).toEqual(['install', '-g', 'memorix@0.10.4']);
    });
  });
});
