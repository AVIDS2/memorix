import { describe, it, expect } from 'vitest';
import { findGitInSubdirs, detectProject } from '../../src/project/detector.js';

describe('findGitInSubdirs', () => {
  it('should find memorix/.git from parent workspace dir', () => {
    // e:\my_idea_cc\my_copilot has no .git, but memorix subdir does
    const result = findGitInSubdirs('e:\\my_idea_cc\\my_copilot');
    expect(result).not.toBeNull();
    expect(result!).toMatch(/memorix/i);
  });

  it('should detect project after finding subdir .git', () => {
    const subdir = findGitInSubdirs('e:\\my_idea_cc\\my_copilot');
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
