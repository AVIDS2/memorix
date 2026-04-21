/**
 * Background Auto-Updater
 *
 * Checks npm registry for newer versions and silently installs updates.
 * Non-blocking — runs entirely in the background after server/TUI starts.
 * Rate-limited to once per 24 hours via a cache file.
 *
 * Default mode: 'install' (silent auto-update).
 * Disable via MEMORIX_AUTO_UPDATE=off or memorix.yml auto-update: off.
 */

import { execFile } from 'node:child_process';
import type { ExecFileException } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createRequire } from 'node:module';

const PACKAGE_NAME = 'memorix';
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const DEFAULT_AUTO_UPDATE_TIMEOUT_MS = 5 * 60 * 1000;
const MIN_AUTO_UPDATE_TIMEOUT_MS = 5_000;
const MAX_AUTO_UPDATE_TIMEOUT_MS = 30 * 60 * 1000;
const REGISTRY_URL = `https://registry.npmjs.org/${PACKAGE_NAME}/latest`;
const CACHE_DIR = join(homedir(), '.memorix');
const CACHE_FILE = join(CACHE_DIR, 'update-check.json');

export interface UpdateCache {
  lastCheck: number;
  latestVersion: string;
  lastAutoUpdate?: number;
  lastAutoUpdateStatus?: 'success' | 'failed';
  lastAutoUpdateError?: string;
  lastAutoUpdateTimedOut?: boolean;
  lastAutoUpdateExitCode?: number | null;
  lastAutoUpdateSignal?: string | null;
  lastAutoUpdateTimeoutMs?: number;
  updatedFrom?: string;
  updatedTo?: string;
}

/**
 * Get the current installed version from package.json.
 */
export function getCurrentVersion(): string {
  try {
    const require = createRequire(import.meta.url);
    const pkg = require('../../package.json');
    return pkg.version;
  } catch {
    return '0.0.0';
  }
}

/**
 * Compare two semver strings. Returns true if remote > local.
 */
export function isNewer(remote: string, local: string): boolean {
  const r = remote.split('.').map(Number);
  const l = local.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((r[i] ?? 0) > (l[i] ?? 0)) return true;
    if ((r[i] ?? 0) < (l[i] ?? 0)) return false;
  }
  return false;
}

/**
 * Read the update check cache. Exported for doctor/status display.
 */
export async function readCache(): Promise<UpdateCache | null> {
  try {
    const data = await readFile(CACHE_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    return null;
  }
}

/**
 * Write the update check cache.
 */
async function writeCache(cache: UpdateCache): Promise<void> {
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(CACHE_FILE, JSON.stringify(cache, null, 2), 'utf-8');
  } catch { /* silent */ }
}

/**
 * Check if auto-update is enabled.
 * Default: true (install mode). Disable via MEMORIX_AUTO_UPDATE=off.
 */
function isAutoUpdateEnabled(): boolean {
  const env = process.env.MEMORIX_AUTO_UPDATE?.toLowerCase()?.trim();
  if (env === 'off' || env === 'false' || env === '0' || env === 'notify') return false;
  return true; // default: install
}

function parseAutoUpdateTimeoutMs(raw: string | undefined): number {
  const value = raw?.trim();
  if (!value) return DEFAULT_AUTO_UPDATE_TIMEOUT_MS;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_AUTO_UPDATE_TIMEOUT_MS;
  return Math.max(MIN_AUTO_UPDATE_TIMEOUT_MS, Math.min(MAX_AUTO_UPDATE_TIMEOUT_MS, Math.floor(parsed)));
}

function describeAutoUpdateFailure(error: ExecFileException, timeoutMs: number): {
  message: string;
  timedOut: boolean;
  exitCode: number | null;
  signal: string | null;
} {
  const timedOut = /timed out/i.test(error.message);
  const exitCode = typeof error.code === 'number' ? error.code : null;
  const signal = typeof error.signal === 'string' ? error.signal : null;
  const details: string[] = [];
  if (timedOut) details.push(`timeout ${timeoutMs}ms`);
  if (exitCode !== null) details.push(`exit code ${exitCode}`);
  if (signal) details.push(`signal ${signal}`);
  return {
    message: details.length > 0 ? `${error.message} (${details.join(', ')})` : error.message,
    timedOut,
    exitCode,
    signal,
  };
}

/**
 * Fetch the latest version from npm registry.
 * Uses native https to avoid dependencies. Timeout: 5s.
 */
async function fetchLatestVersion(): Promise<string | null> {
  try {
    const { default: https } = await import('node:https');
    return new Promise((resolve) => {
      const req = https.get(REGISTRY_URL, { timeout: 5000 }, (res) => {
        if (res.statusCode !== 200) { resolve(null); return; }
        let body = '';
        res.on('data', (chunk: Buffer) => { body += chunk.toString(); });
        res.on('end', () => {
          try {
            const data = JSON.parse(body);
            resolve(data.version ?? null);
          } catch { resolve(null); }
        });
      });
      req.on('error', () => resolve(null));
      req.on('timeout', () => { req.destroy(); resolve(null); });
    });
  } catch {
    return null;
  }
}

/**
 * Silently install the latest version in the background.
 * Writes result to the cache file so doctor/status can report it.
 */
function installUpdateInBackground(targetVersion: string, currentVersion: string, cache: UpdateCache): void {
  try {
    const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const timeoutMs = parseAutoUpdateTimeoutMs(process.env.MEMORIX_AUTO_UPDATE_TIMEOUT_MS);
    const child = execFile(
      npmCmd,
      ['install', '-g', `${PACKAGE_NAME}@${targetVersion}`],
      { timeout: timeoutMs },
      async (error) => {
        const failure = error ? describeAutoUpdateFailure(error, timeoutMs) : null;
        const updatedCache: UpdateCache = {
          ...cache,
          lastAutoUpdate: Date.now(),
          updatedFrom: currentVersion,
          updatedTo: targetVersion,
          lastAutoUpdateStatus: error ? 'failed' : 'success',
          lastAutoUpdateError: failure?.message,
          lastAutoUpdateTimedOut: failure?.timedOut,
          lastAutoUpdateExitCode: failure?.exitCode,
          lastAutoUpdateSignal: failure?.signal,
          lastAutoUpdateTimeoutMs: timeoutMs,
        };
        await writeCache(updatedCache);
        if (error) {
          console.error(`[memorix] Auto-update failed: ${failure?.message ?? error.message}`);
        } else {
          console.error(`[memorix] Auto-updated to v${targetVersion} — restart to apply`);
        }
      },
    );
    // Unref so the child process doesn't prevent the main process from exiting
    child.unref();
  } catch (err) {
    console.error(`[memorix] Auto-update spawn failed:`, (err as Error)?.message ?? err);
  }
}

/**
 * Run the background update check + silent auto-install.
 *
 * Call this fire-and-forget from entry points (serve-http, TUI).
 * - Rate-limited to 1 check per 24h
 * - Default mode: install (silent auto-update)
 * - Disable via MEMORIX_AUTO_UPDATE=off
 * - All output goes to stderr only (never stdout / MCP / TUI content)
 * - Failures never crash the caller
 */
export async function checkForUpdates(): Promise<void> {
  try {
    if (!isAutoUpdateEnabled()) return;

    const cache = await readCache();
    const now = Date.now();

    // Rate limit: skip if checked within the last 24 hours
    if (cache && (now - cache.lastCheck) < CHECK_INTERVAL_MS) {
      return;
    }

    const latestVersion = await fetchLatestVersion();
    if (!latestVersion) return;

    const currentVersion = getCurrentVersion();

    // Update cache with check timestamp
    const updatedCache: UpdateCache = {
      lastCheck: now,
      latestVersion,
      lastAutoUpdate: cache?.lastAutoUpdate,
      lastAutoUpdateStatus: cache?.lastAutoUpdateStatus,
      lastAutoUpdateError: cache?.lastAutoUpdateError,
      lastAutoUpdateTimedOut: cache?.lastAutoUpdateTimedOut,
      lastAutoUpdateExitCode: cache?.lastAutoUpdateExitCode,
      lastAutoUpdateSignal: cache?.lastAutoUpdateSignal,
      lastAutoUpdateTimeoutMs: cache?.lastAutoUpdateTimeoutMs,
      updatedFrom: cache?.updatedFrom,
      updatedTo: cache?.updatedTo,
    };
    await writeCache(updatedCache);

    if (isNewer(latestVersion, currentVersion)) {
      console.error(`[memorix] v${latestVersion} available (current: v${currentVersion}), auto-updating...`);
      installUpdateInBackground(latestVersion, currentVersion, updatedCache);
    }
  } catch {
    // Entire update check is best-effort — never crash the caller
  }
}

// ── Test helpers (exported for testing only) ──────────────────

/** @internal */
export const _testing = {
  CACHE_FILE,
  CHECK_INTERVAL_MS,
  DEFAULT_AUTO_UPDATE_TIMEOUT_MS,
  isAutoUpdateEnabled,
  parseAutoUpdateTimeoutMs,
  describeAutoUpdateFailure,
  fetchLatestVersion,
  installUpdateInBackground,
  writeCache,
  isNewer,
  getCurrentVersion,
};
