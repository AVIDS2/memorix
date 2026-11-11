/**
 * Project Detector Tests
 *
 * Strict .git-based detection: no .git = null.
 */

import { describe, it, expect } from 'vitest';
import { detectProject } from '../../src/project/detector.js';

describe('Project Detector', () => {
  it('should detect current project (this repo has .git)', () => {
    const project = detectProject();
    expect(project).not.toBeNull();
    expect(project!.id).toBeTruthy();
    expect(project!.name).toBeTruthy();
    expect(project!.rootPath).toBeTruthy();
  }, 30_000);

  it('should detect project from a specific directory with .git', () => {
    const project = detectProject(process.cwd());
    expect(project).not.toBeNull();
    // Normalize path separators for cross-platform compatibility
    expect(project!.rootPath.replace(/\\/g, '/')).toBe(process.cwd().replace(/\\/g, '/'));
  }, 30_000);

  it('should return null for non-git directories', () => {
    const project = detectProject('/tmp');
    expect(project).toBeNull();
  });

  it('should return null for empty directories (no .git)', async () => {
    const { mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const emptyDir = mkdtempSync(join(tmpdir(), 'memorix-test-'));
    const project = detectProject(emptyDir);
    expect(project).toBeNull();
  }, 30_000);
});
