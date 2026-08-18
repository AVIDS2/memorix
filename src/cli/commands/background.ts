/**
 * memorix background — Manage the Memorix Control Plane as a background service
 *
 * Subcommands:
 *   memorix background start    — Launch control plane in background (HTTP 3211)
 *   memorix background stop     — Stop the background control plane
 *   memorix background status   — Show running state, PID, port, health
 *   memorix background restart  — Stop + start
 *   memorix background logs     — Tail the background service log
 *
 * State is persisted in ~/.memorix/background.json so status survives shell restarts.
 * Logs are written to ~/.memorix/background.log.
 *
 * Mode distinction:
 *   Quick Mode       = stdio / single project / zero friction
 *   Control Plane    = HTTP / shared MCP / multi-session / live dashboard
 *   Background       = Control Plane's productized run mode (no terminal babysitting)
 */

import { defineCommand } from 'citty';
import * as fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import os from 'node:os';
import { parseTcpPort } from '../port.js';
import { homeProjectRootError, inheritProjectRootFromHome, isHomeDirectory } from '../../project/launch-root.js';

// ============================================================
// Paths & Types
// ============================================================

interface BackgroundState {
  pid: number;
  port: number;
  startedAt: string;   // ISO timestamp
  logFile: string;
  /** Unique instance token — prevents PID-reuse misidentification */
  instanceToken: string;
  /** Shell cwd at start time (informational only, NOT used as daemon anchor) */
  startCwd?: string;
}

export function resolveBackgroundCwd(cwd: string, homeDir: string = os.homedir()): string {
  if (!isHomeDirectory(cwd, homeDir)) return cwd;
  const inherited = inheritProjectRootFromHome({
    homeDir,
    envProjectRoot: process.env.MEMORIX_PROJECT_ROOT,
  });
  if (inherited) return inherited;
  throw new Error(homeProjectRootError(cwd));
}

function getMemorixDir(): string {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  // Use join-style path to ensure native separators on Windows
  return home.replace(/\\/g, '/') + '/.memorix';
}

function normalizePath(p: string): string {
  // Normalize to OS-native separators for display
  return process.platform === 'win32' ? p.replace(/\//g, '\\') : p;
}

function getStateFilePath(): string {
  return getMemorixDir() + '/background.json';
}

function getLogFilePath(): string {
  return getMemorixDir() + '/background.log';
}

function parseBoundedPositiveInteger(value: string | undefined, fallback: number, label: string, maximum: number): number {
  const raw = value ?? String(fallback);
  if (!/^[0-9]+$/u.test(raw)) {
    throw new Error(`${label} must be a whole number between 1 and ${maximum}.`);
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new Error(`${label} must be a whole number between 1 and ${maximum}.`);
  }
  return parsed;
}

function parseBackgroundPort(value: string | undefined): number {
  return parseTcpPort(value, 3211);
}

/**
 * Resolve the CLI file that `background start` should spawn.
 * `process.argv[1]` follows the launcher shim and can point at a different
 * install (for example `$HOME/node_modules/memorix` after `bun add` in $HOME).
 * When this module is bundled into `dist/cli/index.js`, `../index.js` is the
 * library stdio entry (`dist/index.js`) — never spawn that.
 */
function resolveBackgroundCliEntryFrom(here: string, argv1: string): string {
  const dir = path.dirname(here);
  if (path.basename(here) === 'index.js' && path.basename(dir) === 'cli') {
    return here;
  }
  const compiledSibling = path.resolve(dir, '..', 'index.js');
  if (fs.existsSync(compiledSibling) && path.basename(path.dirname(compiledSibling)) === 'cli') {
    return compiledSibling;
  }
  return argv1;
}

function resolveBackgroundCliEntry(argv1 = process.argv[1]): string {
  try {
    return resolveBackgroundCliEntryFrom(fileURLToPath(import.meta.url), argv1);
  } catch {
    return argv1;
  }
}

function parseLogLines(value: string | undefined): number {
  return parseBoundedPositiveInteger(value, 50, 'Log line count', 10_000);
}

function formatBackgroundCommandError(error: unknown, includeStack = process.env.MEMORIX_DEBUG === '1'): string {
  const message = error instanceof Error ? error.message : String(error);
  const base = `[memorix background] Error: ${message}\n`;
  if (!includeStack || !(error instanceof Error) || !error.stack) return base;
  return `${base}${error.stack}\n`;
}

// ============================================================
// State persistence
// ============================================================

function loadState(): BackgroundState | null {
  try {
    const data = fs.readFileSync(getStateFilePath(), 'utf-8');
    return JSON.parse(data) as BackgroundState;
  } catch {
    return null;
  }
}

function saveState(state: BackgroundState): void {
  const dir = getMemorixDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(getStateFilePath(), JSON.stringify(state, null, 2));
}

function clearState(): void {
  try {
    fs.unlinkSync(getStateFilePath());
  } catch { /* already gone */ }
}

// ============================================================
// Process utilities (cross-platform)
// ============================================================

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0); // Signal 0 = existence check, no actual signal sent
    return true;
  } catch {
    return false;
  }
}

function killProcess(pid: number): boolean {
  try {
    // On Windows, process.kill sends SIGTERM which works for Node child processes
    process.kill(pid);
    return true;
  } catch {
    return false;
  }
}

function forceTerminateProcess(pid: number): void {
  if (process.platform === 'win32') {
    execFileSync('taskkill', ['/F', '/PID', String(pid)], { stdio: 'ignore', windowsHide: true });
    return;
  }
  process.kill(pid, 'SIGKILL');
}

function quotePowerShellLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function quoteWindowsCommandArgument(value: string): string {
  if (value.length > 0 && !/[\s"]/u.test(value)) return value;
  return `"${value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/g, '$1$1')}"`;
}

interface WindowsBackgroundLaunchOptions {
  nodePath: string;
  cliEntry: string;
  port: number;
  cwd: string;
  stdoutLogFile: string;
  stderrLogFile: string;
}

function buildWindowsBackgroundStartScript(options: WindowsBackgroundLaunchOptions): string {
  const commandLine = [options.cliEntry, 'serve-http', '--port', String(options.port)]
    .map(quoteWindowsCommandArgument)
    .join(' ');
  return [
    '$ErrorActionPreference = "Stop";',
    `$process = Start-Process -FilePath ${quotePowerShellLiteral(options.nodePath)}`,
    `-ArgumentList ${quotePowerShellLiteral(commandLine)}`,
    `-WorkingDirectory ${quotePowerShellLiteral(options.cwd)}`,
    '-WindowStyle Hidden',
    `-RedirectStandardOutput ${quotePowerShellLiteral(options.stdoutLogFile)}`,
    `-RedirectStandardError ${quotePowerShellLiteral(options.stderrLogFile)}`,
    '-PassThru;',
    '[Console]::Out.Write($process.Id);',
  ].join(' ');
}

async function startWindowsBackgroundService(options: WindowsBackgroundLaunchOptions): Promise<number> {
  const script = buildWindowsBackgroundStartScript(options);
  return new Promise((resolve, reject) => {
    const launcher = spawn('powershell.exe', [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-WindowStyle', 'Hidden',
      '-Command', script,
    ], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (result: { pid?: number; error?: Error }): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);

      // Start-Process may keep the launcher's inherited pipe open after it has
      // already returned the child PID. We only need that first PID, so release
      // the pipe instead of keeping the CLI alive waiting for PowerShell to exit.
      launcher.stdout?.destroy();
      launcher.stderr?.destroy();
      launcher.unref();

      if (result.pid !== undefined) resolve(result.pid);
      else reject(result.error ?? new Error('Windows background launcher failed'));
    };
    const tryResolvePid = (): void => {
      const match = stdout.match(/^\s*(\d+)\b/u);
      if (!match) return;
      const pid = Number.parseInt(match[1], 10);
      if (Number.isSafeInteger(pid) && pid > 0) finish({ pid });
    };
    const timeout = setTimeout(() => {
      finish({ error: new Error('Windows background launcher timed out before returning a process ID') });
    }, 10_000);

    launcher.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
      tryResolvePid();
    });
    launcher.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    launcher.on('error', (error) => finish({ error }));
    launcher.on('close', (code) => {
      if (settled) return;
      const pid = Number.parseInt(stdout.trim(), 10);
      if (code === 0 && Number.isSafeInteger(pid) && pid > 0) {
        finish({ pid });
        return;
      }
      finish({ error: new Error(`Windows background launcher failed${stderr ? `: ${stderr.trim()}` : ''}`) });
    });
  });
}

async function healthCheck(port: number, timeoutMs = 3000): Promise<{ ok: boolean; data?: any; error?: string }> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    // Use /health endpoint — lightweight, no TeamStore or heavy init required.
    // Responds immediately once the HTTP server has bound the port.
    const res = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const data = await res.json();
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

async function isPortInUse(port: number): Promise<boolean> {
  const health = await healthCheck(port, 1500);
  return health.ok;
}

// ============================================================
// Subcommands
// ============================================================

export async function doStart(port: number): Promise<void> {
  // 1. Check if already running — validate both PID existence AND HTTP health
  const state = loadState();
  if (state) {
    if (isProcessRunning(state.pid)) {
      const health = await healthCheck(state.port, 2000);
      if (health.ok) {
        console.log(`[OK] Control plane is already running (PID ${state.pid}, port ${state.port})`);
        console.log(`  Dashboard:  http://127.0.0.1:${state.port}/`);
        console.log(`  MCP:        http://127.0.0.1:${state.port}/mcp`);
        return;
      }
      // PID alive but HTTP not responding — either still starting or stale
      // Give it one more chance with a longer timeout (5s)
      const retry = await healthCheck(state.port, 5000);
      if (retry.ok) {
        console.log(`[OK] Control plane is already running (PID ${state.pid}, port ${state.port})`);
        console.log(`  Dashboard:  http://127.0.0.1:${state.port}/`);
        console.log(`  MCP:        http://127.0.0.1:${state.port}/mcp`);
        return;
      }
      // A live PID without a matching health response may have been reused by an
      // unrelated process. Never kill it based on stale local state alone.
      console.log(`[WARN] Registered process ${state.pid} is alive but port ${state.port} is not responding.`);
      console.log('  Cleared stale Memorix state without stopping that process.');
      clearState();
      // Fall through to auto-restart below
    } else {
      // PID dead — clean up stale state and auto-restart
      console.log(`[WARN] Previous process (PID ${state.pid}) is dead. Cleaning up stale state...`);
      clearState();
      // Fall through to auto-restart below
    }
  } else {
    // No background.json — check heartbeat for crash evidence
    try {
      const heartbeatPath = getMemorixDir() + '/background.heartbeat';
      const hbData = fs.readFileSync(heartbeatPath, 'utf-8');
      const hb = JSON.parse(hbData);
      const age = Date.now() - hb.heartbeatAt;
      if (age < 120_000) { // heartbeat less than 2 minutes old
        console.log(`[WARN] Recent heartbeat found (PID ${hb.pid}, ${Math.round(age / 1000)}s ago) but no background.json.`);
        console.log('  The control plane likely crashed. Auto-restarting...');
      }
      try { fs.unlinkSync(heartbeatPath); } catch { /* ok */ }
    } catch { /* no heartbeat — first run or clean shutdown */ }
  }

  // 2. Check if port is already taken by another process
  if (await isPortInUse(port)) {
    // Port is occupied but no background.json — this is an unmanaged foreground process
    console.log('');
    console.log(`[WARN] Port ${port} is already serving a Memorix control plane, but it is NOT managed by background mode.`);
    console.log('');
    console.log('  This is likely a foreground "memorix serve-http" instance.');
    console.log('  To switch to background mode:');
    console.log('    1. Stop the foreground instance (Ctrl+C in its terminal)');
    console.log('    2. Run "memorix background start"');
    console.log('');
    console.log(`  Dashboard:  http://127.0.0.1:${port}/`);
    console.log(`  MCP:        http://127.0.0.1:${port}/mcp`);
    return;
  }

  // 3. Clean up stale readiness file from previous run
  try {
    const readyFile = getMemorixDir() + '/background.ready';
    if (fs.existsSync(readyFile)) fs.unlinkSync(readyFile);
  } catch { /* ignore */ }

  // 4. Prepare log file
  const logFile = getLogFilePath();
  const dir = getMemorixDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  // Rotate log: keep last run's log as .log.prev
  if (fs.existsSync(logFile)) {
    try { fs.renameSync(logFile, logFile + '.prev'); } catch { /* ok */ }
  }

  // 5. Find the memorix CLI entry point
  // We need to spawn `node <cli-entry> serve-http --port <port>`
  // Prefer this package's compiled CLI so a bun/npm shim cannot spawn a
  // different (often unpatched) memorix from ~/node_modules.
  const cliEntry = resolveBackgroundCliEntry();

  // 6. Start the service without a visible console. A regular non-detached child
  // can be reclaimed with its parent by terminal hosts on Windows; a detached Node
  // child can flash a console. Start-Process gives us a hidden, independent child
  // and its real Node PID. POSIX retains the direct detached child path.
  const startCwd = resolveBackgroundCwd(process.cwd());
  let pid: number;
  try {
    if (process.platform === 'win32') {
      pid = await startWindowsBackgroundService({
        nodePath: process.execPath,
        cliEntry,
        port,
        cwd: startCwd,
        stdoutLogFile: `${logFile}.stdout`,
        stderrLogFile: logFile,
      });
    } else {
      const logFd = fs.openSync(logFile, 'a');
      const child = spawn(process.execPath, [cliEntry, 'serve-http', '--port', String(port)], {
        detached: true,
        stdio: ['ignore', logFd, logFd],
        env: { ...process.env },
        cwd: startCwd,
      });
      child.unref();
      fs.closeSync(logFd);
      if (!child.pid) throw new Error('Failed to obtain background process ID');
      pid = child.pid;
    }
  } catch (err) {
    console.error(`[ERROR] Failed to start background process: ${err instanceof Error ? err.message : err}`);
    process.exitCode = 1;
    return;
  }

  // 7. Generate instance token and save state (synchronous — no yield point before output)
  const instanceToken = randomBytes(8).toString('hex');
  saveState({
    pid,
    port,
    startedAt: new Date().toISOString(),
    logFile,
    instanceToken,
    startCwd,
  });

  // 8. Print essential info immediately
  // Use stderr for the critical startup line — stderr is ALWAYS unbuffered/synchronous,
  // even when stdout is a pipe or in a non-TTY environment.
  const startMsg = [
    '',
    'Starting Memorix Control Plane in background...',
    '',
    `  PID:        ${pid}`,
    `  Port:       ${port}`,
    `  Dashboard:  http://127.0.0.1:${port}/`,
    `  MCP:        http://127.0.0.1:${port}/mcp`,
    `  Logs:       ${normalizePath(logFile)}`,
    '',
  ].join('\n');
  process.stderr.write(startMsg + '\n');

  // 9. Wait for readiness — ALWAYS, even in non-interactive mode.
  //    The /health endpoint responds immediately once the HTTP server has bound the port,
  //    so this typically completes in 1-3 seconds. Non-interactive callers (AI agents)
  //    need the server to be actually ready before they try to connect.
  //    Timeout: 30 seconds (large projects may need time to reindex before listen()).
  let healthy = false;
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 500));
    const check = await healthCheck(port, 2000);
    if (check.ok) {
      healthy = true;
      break;
    }
    // Check if process died
    if (!isProcessRunning(pid)) {
      console.error('[ERROR] Background process exited unexpectedly.');
      console.error(`  Check logs: ${normalizePath(logFile)}`);
      clearState();
      process.exitCode = 1;
      return;
    }
  }

  if (healthy) {
    process.stderr.write('[OK] Control plane is running and healthy.\n');
  } else {
    process.stderr.write('[WARN] Health check timed out — service may still be initializing.\n');
    process.stderr.write('  Check later:  memorix background status\n');
  }

  const footer = [
    '',
    '  Quick Mode       = stdio / single project / zero friction',
    '  Control Plane    = HTTP / shared MCP / multi-session / live dashboard',
    '  Background       = Control Plane running as a local service',
    '',
    '  Stop with:       memorix background stop',
  ].join('\n');
  process.stderr.write(footer + '\n');
}

export async function doStop(): Promise<void> {
  const state = loadState();

  if (!state) {
    console.log('No background control plane is registered.');
    return;
  }

  if (!isProcessRunning(state.pid)) {
    console.log(`Background process (PID ${state.pid}) is not running. Cleaning up state.`);
    clearState();
    // Also clean up readiness file
    try { fs.unlinkSync(getMemorixDir() + '/background.ready'); } catch { /* ignore */ }
    return;
  }

  // Validate that the PID is actually our Memorix process — check /health
  const health = await healthCheck(state.port, 2000);
  if (!health.ok) {
    // PID alive but port not responding — likely PID-reused or process stuck
    console.log(`[WARN] PID ${state.pid} is alive but port ${state.port} is not responding.`);
    console.log('  It may be a PID-reused unrelated process, so Memorix will not kill it.');
    clearState();
    try { fs.unlinkSync(getMemorixDir() + '/background.ready'); } catch { /* ignore */ }
    return;
  }

  // Verify PID matches — if /health returns a different PID, it's a different process
  if (health.data?.pid && health.data.pid !== state.pid) {
    console.log(`[WARN] PID mismatch: background.json has ${state.pid}, but /health reports ${health.data.pid}.`);
    console.log('  The Memorix process was likely restarted. Updating state...');
    // Don't kill — this is a valid Memorix, just with a different PID than we expected
    // (e.g., process was restarted manually)
    clearState();
    console.log('  Run "memorix background start" to register the current instance.');
    return;
  }

  console.log(`Stopping control plane (PID ${state.pid}, port ${state.port})...`);

  // Try graceful HTTP shutdown first
  let graceful = false;
  try {
    // Send SIGTERM — the serve-http handler has a graceful shutdown handler
    killProcess(state.pid);
    // Wait up to 5 seconds for process to exit
    for (let i = 0; i < 10; i++) {
      await new Promise(r => setTimeout(r, 500));
      if (!isProcessRunning(state.pid)) {
        graceful = true;
        break;
      }
    }
  } catch { /* process may already be gone */ }

  if (!graceful && isProcessRunning(state.pid)) {
    // Health previously proved this PID belongs to the registered Memorix service.
    try {
      forceTerminateProcess(state.pid);
    } catch { /* best effort */ }
  }

  clearState();
  // Clean up readiness file
  try { fs.unlinkSync(getMemorixDir() + '/background.ready'); } catch { /* ignore */ }
  console.log('[OK] Control plane stopped.');
}

async function doStatus(): Promise<void> {
  const state = loadState();

  if (!state) {
    // No background.json — but check if port has an unmanaged foreground instance
    const portHealth = await healthCheck(3211, 2000);
    if (portHealth.ok) {
      console.log('');
      console.log('No background control plane is registered,');
      console.log('but a Memorix instance IS running on port 3211 (likely a foreground "memorix serve-http").');
      console.log('');
      console.log(`  Dashboard:  http://127.0.0.1:3211/`);
      console.log(`  MCP:        http://127.0.0.1:3211/mcp`);
      if (portHealth.data) {
        const d = portHealth.data;
        console.log('');
        console.log('  Health:');
        console.log(`    PID:        ${d.pid ?? 'unknown'}`);
        console.log(`    Uptime:     ${d.uptime ?? 0}s`);
      }
      console.log('');
      console.log('  To switch to background mode:');
      console.log('    1. Stop the foreground instance (Ctrl+C in its terminal)');
      console.log('    2. Run "memorix background start"');
      console.log('');
    } else {
      console.log('No background control plane is registered.');
      console.log('');
      console.log('Start one with:  memorix background start');
    }
    return;
  }

  const running = isProcessRunning(state.pid);

  // Always do HTTP health check — this is the ground truth, not just PID existence
  const health = running ? await healthCheck(state.port) : { ok: false, error: 'Process not running' };

  // PID reuse detection: PID alive but /health fails or returns different PID
  const pidMismatch = health.ok && health.data?.pid && health.data.pid !== state.pid;
  const probablyReused = running && !health.ok;

  console.log('');
  console.log('Memorix Background Control Plane');
  console.log('================================');
  const statusLabel = health.ok && !pidMismatch
    ? '[OK] Running & Healthy'
    : pidMismatch
      ? '[WARN] PID mismatch — different Memorix instance'
      : probablyReused
        ? '[WARN] PID reused by unrelated process'
        : running
          ? '[WARN] Starting up (port not yet bound)'
          : '[ERROR] Not running';
  console.log(`  Status:     ${statusLabel}`);
  console.log(`  PID:        ${state.pid}${running ? '' : ' (dead)'}`);
  console.log(`  Port:       ${state.port}`);
  console.log(`  Started:    ${state.startedAt}`);
  if (state.instanceToken) console.log(`  Instance:   ${state.instanceToken.slice(0, 8)}…`);
  console.log(`  Dashboard:  http://127.0.0.1:${state.port}/`);
  console.log(`  MCP:        http://127.0.0.1:${state.port}/mcp`);
  console.log(`  Logs:       ${normalizePath(state.logFile)}`);

  if (health.ok && health.data) {
    const d = health.data;
    console.log('');
    console.log('  Health:');
    console.log(`    PID:        ${d.pid ?? 'unknown'}`);
    console.log(`    Uptime:     ${d.uptime ?? 0}s`);
    console.log(`    Mode:       ${d.mode ?? 'unknown'}`);
  }

  if (pidMismatch) {
    console.log('');
    console.log(`  [WARN] background.json has PID ${state.pid}, but /health reports PID ${health.data?.pid}.`);
    console.log('  The Memorix process was likely restarted. Updating state...');
    clearState();
    console.log('  Run "memorix background start" to register the current instance.');
  } else if (probablyReused) {
    console.log('');
    console.log('  [WARN] The PID in background.json belongs to a different process.');
    console.log('  Cleaning up stale state...');
    clearState();
    console.log('  Run "memorix background start" to restart.');
  } else if (!running) {
    console.log('');
    console.log('  Process has exited. Cleaning up stale state...');
    // Diagnose: check heartbeat for crash evidence
    try {
      const heartbeatPath = getMemorixDir() + '/background.heartbeat';
      const hbData = fs.readFileSync(heartbeatPath, 'utf-8');
      const hb = JSON.parse(hbData);
      const age = Date.now() - hb.heartbeatAt;
      if (age < 300_000) { // heartbeat less than 5 minutes old
        console.log(`  [WARN] Recent heartbeat found (${Math.round(age / 1000)}s ago, uptime ${hb.uptime ?? '?'}s)`);
        console.log('  The control plane likely crashed. Check the log file for errors.');
      }
    } catch { /* no heartbeat */ }
    clearState();
    console.log('  Run "memorix background start" to restart.');
  }

  console.log('');
}

async function doRestart(port: number): Promise<void> {
  console.log('Restarting control plane...');
  await doStop();
  // Brief pause to let port release
  await new Promise(r => setTimeout(r, 1000));
  // Verify port is actually free before starting
  for (let i = 0; i < 10; i++) {
    const inUse = await isPortInUse(port);
    if (!inUse) break;
    await new Promise(r => setTimeout(r, 300));
  }
  await doStart(port);
}

async function doEnsure(port: number): Promise<void> {
  // Lightweight: just check if healthy, auto-start if not.
  // Designed for use as a pre-condition by MCP clients (e.g., Windsurf).
  const state = loadState();
  if (state && isProcessRunning(state.pid)) {
    const health = await healthCheck(state.port, 2000);
    if (health.ok) {
      // Already running and healthy — silent success
      return;
    }
    // A live PID without a matching health response may have been reused by an
    // unrelated process. Clear stale state but never kill based on it alone.
    clearState();
  } else if (state) {
    // PID dead — clean up
    clearState();
  }

  // Not running — auto-start
  await doStart(port);
}

function doLogs(follow: boolean, lines: number): void {
  const logFile = getLogFilePath();

  if (!fs.existsSync(logFile)) {
    console.log('No log file found. Start the background service first:');
    console.log('  memorix background start');
    return;
  }

  if (follow) {
    // Tail -f equivalent: read existing + watch for changes
    const content = fs.readFileSync(logFile, 'utf-8');
    const existingLines = content.split('\n');
    const tail = existingLines.slice(-lines);
    console.log(tail.join('\n'));
    console.log('--- Following log (Ctrl+C to stop) ---');

    let position = fs.statSync(logFile).size;
    const watcher = fs.watch(logFile, () => {
      try {
        const stat = fs.statSync(logFile);
        if (stat.size > position) {
          const fd = fs.openSync(logFile, 'r');
          const buf = Buffer.alloc(stat.size - position);
          fs.readSync(fd, buf, 0, buf.length, position);
          fs.closeSync(fd);
          process.stdout.write(buf.toString('utf-8'));
          position = stat.size;
        }
      } catch { /* file may be rotated */ }
    });

    // Keep alive until Ctrl+C — setInterval holds the event loop open
    setInterval(() => {}, 60_000);
  } else {
    // Just show last N lines
    const content = fs.readFileSync(logFile, 'utf-8');
    const allLines = content.split('\n');
    const tail = allLines.slice(-lines);
    console.log(tail.join('\n'));
  }
}

// ============================================================
// Command definition
// ============================================================

export default defineCommand({
  meta: {
    name: 'background',
    description: 'Manage the Memorix Control Plane as a background service',
  },
  args: {
    port: {
      type: 'string',
      description: 'HTTP port (default: 3211)',
      required: false,
    },
    follow: {
      type: 'boolean',
      alias: 'f',
      description: 'Follow log output (for "logs" subcommand)',
      required: false,
    },
    lines: {
      type: 'string',
      alias: 'n',
      description: 'Number of log lines to show (default: 50)',
      required: false,
    },
  },
  run: async ({ args }) => {
    try {
      const subcommand = (args._ as string[])?.[0] || '';
      const port = parseBackgroundPort(args.port);

      switch (subcommand) {
        case 'start':
          await doStart(port);
          break;
        case 'stop':
          await doStop();
          break;
        case 'status':
          await doStatus();
          break;
        case 'restart':
          await doRestart(port);
          break;
        case 'ensure':
          // Health check + auto-start if not running.
          // Useful as a pre-condition for MCP clients that need the control plane.
          // Returns exit code 0 if control plane is running (or was just started).
          await doEnsure(port);
          break;
        case 'logs':
          doLogs(!!args.follow, parseLogLines(args.lines));
          break;
        default:
          console.log('Memorix Background Control Plane');
          console.log('');
          console.log('Usage:');
          console.log('  memorix background start     Start control plane in background');
          console.log('  memorix background stop      Stop the background control plane');
          console.log('  memorix background status    Show running state and health');
          console.log('  memorix background restart   Stop + start');
          console.log('  memorix background ensure    Ensure control plane is running (auto-start if not)');
          console.log('  memorix background logs      Show recent log output');
          console.log('');
          console.log('Options:');
          console.log('  --port <port>   HTTP port (default: 3211)');
          console.log('  --follow, -f    Follow log output in real-time (for "logs")');
          console.log('  --lines, -n     Number of log lines to show (default: 50)');
          console.log('');
          console.log('Mode distinction:');
          console.log('  Quick Mode       = stdio / single project / zero friction');
          console.log('  Control Plane    = HTTP / shared MCP / multi-session / live dashboard');
          console.log('  Background       = Control Plane running as a local service');
          break;
      }
    } catch (err) {
      // Ensure errors are never silently swallowed by citty
      process.stderr.write(formatBackgroundCommandError(err));
      process.exitCode = 1;
    }
  },
});

/** @internal Test-only helpers for Windows launcher construction. */
export const _testing = {
  buildWindowsBackgroundStartScript,
  quoteWindowsCommandArgument,
  parseBackgroundPort,
  parseLogLines,
  formatBackgroundCommandError,
  resolveBackgroundCliEntry,
  resolveBackgroundCliEntryFrom,
  resolveBackgroundCwd,
};
