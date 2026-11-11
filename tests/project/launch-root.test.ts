import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  assertNotHomeDataDir,
  homeProjectRootError,
  inheritProjectRootFromHome,
  isHomeDirectory,
  lastProjectRootPath,
  readLastProjectRoot,
  resolveControlPlaneDataDir,
  writeLastProjectRoot,
} from '../../src/project/launch-root.js';

describe('launch-root guards', () => {
  it('detects $HOME and refuses it as a data directory', () => {
    const home = '/Users/tester';
    expect(isHomeDirectory(home, home)).toBe(true);
    expect(isHomeDirectory(`${home}/`, home)).toBe(true);
    expect(isHomeDirectory(`${home}/Projects/app`, home)).toBe(false);
    expect(() => assertNotHomeDataDir(home, home)).toThrow(/Refusing to bind \$HOME/);
    expect(homeProjectRootError(home)).toContain('~/memorix.db');
  });

  it('persists and reads last-project-root, ignoring $HOME and missing paths', () => {
    const home = mkdtempSync(path.join(os.tmpdir(), 'memorix-launch-home-'));
    const project = mkdtempSync(path.join(os.tmpdir(), 'memorix-launch-proj-'));
    try {
      writeLastProjectRoot(home, home);
      expect(readLastProjectRoot(home)).toBeNull();

      writeLastProjectRoot(project, home);
      expect(readLastProjectRoot(home)).toBe(path.resolve(project));
      expect(readFileSync(lastProjectRootPath(home), 'utf8').trim()).toBe(path.resolve(project));

      writeFileSync(lastProjectRootPath(home), `${home}\n`, 'utf8');
      expect(readLastProjectRoot(home)).toBeNull();
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(project, { recursive: true, force: true });
    }
  });

  it('inherits MEMORIX_PROJECT_ROOT or last-project-root when launched from $HOME', () => {
    const home = mkdtempSync(path.join(os.tmpdir(), 'memorix-inherit-home-'));
    const project = mkdtempSync(path.join(os.tmpdir(), 'memorix-inherit-proj-'));
    try {
      expect(inheritProjectRootFromHome({ homeDir: home })).toBeNull();
      expect(inheritProjectRootFromHome({
        homeDir: home,
        envProjectRoot: project,
      })).toBe(path.resolve(project));
      writeLastProjectRoot(project, home);
      expect(inheritProjectRootFromHome({ homeDir: home })).toBe(path.resolve(project));
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(project, { recursive: true, force: true });
    }
  });

  it('never resolves the shared store onto $HOME', () => {
    const home = '/home/tester';
    const globalDataDir = path.join(home, '.memorix', 'data');
    expect(resolveControlPlaneDataDir({
      requestedDataDir: home,
      homeDir: home,
      globalDataDir,
    })).toBe(globalDataDir);
    expect(resolveControlPlaneDataDir({
      requestedDataDir: globalDataDir,
      homeDir: home,
      globalDataDir,
    })).toBe(globalDataDir);
  });
});
