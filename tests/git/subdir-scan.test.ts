import { describe, it, expect } from 'vitest';
import { basename, dirname } from 'node:path';
import { findGitInSubdirs, detectProject } from '../../src/project/detector.js';

describe('findGitInSubdirs', () => {
  const repoRoot = process.cwd();
  const workspaceDir = dirname(repoRoot);
  const repoName = basename(repoRoot);

  it('should find memorix/.git from parent workspace dir', () => {
    const result = findGitInSubdirs(workspaceDir);
    expect(result).not.toBeNull();
    expect(result!).toContain(repoName);
  });

  it('should detect project after finding subdir .git', () => {
    const subdir = findGitInSubdirs(workspaceDir);
    expect(subdir).not.toBeNull();
    const project = detectProject(subdir!);
    expect(project).not.toBeNull();
    expect(project!.id).toBe('AVIDS2/memorix');
  });

  it('should return null for dirs with no git subdirs', async () => {
    const { mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'memorix-no-subdirs-'));
    expect(findGitInSubdirs(dir)).toBeNull();
  });
});
