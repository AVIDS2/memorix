/**
 * Project Detector Tests
 *
 * Tests Git remote URL normalization logic.
 * TDD: Tests the normalizeGitRemote behavior via detectProject.
 */

import { describe, it, expect } from 'vitest';
import { detectProject } from '../../src/project/detector.js';

describe('Project Detector', () => {
  it('should detect current project (this repo has a git remote or uses dir name)', () => {
    const project = detectProject();
    expect(project.id).toBeTruthy();
    expect(project.name).toBeTruthy();
    expect(project.rootPath).toBeTruthy();
  }, 30_000);

  it('should detect project from a specific directory', () => {
    const project = detectProject(process.cwd());
    // Normalize path separators for cross-platform compatibility
    expect(project.rootPath.replace(/\\/g, '/')).toBe(process.cwd().replace(/\\/g, '/'));
  }, 30_000); // Git commands can be slow on Windows (antivirus, dubious ownership)

  it('should fallback to directory name for non-git dirs', () => {
    const project = detectProject('/tmp');
    expect(project.id).toBeTruthy();
    expect(project.gitRemote).toBeUndefined();
  });

  it('should work with empty directories (no git, no project files)', async () => {
    const { mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const emptyDir = mkdtempSync(join(tmpdir(), 'memorix-test-'));
    const project = detectProject(emptyDir);
    // Should NOT return __invalid__ — empty dirs are valid projects
    expect(project.id).not.toBe('__invalid__');
    expect(project.id).toMatch(/^local\//);
    expect(project.name).toBeTruthy();
  }, 30_000);
});
