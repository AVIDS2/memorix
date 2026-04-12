import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  extractTaskIdFromPath,
  cleanupOrphanWorktrees,
  listWorktrees,
} from '../../src/orchestrate/worktree.js';
import * as cp from 'node:child_process';

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}));

vi.mock('node:fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
  rmSync: vi.fn(),
}));

describe('worktree', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('extractTaskIdFromPath', () => {
    it('should extract short ID from valid path', () => {
      expect(extractTaskIdFromPath('/project/.worktrees/task-abc12345')).toBe('abc12345');
    });

    it('should return null for non-matching path', () => {
      expect(extractTaskIdFromPath('/project/.worktrees/other-dir')).toBeNull();
    });

    it('should return null for empty path', () => {
      expect(extractTaskIdFromPath('')).toBeNull();
    });
  });

  describe('listWorktrees', () => {
    it('should parse git worktree list --porcelain output', () => {
      const porcelainOutput = [
        'worktree /project',
        'HEAD abc123',
        'branch refs/heads/main',
        '',
        'worktree /project/.worktrees/task-deadbeef',
        'HEAD def456',
        'branch refs/heads/pipeline/12345678/task-deadbeef',
        '',
      ].join('\n');

      vi.mocked(cp.execSync).mockReturnValue(porcelainOutput);

      const result = listWorktrees('/project');
      // Only the .worktrees one should be returned
      expect(result).toHaveLength(1);
      expect(result[0].path).toContain('task-deadbeef');
      expect(result[0].branch).toBe('pipeline/12345678/task-deadbeef');
    });

    it('should return empty array on error', () => {
      vi.mocked(cp.execSync).mockImplementation(() => { throw new Error('not a repo'); });
      expect(listWorktrees('/fake')).toEqual([]);
    });
  });

  describe('cleanupOrphanWorktrees', () => {
    it('should clean up worktrees for terminal tasks', () => {
      const porcelainOutput = [
        'worktree /project',
        'HEAD abc123',
        'branch refs/heads/main',
        '',
        'worktree /project/.worktrees/task-aaa11111',
        'HEAD def456',
        'branch refs/heads/pipeline/p1/task-aaa11111',
        '',
        'worktree /project/.worktrees/task-bbb22222',
        'HEAD ghi789',
        'branch refs/heads/pipeline/p1/task-bbb22222',
        '',
      ].join('\n');

      // First call: list, subsequent calls: remove operations
      let callCount = 0;
      vi.mocked(cp.execSync).mockImplementation((cmd: string) => {
        if (cmd.includes('worktree list')) return porcelainOutput;
        callCount++;
        return '';
      });

      const removed = cleanupOrphanWorktrees('/project', (shortId) => {
        // aaa11111 is terminal, bbb22222 is not
        return shortId === 'aaa11111';
      });

      expect(removed).toBe(1);
    });

    it('should return 0 when no orphans exist', () => {
      vi.mocked(cp.execSync).mockImplementation((cmd: string) => {
        if (cmd.includes('worktree list')) return 'worktree /project\nHEAD abc\nbranch refs/heads/main\n';
        return '';
      });

      const removed = cleanupOrphanWorktrees('/project', () => false);
      expect(removed).toBe(0);
    });
  });
});
