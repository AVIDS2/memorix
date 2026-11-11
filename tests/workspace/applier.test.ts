/**
 * Workspace Sync Applier Tests
 *
 * Tests backup, write, rollback, and cleanup functionality.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { WorkspaceSyncApplier } from '../../src/workspace/applier.js';

let testDir: string;

beforeEach(async () => {
  testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memorix-applier-'));
});

describe('WorkspaceSyncApplier', () => {
  it('should write new files to disk', async () => {
    const applier = new WorkspaceSyncApplier();
    const filePath = path.join(testDir, 'config.json');

    const result = await applier.apply([
      { filePath, content: '{"test": true}' },
    ]);

    expect(result.success).toBe(true);
    expect(result.filesWritten).toHaveLength(1);
    expect(existsSync(filePath)).toBe(true);
    expect(readFileSync(filePath, 'utf-8')).toBe('{"test": true}');
  });

  it('should create parent directories if needed', async () => {
    const applier = new WorkspaceSyncApplier();
    const filePath = path.join(testDir, 'deep', 'nested', 'config.json');

    const result = await applier.apply([
      { filePath, content: 'nested content' },
    ]);

    expect(result.success).toBe(true);
    expect(existsSync(filePath)).toBe(true);
  });

  it('should backup existing files before overwriting', async () => {
    const applier = new WorkspaceSyncApplier();
    const filePath = path.join(testDir, 'existing.json');

    // Create existing file
    writeFileSync(filePath, 'original content', 'utf-8');

    const result = await applier.apply([
      { filePath, content: 'new content' },
    ]);

    expect(result.success).toBe(true);
    expect(result.backups).toHaveLength(1);
    expect(existsSync(result.backups[0].backupPath)).toBe(true);
    expect(readFileSync(result.backups[0].backupPath, 'utf-8')).toBe('original content');
    expect(readFileSync(filePath, 'utf-8')).toBe('new content');
  });

  it('should rollback on failure', async () => {
    const applier = new WorkspaceSyncApplier();
    const filePath = path.join(testDir, 'existing.json');

    // Create existing file
    writeFileSync(filePath, 'original content', 'utf-8');

    // Rollback test: backup then restore
    const backups = [
      {
        originalPath: filePath,
        backupPath: filePath + '.bak',
      },
    ];
    writeFileSync(backups[0].backupPath, 'original content', 'utf-8');
    writeFileSync(filePath, 'corrupted content', 'utf-8');

    const rollbackResult = applier.rollback(backups);
    expect(rollbackResult.restored).toBe(1);
    expect(readFileSync(filePath, 'utf-8')).toBe('original content');
  });

  it('should clean up backup files', async () => {
    const applier = new WorkspaceSyncApplier();
    const backupPath = path.join(testDir, 'test.backup');
    writeFileSync(backupPath, 'backup', 'utf-8');

    applier.cleanBackups([
      { originalPath: path.join(testDir, 'test'), backupPath },
    ]);

    expect(existsSync(backupPath)).toBe(false);
  });

  it('should handle empty file list', async () => {
    const applier = new WorkspaceSyncApplier();
    const result = await applier.apply([]);

    expect(result.success).toBe(true);
    expect(result.filesWritten).toHaveLength(0);
  });

  it('should write multiple files atomically', async () => {
    const applier = new WorkspaceSyncApplier();
    const files = [
      { filePath: path.join(testDir, 'a.json'), content: '{"a": 1}' },
      { filePath: path.join(testDir, 'b.json'), content: '{"b": 2}' },
      { filePath: path.join(testDir, 'c.json'), content: '{"c": 3}' },
    ];

    const result = await applier.apply(files);

    expect(result.success).toBe(true);
    expect(result.filesWritten).toHaveLength(3);
    for (const f of files) {
      expect(readFileSync(f.filePath, 'utf-8')).toBe(f.content);
    }
  });
});
