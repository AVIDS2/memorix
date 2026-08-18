/**
 * Launch-root guards for HTTP/stdio/background.
 *
 * LaunchAgents and Cursor stdio often start with cwd=$HOME. Binding that path
 * treats the home directory as a project and can create a decoy ~/memorix.db
 * while the real store lives in ~/.memorix/data/memorix.db.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const LAST_PROJECT_ROOT_FILENAME = 'last-project-root';

export function isHomeDirectory(candidate: string, homeDir: string = os.homedir()): boolean {
  try {
    return path.resolve(candidate) === path.resolve(homeDir);
  } catch {
    return false;
  }
}

export function lastProjectRootPath(homeDir: string = os.homedir()): string {
  return path.join(homeDir, '.memorix', LAST_PROJECT_ROOT_FILENAME);
}

export function readLastProjectRoot(homeDir: string = os.homedir()): string | null {
  try {
    const raw = readFileSync(lastProjectRootPath(homeDir), 'utf8').trim();
    if (!raw) return null;
    const resolved = path.resolve(raw);
    if (isHomeDirectory(resolved, homeDir)) return null;
    if (!existsSync(resolved)) return null;
    return resolved;
  } catch {
    return null;
  }
}

export function writeLastProjectRoot(projectRoot: string, homeDir?: string): void {
  // Tests pass an explicit homeDir. Default writes are skipped under Vitest so
  // unit tests do not mutate the developer's ~/.memorix/last-project-root.
  if (process.env.VITEST && homeDir === undefined) return;
  const resolvedHome = homeDir ?? os.homedir();
  const resolved = path.resolve(projectRoot);
  if (isHomeDirectory(resolved, resolvedHome)) return;
  if (!existsSync(resolved)) return;
  const memorixDir = path.join(resolvedHome, '.memorix');
  mkdirSync(memorixDir, { recursive: true });
  writeFileSync(lastProjectRootPath(resolvedHome), `${resolved}\n`, 'utf8');
}

export function homeProjectRootError(candidate: string): string {
  return (
    `Refusing to bind $HOME as a project root (${candidate}). ` +
    'Pass a git project via --cwd, MEMORIX_PROJECT_ROOT, or memorix_session_start({ projectRoot }). ' +
    'Memorix will not create ~/memorix.db.'
  );
}

/**
 * When the launcher cwd is $HOME, inherit the last git project or an explicit
 * MEMORIX_PROJECT_ROOT. System directories stay fail-closed (no restore).
 */
export function inheritProjectRootFromHome(options: {
  homeDir: string;
  envProjectRoot?: string;
  readLastRoot?: () => string | null;
}): string | null {
  const envRoot = options.envProjectRoot?.trim();
  if (envRoot && !isHomeDirectory(envRoot, options.homeDir) && existsSync(envRoot)) {
    return path.resolve(envRoot);
  }
  const lastRoot = (options.readLastRoot ?? (() => readLastProjectRoot(options.homeDir)))();
  if (lastRoot && !isHomeDirectory(lastRoot, options.homeDir) && existsSync(lastRoot)) {
    return lastRoot;
  }
  return null;
}

/**
 * Shared SQLite must never be opened at $HOME — that creates a decoy ~/memorix.db.
 */
export function resolveControlPlaneDataDir(options: {
  requestedDataDir?: string;
  homeDir?: string;
  globalDataDir: string;
}): string {
  const homeDir = options.homeDir ?? os.homedir();
  if (options.requestedDataDir && !isHomeDirectory(options.requestedDataDir, homeDir)) {
    return options.requestedDataDir;
  }
  return options.globalDataDir;
}

export function assertNotHomeDataDir(dataDir: string, homeDir: string = os.homedir()): void {
  if (isHomeDirectory(dataDir, homeDir)) {
    throw new Error(homeProjectRootError(dataDir));
  }
}
