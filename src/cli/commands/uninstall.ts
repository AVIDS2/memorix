/**
 * CLI Command: memorix uninstall
 *
 * Safe, user-friendly uninstall flow.
 *
 * Usage:
 *   memorix uninstall                 — Safe default (interactive)
 *   memorix uninstall --dry-run       — Preview what would happen
 *   memorix uninstall --yes           — Skip prompts
 *   memorix uninstall --hooks         — Remove agent hooks
 *   memorix uninstall --background    — Stop background control plane
 *   memorix uninstall --purge-data    — Delete ~/.memorix data directory
 *
 * Non-goals:
 *   - Does NOT run npm uninstall — user must do that manually
 *   - Does NOT silently mutate MCP config files
 *   - Does NOT delete ~/.memorix unless --purge-data is passed
 */

import { defineCommand } from 'citty';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// ── MCP config paths (documented, not modified) ────────────────────

interface MCPConfigEntry {
  agent: string;
  path: string;
  kind: 'project' | 'global';
  format: 'json' | 'toml';
  detected: boolean;
  /** Human-readable note for users to edit manually */
  note: string;
}

function exists(p: string): boolean {
  try { fs.accessSync(p); return true; } catch { return false; }
}

function checkJSON(p: string): boolean {
  if (!exists(p)) return false;
  try {
    const content = fs.readFileSync(p, 'utf-8');
    const cfg = JSON.parse(content);
    const servers = cfg.mcpServers ?? cfg.mcp_servers ?? cfg.servers ?? {};
    return Object.keys(servers).some((k) => k.toLowerCase().includes('memorix'));
  } catch { return false; }
}

function checkTOML(p: string): boolean {
  if (!exists(p)) return false;
  try {
    const content = fs.readFileSync(p, 'utf-8');
    return /\[mcp_servers\.(?:memorix|Memorix)\]/.test(content);
  } catch { return false; }
}

/** Detects memorix MCP config entries in both global and project-level paths. */
function getMCPConfigEntries(home: string, cwd: string): MCPConfigEntry[] {
  const entries: MCPConfigEntry[] = [];

  // ── Global paths ──

  entries.push({
    agent: 'Claude Code',
    path: path.join(home, '.claude.json'),
    kind: 'global',
    format: 'json',
    detected: checkJSON(path.join(home, '.claude.json')),
    note: 'Remove the "memorix" key from mcpServers in this file.',
  });

  // Claude Code — project level
  entries.push({
    agent: 'Claude Code',
    path: path.join(cwd, '.claude', 'settings.json'),
    kind: 'project',
    format: 'json',
    detected: checkJSON(path.join(cwd, '.claude', 'settings.json')),
    note: 'Remove the "memorix" key from mcpServers in this file.',
  });

  // Cursor — global
  entries.push({
    agent: 'Cursor',
    path: path.join(home, '.cursor', 'mcp.json'),
    kind: 'global',
    format: 'json',
    detected: checkJSON(path.join(home, '.cursor', 'mcp.json')),
    note: 'Remove the "memorix" key from mcpServers in this file.',
  });

  // Cursor — project level
  entries.push({
    agent: 'Cursor',
    path: path.join(cwd, '.cursor', 'mcp.json'),
    kind: 'project',
    format: 'json',
    detected: checkJSON(path.join(cwd, '.cursor', 'mcp.json')),
    note: 'Remove the "memorix" key from mcpServers in this file.',
  });

  // Windsurf
  entries.push({
    agent: 'Windsurf',
    path: path.join(home, '.codeium', 'windsurf', 'mcp_config.json'),
    kind: 'global',
    format: 'json',
    detected: checkJSON(path.join(home, '.codeium', 'windsurf', 'mcp_config.json')),
    note: 'Remove the "memorix" key from mcpServers in this file.',
  });

  // Codex
  entries.push({
    agent: 'Codex',
    path: path.join(home, '.codex', 'config.toml'),
    kind: 'global',
    format: 'toml',
    detected: checkTOML(path.join(home, '.codex', 'config.toml')),
    note: 'Remove the [mcp_servers.memorix] section from this file.',
  });

  // VS Code / Copilot — global (user settings)
  entries.push({
    agent: 'VS Code / Copilot',
    path: path.join(home, '.vscode', 'mcp.json'),
    kind: 'global',
    format: 'json',
    detected: checkJSON(path.join(home, '.vscode', 'mcp.json')),
    note: 'Remove the "memorix" key from servers in this file.',
  });

  // VS Code / Copilot — project level (.vscode/mcp.json)
  entries.push({
    agent: 'VS Code / Copilot',
    path: path.join(cwd, '.vscode', 'mcp.json'),
    kind: 'project',
    format: 'json',
    detected: checkJSON(path.join(cwd, '.vscode', 'mcp.json')),
    note: 'Remove the "memorix" key from servers in this file.',
  });

  // Kiro — global
  entries.push({
    agent: 'Kiro',
    path: path.join(home, '.kiro', 'settings', 'mcp.json'),
    kind: 'global',
    format: 'json',
    detected: checkJSON(path.join(home, '.kiro', 'settings', 'mcp.json')),
    note: 'Remove the "memorix" key from mcpServers in this file.',
  });

  // Kiro — project level
  entries.push({
    agent: 'Kiro',
    path: path.join(cwd, '.kiro', 'settings', 'mcp.json'),
    kind: 'project',
    format: 'json',
    detected: checkJSON(path.join(cwd, '.kiro', 'settings', 'mcp.json')),
    note: 'Remove the "memorix" key from mcpServers in this file.',
  });

  // Gemini CLI / Antigravity
  entries.push({
    agent: 'Gemini CLI / Antigravity',
    path: path.join(home, '.gemini', 'settings.json'),
    kind: 'global',
    format: 'json',
    detected: checkJSON(path.join(home, '.gemini', 'settings.json')),
    note: 'Remove the "memorix" key from mcpServers in this file.',
  });

  // Trae
  const traeCfg = (() => {
    if (process.platform === 'win32') {
      return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Trae', 'User', 'mcp.json');
    }
    if (process.platform === 'darwin') {
      return path.join(home, 'Library', 'Application Support', 'Trae', 'User', 'mcp.json');
    }
    return path.join(home, '.config', 'Trae', 'User', 'mcp.json');
  })();
  entries.push({
    agent: 'Trae',
    path: traeCfg,
    kind: 'global',
    format: 'json',
    detected: checkJSON(traeCfg),
    note: 'Remove the "memorix" key from mcpServers in this file.',
  });

  return entries;
}

// ── Background state check (reporting only — actual stop uses doStop) ──

interface BackgroundStatus {
  running: boolean;
  pid?: number;
  port?: number;
}

function checkBackground(home: string): BackgroundStatus {
  const statePath = path.join(home, '.memorix', 'background.json');
  try {
    const data = fs.readFileSync(statePath, 'utf-8');
    const state = JSON.parse(data);
    try {
      process.kill(state.pid, 0);
      return { running: true, pid: state.pid, port: state.port };
    } catch {
      return { running: false };
    }
  } catch {
    return { running: false };
  }
}

// ── Hooks detection — scans both project AND global layers ─────────

async function detectHooks(cwd: string): Promise<
  Array<{ agent: string; configPath: string; global: boolean; exists: boolean }>
> {
  const { detectInstalledAgents, getProjectConfigPath, getGlobalConfigPath } =
    await import('../../hooks/installers/index.js');

  const agents = await detectInstalledAgents();
  const results: Array<{ agent: string; configPath: string; global: boolean; exists: boolean }> = [];

  for (const agent of agents) {
    // Check project-level path
    const projectPath = getProjectConfigPath(agent, cwd);
    const projectExists = exists(projectPath);
    if (projectExists) {
      results.push({ agent, configPath: projectPath, global: false, exists: true });
    }

    // Check global-level path (always, not just if project missing)
    const globalPath = getGlobalConfigPath(agent);
    if (globalPath) {
      const globalExists = exists(globalPath);
      // Only add if different from project path (avoid duplicate)
      if (globalPath !== projectPath) {
        results.push({ agent, configPath: globalPath, global: true, exists: globalExists });
      }
    }
  }

  return results;
}

// ── Dry-run report ─────────────────────────────────────────────────

async function printDryRun(opts: {
  hooks: boolean;
  background: boolean;
  purgeData: boolean;
  mcpEntries: MCPConfigEntry[];
  bgStatus: BackgroundStatus;
  hookResults: Array<{ agent: string; configPath: string; global: boolean; exists: boolean }>;
  memorixDir: string;
}) {
  console.log('');
  console.log('═══ Dry Run: what memorix uninstall would do ═══');
  console.log('');

  // 1. Background
  console.log('1. Background Control Plane');
  if (opts.bgStatus.running) {
    console.log(`   [STOP] Background service (PID ${opts.bgStatus.pid}, port ${opts.bgStatus.port})`);
  } else {
    console.log('   [SKIP] No background service running');
  }

  // 2. Hooks
  console.log('');
  console.log('2. Agent Hooks');
  if (opts.hooks && opts.hookResults.length > 0) {
    const existing = opts.hookResults.filter((h) => h.exists);
    if (existing.length > 0) {
      for (const h of existing) {
        console.log(`   [REMOVE] ${h.agent} hooks: ${h.configPath} (${h.global ? 'global' : 'project'})`);
      }
    } else {
      console.log('   [SKIP] No hook files found');
    }
  } else {
    console.log('   [SKIP] Use --hooks to remove agent hooks');
  }

  // 3. MCP config entries
  console.log('');
  console.log('3. MCP Config Entries (manual cleanup required)');
  const detected = opts.mcpEntries.filter((e) => e.detected);
  if (detected.length > 0) {
    for (const e of detected) {
      console.log(`   [DETECTED] ${e.agent} (${e.kind}): ${e.path}`);
      console.log(`     → ${e.note}`);
    }
  } else {
    console.log('   [OK] No memorix MCP entries detected');
  }

  // 4. Data directory
  console.log('');
  console.log('4. Data Directory');
  const memorixExists = exists(opts.memorixDir);
  if (opts.purgeData) {
    if (memorixExists) {
      console.log(`   [DELETE] ${opts.memorixDir}`);
    } else {
      console.log('   [SKIP] Data directory does not exist');
    }
  } else {
    console.log(`   [PRESERVE] ${opts.memorixDir} (use --purge-data to delete)`);
  }

  console.log('');
  console.log('5. Package Uninstall (manual step)');
  console.log('   Run: npm uninstall -g memorix');
  console.log('');
}

// ── Confirmation helper — fails immediately if stdin is not a TTY ──

async function confirm(description: string): Promise<boolean> {
  if (!process.stdin.isTTY) {
    console.log('[ERROR] Non-interactive environment. Add --yes to confirm, or --dry-run to preview.');
    console.log(`[ERROR] Refusing to ${description} without confirmation.`);
    process.exitCode = 1;
    return false;
  }
  const readline = await import('node:readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>((resolve) => {
    rl.question(`Proceed to ${description}? (y/N) `, resolve);
  });
  rl.close();
  return answer.trim().toLowerCase() === 'y';
}

// ── Main command ───────────────────────────────────────────────────

export default defineCommand({
  meta: {
    name: 'uninstall',
    description: 'Safe uninstall flow — stop background, remove hooks, guide MCP cleanup',
  },
  args: {
    'dry-run': {
      type: 'boolean',
      description: 'Preview what would happen without changing files/processes',
      default: false,
    },
    yes: {
      type: 'boolean',
      description: 'Skip all confirmation prompts',
      default: false,
    },
    hooks: {
      type: 'boolean',
      description: 'Remove agent hook configurations',
      default: false,
    },
    background: {
      type: 'boolean',
      description: 'Stop background control plane',
      default: false,
    },
    'purge-data': {
      type: 'boolean',
      description: 'Delete ~/.memorix data directory (memories, mini-skills, sessions, logs, local config)',
      default: false,
    },
  },
  async run({ args }) {
    const home = os.homedir();
    const memorixDir = path.join(home, '.memorix');
    const dryRun = args['dry-run'] as boolean;
    const yes = args.yes as boolean;
    const doHooks = args.hooks as boolean;
    const doBackground = args.background as boolean;
    const doPurge = args['purge-data'] as boolean;

    let cwd: string;
    try { cwd = process.cwd(); } catch { cwd = home; }

    // If no flags at all, show safe interactive flow
    const noFlags = !doHooks && !doBackground && !doPurge && !dryRun;

    // Gather state
    const bgStatus = checkBackground(home);
    const mcpEntries = getMCPConfigEntries(home, cwd);
    const hookResults = await detectHooks(cwd);

    // ── Default (no flags): interactive safe flow ──
    if (noFlags) {
      console.log('');
      console.log('═══ Memorix Uninstall ═══');
      console.log('');
      console.log('This command helps you safely remove Memorix integration from your system.');
      console.log('It does NOT run npm uninstall — that must be done separately.');
      console.log('');
      console.log('What would you like to do?');
      console.log('');

      // Show current state
      if (bgStatus.running) {
        console.log(`  Background:  running on port ${bgStatus.port} (PID ${bgStatus.pid})`);
      } else {
        console.log('  Background:  not running');
      }

      const existingHooks = hookResults.filter((h) => h.exists);
      if (existingHooks.length > 0) {
        console.log(`  Hooks:       ${existingHooks.length} agent(s) with hook files`);
      } else {
        console.log('  Hooks:       none detected');
      }

      const detectedMcp = mcpEntries.filter((e) => e.detected);
      if (detectedMcp.length > 0) {
        console.log(`  MCP config:  ${detectedMcp.length} file(s) with memorix entries`);
      } else {
        console.log('  MCP config:  no memorix entries detected');
      }

      console.log(`  Data dir:    ${memorixDir}`);
      console.log('');

      // Suggest flags
      console.log('Suggested flags for guided uninstall:');
      console.log('');
      console.log('  memorix uninstall --dry-run            Preview everything');
      console.log('  memorix uninstall --background --hooks  Stop service + remove hooks');
      console.log('  memorix uninstall --purge-data          Also delete ~/.memorix');
      console.log('  memorix uninstall --yes --background --hooks --purge-data   Full cleanup');
      console.log('');
      console.log('After integration cleanup, run: npm uninstall -g memorix');
      console.log('');
      return;
    }

    // ── Dry run ──
    if (dryRun) {
      await printDryRun({
        hooks: doHooks,
        background: doBackground,
        purgeData: doPurge,
        mcpEntries,
        bgStatus,
        hookResults,
        memorixDir,
      });

      // Show MCP config instructions regardless
      const detected = mcpEntries.filter((e) => e.detected);
      if (detected.length > 0) {
        console.log('═══ MCP Config Cleanup Guide ═══');
        console.log('');
        console.log('Memorix does NOT modify your MCP config files.');
        console.log('To fully disconnect Memorix, manually edit these files:');
        console.log('');
        for (const e of detected) {
          console.log(`  ${e.agent} (${e.kind}): ${e.path}`);
          console.log(`  → ${e.note}`);
        }
        console.log('');
      }

      return;
    }

    // ── Confirm if not --yes ──
    if (!yes) {
      const actions: string[] = [];
      if (doBackground && bgStatus.running) actions.push('stop background service');
      if (doHooks) actions.push('remove agent hooks');
      if (doPurge) actions.push(`delete ${memorixDir}`);

      if (actions.length > 0) {
        const ok = await confirm(actions.join(', '));
        if (!ok) {
          console.log('Cancelled.');
          return;
        }
      }
    }

    let changes = 0;

    // ── 1. Stop background — reuses background.ts doStop ──
    if (doBackground) {
      // doStop handles all edge cases: health check, PID mismatch, graceful
      // shutdown (SIGTERM → 5s wait → Windows force kill), state/ready cleanup.
      // It outputs its own messages. Errors are non-fatal to uninstall flow.
      try {
        const { doStop } = await import('./background.js');
        await doStop();
        changes++;
      } catch (err) {
        console.log(`[WARN] Background stop failed: ${err instanceof Error ? err.message : err}`);
      }
    }

    // ── 2. Remove hooks — both project AND global per agent ──
    if (doHooks) {
      const existing = hookResults.filter((h) => h.exists);
      if (existing.length > 0) {
        const { uninstallHooks } = await import('../../hooks/installers/index.js');

        for (const h of existing) {
          const ok = await uninstallHooks(
            h.agent as import('../../hooks/types.js').AgentName,
            cwd,
            h.global,
          );
          if (ok) {
            console.log(`[OK] ${h.agent}: hooks removed from ${h.configPath} (${h.global ? 'global' : 'project'})`);
            changes++;
          } else {
            console.log(`[SKIP] ${h.agent}: could not remove hooks from ${h.configPath}`);
          }
        }
      } else {
        console.log('[SKIP] No hook files found.');
      }
    }

    // ── 3. Purge data ──
    if (doPurge) {
      if (exists(memorixDir)) {
        console.log(`[DELETE] Removing ${memorixDir}...`);
        try {
          fs.rmSync(memorixDir, { recursive: true, force: true });
          console.log('[OK] Data directory deleted.');
          changes++;
        } catch (err) {
          console.log(`[ERROR] Could not delete data directory: ${err instanceof Error ? err.message : err}`);
        }
      } else {
        console.log('[SKIP] Data directory does not exist.');
      }
    }

    // ── 4. MCP config report (always shown) ──
    console.log('');
    const detected = mcpEntries.filter((e) => e.detected);
    if (detected.length > 0) {
      console.log('═══ MCP Config — Manual Cleanup Required ═══');
      console.log('');
      console.log('Memorix does NOT modify MCP config files.');
      console.log('To fully disconnect, manually edit these files:');
      console.log('');
      for (const e of detected) {
        console.log(`  ${e.agent} (${e.kind}): ${e.path}`);
        console.log(`  → ${e.note}`);
        console.log('');
      }
    }

    // ── Final reminder ──
    console.log('---');
    console.log('');
    if (changes > 0) {
      console.log(`[DONE] ${changes} cleanup action(s) completed.`);
    } else {
      console.log('[DONE] Nothing changed.');
    }
    console.log('');
    console.log('To complete uninstall, run: npm uninstall -g memorix');
    console.log('');
  },
});
