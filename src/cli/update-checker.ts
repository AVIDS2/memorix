/**
 * Background Auto-Updater
 *
 * Checks npm registry for newer versions and silently installs updates.
 * Non-blocking — runs entirely in the background after MCP server starts.
 * Rate-limited to once per 24 hours via a cache file.
 */

import { execFile } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createRequire } from 'node:module';

const PACKAGE_NAME = 'memorix';
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const REGISTRY_URL = `https://registry.npmjs.org/${PACKAGE_NAME}/latest`;
const CACHE_DIR = join(homedir(), '.memorix');
const CACHE_FILE = join(CACHE_DIR, 'update-check.json');

interface UpdateCache {
  lastCheck: number;
  latestVersion: string;
  lastAutoUpdate?: number;
}

/**
 * Get the current installed version from package.json.
 */
function getCurrentVersion(): string {
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
function isNewer(remote: string, local: string): boolean {
  const r = remote.split('.').map(Number);
  const l = local.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((r[i] ?? 0) > (l[i] ?? 0)) return true;
    if ((r[i] ?? 0) < (l[i] ?? 0)) return false;
  }
  return false;
}

/**
 * Read the update check cache.
 */
async function readCache(): Promise<UpdateCache | null> {
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
    await writeFile(CACHE_FILE, JSON.stringify(cache), 'utf-8');
  } catch { /* silent */ }
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
 * Uses detached child process so it doesn't block the MCP server.
 */
function installUpdateInBackground(targetVersion: string): void {
  try {
    const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const child = execFile(
      npmCmd,
      ['install', '-g', `${PACKAGE_NAME}@${targetVersion}`],
      { timeout: 60000 },
      (error) => {
        if (error) {
          console.error(`[memorix] Auto-update failed: ${error.message}`);
        } else {
          console.error(`[memorix] ✅ Auto-updated to v${targetVersion} — takes effect on next restart`);
        }
      },
    );
    // Unref so the child process doesn't prevent the main process from exiting
    child.unref();
  } catch (err) {
    console.error(`[memorix] Auto-update spawn failed:`, err);
  }
}

/**
 * Run the background update check.
 * Call this after MCP server is fully started — it's entirely fire-and-forget.
 */
export async function checkForUpdates(): Promise<void> {
  try {
    const cache = await readCache();
    const now = Date.now();

    // Rate limit: skip if checked within the last 24 hours
    if (cache && (now - cache.lastCheck) < CHECK_INTERVAL_MS) {
      return;
    }

    const latestVersion = await fetchLatestVersion();
    if (!latestVersion) return;

    const currentVersion = getCurrentVersion();

    // Update cache regardless of whether we need to update
    await writeCache({
      lastCheck: now,
      latestVersion,
      lastAutoUpdate: cache?.lastAutoUpdate,
    });

    if (isNewer(latestVersion, currentVersion)) {
      console.error(`[memorix] New version available: v${currentVersion} → v${latestVersion}`);
      console.error(`[memorix] Auto-updating in background...`);
      installUpdateInBackground(latestVersion);
    }
  } catch {
    // Entire update check is best-effort — never crash the server
  }
}
