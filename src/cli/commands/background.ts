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
 *   Control Plane    = HTTP / multi-project / dashboard / team
 *   Background       = Control Plane's productized run mode (no terminal babysitting)
 */

import { defineCommand } from 'citty';
import * as fs from 'node:fs';
import { spawn, execSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

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

async function healthCheck(port: number, timeoutMs = 3000): Promise<{ ok: boolean; data?: any; error?: string }> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(`http://127.0.0.1:${port}/api/team`, {
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

async function doStart(port: number): Promise<void> {
  // 1. Check if already running
  const state = loadState();
  if (state && isProcessRunning(state.pid)) {
    const health = await healthCheck(state.port);
    if (health.ok) {
      console.log(`✓ Control plane is already running (PID ${state.pid}, port ${state.port})`);
      console.log(`  Dashboard:  http://127.0.0.1:${state.port}/`);
      console.log(`  MCP:        http://127.0.0.1:${state.port}/mcp`);
      return;
    }
    // Process exists but HTTP not responding — stale, clean up
    console.log(`⚠ Stale process ${state.pid} detected, cleaning up...`);
    killProcess(state.pid);
    clearState();
  }

  // 2. Check if port is already taken by another process
  if (await isPortInUse(port)) {
    // Port is occupied but no background.json — this is an unmanaged foreground process
    console.log('');
    console.log(`⚠ Port ${port} is already serving a Memorix control plane, but it is NOT managed by background mode.`);
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

  // 3. Prepare log file
  const logFile = getLogFilePath();
  const dir = getMemorixDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  // Rotate log: keep last run's log as .log.prev
  if (fs.existsSync(logFile)) {
    try { fs.renameSync(logFile, logFile + '.prev'); } catch { /* ok */ }
  }

  const logFd = fs.openSync(logFile, 'a');

  // 4. Find the memorix CLI entry point
  // We need to spawn `node <cli-entry> serve-http --port <port>`
  // The entry point is the same binary that's running now
  const cliEntry = process.argv[1]; // e.g., dist/cli/index.js or node_modules/.bin/memorix

  // 5. Spawn detached process
  const child = spawn(process.execPath, [cliEntry, 'serve-http', '--port', String(port)], {
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: { ...process.env },
    cwd: process.cwd(),
    windowsHide: true,
  });

  child.unref();
  fs.closeSync(logFd);

  const pid = child.pid;
  if (!pid) {
    console.error('✗ Failed to spawn background process');
    process.exitCode = 1;
    return;
  }

  // 6. Generate instance token and save state (synchronous — no yield point before output)
  const instanceToken = randomBytes(8).toString('hex');
  saveState({
    pid,
    port,
    startedAt: new Date().toISOString(),
    logFile,
    instanceToken,
    startCwd: process.cwd(),
  });

  // 7. Print essential info immediately
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

  // 8. Wait for health check (up to 30 seconds — large projects may need time to reindex)
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
      console.error('✗ Background process exited unexpectedly.');
      console.error(`  Check logs: ${normalizePath(logFile)}`);
      clearState();
      process.exitCode = 1;
      return;
    }
  }

  if (healthy) {
    process.stderr.write('✓ Control plane is running and healthy.\n');
  } else {
    process.stderr.write('⚠ Health check timed out — service may still be initializing.\n');
    process.stderr.write('  Check later:  memorix background status\n');
  }

  const footer = [
    '',
    '  Quick Mode       = stdio / single project / zero friction',
    '  Control Plane    = HTTP / multi-project / dashboard / team',
    '  Background       = Control Plane running as a local service',
    '',
    '  Stop with:       memorix background stop',
  ].join('\n');
  process.stderr.write(footer + '\n');
}

async function doStop(): Promise<void> {
  const state = loadState();

  if (!state) {
    console.log('No background control plane is registered.');
    return;
  }

  if (!isProcessRunning(state.pid)) {
    console.log(`Background process (PID ${state.pid}) is not running. Cleaning up state.`);
    clearState();
    return;
  }

  // Validate instance token — if the PID was reused by an unrelated process,
  // the health check will fail or return unexpected data. This prevents misidentifying
  // a random process as our background service.
  if (state.instanceToken) {
    const health = await healthCheck(state.port, 2000);
    if (!health.ok) {
      console.log(`⚠ PID ${state.pid} is alive but port ${state.port} is not responding.`);
      console.log('  This may be a PID-reused unrelated process. Cleaning up stale state.');
      clearState();
      return;
    }
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
    // Force kill on Windows
    try {
      if (process.platform === 'win32') {
        execSync(`taskkill /F /PID ${state.pid}`, { stdio: 'ignore' });
      } else {
        process.kill(state.pid, 'SIGKILL');
      }
    } catch { /* best effort */ }
  }

  clearState();
  console.log('✓ Control plane stopped.');
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
        console.log(`    Agents:     ${d.agents?.length ?? 0}`);
        console.log(`    Sessions:   ${d.sessions ?? 0}`);
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

  // PID reuse guard: if PID is alive but health check fails, it's likely a different process
  const health = running ? await healthCheck(state.port) : { ok: false, error: 'Process not running' };
  const probablyReused = running && !health.ok && state.instanceToken;

  console.log('');
  console.log('Memorix Background Control Plane');
  console.log('================================');
  const statusLabel = health.ok
    ? '✓ Running & Healthy'
    : probablyReused
      ? '⚠ PID reused by unrelated process'
      : running
        ? '⚠ Running but unhealthy'
        : '✗ Not running';
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
    console.log(`    Agents:     ${d.agents?.length ?? 0}`);
    console.log(`    Sessions:   ${d.sessions ?? 0}`);
    if (d.uptime) console.log(`    Uptime:     ${d.uptime}`);
  }

  if (probablyReused) {
    console.log('');
    console.log('  ⚠ The PID in background.json belongs to a different process.');
    console.log('  Cleaning up stale state...');
    clearState();
    console.log('  Run "memorix background start" to restart.');
  } else if (!running) {
    console.log('');
    console.log('  Process has exited. Cleaning up stale state...');
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
      const port = parseInt(args.port || '3211', 10);

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
        case 'logs':
          doLogs(!!args.follow, parseInt(args.lines || '50', 10));
          break;
        default:
          console.log('Memorix Background Control Plane');
          console.log('');
          console.log('Usage:');
          console.log('  memorix background start     Start control plane in background');
          console.log('  memorix background stop      Stop the background control plane');
          console.log('  memorix background status    Show running state and health');
          console.log('  memorix background restart   Stop + start');
          console.log('  memorix background logs      Show recent log output');
          console.log('');
          console.log('Options:');
          console.log('  --port <port>   HTTP port (default: 3211)');
          console.log('  --follow, -f    Follow log output in real-time (for "logs")');
          console.log('  --lines, -n     Number of log lines to show (default: 50)');
          console.log('');
          console.log('Mode distinction:');
          console.log('  Quick Mode       = stdio / single project / zero friction');
          console.log('  Control Plane    = HTTP / multi-project / dashboard / team');
          console.log('  Background       = Control Plane running as a local service');
          break;
      }
    } catch (err) {
      // Ensure errors are never silently swallowed by citty
      process.stderr.write(`[memorix background] Error: ${err instanceof Error ? err.message : err}\n`);
      if (err instanceof Error && err.stack) {
        process.stderr.write(err.stack + '\n');
      }
      process.exitCode = 1;
    }
  },
});
