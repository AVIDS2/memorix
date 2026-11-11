import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { collectCurrentProjectFacts, formatGitFact } from '../../src/codegraph/current-facts.js';

describe('current project facts', () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not describe an invalid .git directory as a clean worktree', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'memorix-current-facts-invalid-git-'));
    roots.push(root);
    mkdirSync(path.join(root, '.git'), { recursive: true });

    const facts = collectCurrentProjectFacts({ project: { rootPath: root }, now: new Date() });

    expect(facts.git).toEqual({ available: false, dirty: false, detached: false });
    expect(formatGitFact(facts.git)).toBe('Git: unavailable');
  });

  it('keeps valid Git worktree facts available', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'memorix-current-facts-valid-git-'));
    roots.push(root);
    execFileSync('git', ['init'], { cwd: root, stdio: 'ignore' });
    writeFileSync(path.join(root, 'pending.ts'), 'export const pending = true;\n', 'utf8');

    const facts = collectCurrentProjectFacts({ project: { rootPath: root }, now: new Date() });

    expect(facts.git.available).toBe(true);
    expect(facts.git.dirty).toBe(true);
    expect(formatGitFact(facts.git)).toContain('dirty worktree');
  });
});
