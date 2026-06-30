import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findGitInSubdirs, detectProject } from '../../src/project/detector.js';

describe('findGitInSubdirs', () => {
  function makeWorkspace(): { workspaceDir: string; repoDir: string } {
    const workspaceDir = mkdtempSync(join(tmpdir(), 'memorix-subdir-scan-'));
    const repoDir = join(workspaceDir, 'memorix');
    execSync('git init memorix', { cwd: workspaceDir, stdio: 'ignore' });
    execSync('git remote add origin https://github.com/AVIDS2/memorix.git', { cwd: repoDir, stdio: 'ignore' });
    return { workspaceDir, repoDir };
  }

  it('should find memorix/.git from parent workspace dir', async () => {
    const { workspaceDir, repoDir } = makeWorkspace();
    try {
      const result = findGitInSubdirs(workspaceDir);
      expect(result).toBe(repoDir);
    } finally {
      rmSync(workspaceDir, { recursive: true, force: true });
    }
  });

  it('should detect project after finding subdir .git', async () => {
    const { workspaceDir } = makeWorkspace();
    try {
      const subdir = findGitInSubdirs(workspaceDir);
      expect(subdir).not.toBeNull();
      const project = detectProject(subdir!);
      expect(project).not.toBeNull();
      expect(project!.id).toBe('AVIDS2/memorix');
    } finally {
      rmSync(workspaceDir, { recursive: true, force: true });
    }
  });

  it('should return null for dirs with no git subdirs', () => {
    const dir = mkdtempSync(join(tmpdir(), 'memorix-no-subdirs-'));
    try {
      expect(findGitInSubdirs(dir)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
