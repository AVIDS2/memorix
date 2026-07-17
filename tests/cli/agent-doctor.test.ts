import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import doctorCommand from '../../src/cli/commands/doctor.js';
import repairCommand from '../../src/cli/commands/repair.js';
import { getCliVersion } from '../../src/cli/version.js';

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, spawnSync: vi.fn() };
});

async function runCommand(command: any, args: Record<string, unknown>) {
  const logs: string[] = [];
  const errors: string[] = [];
  const logSpy = vi.spyOn(console, 'log').mockImplementation((...parts) => logs.push(parts.map(String).join(' ')));
  const errSpy = vi.spyOn(console, 'error').mockImplementation((...parts) => errors.push(parts.map(String).join(' ')));
  const originalExitCode = process.exitCode;
  process.exitCode = undefined;

  try {
    await command.run?.({ args, rawArgs: [], cmd: command } as any);
    return {
      stdout: logs.join('\n'),
      stderr: errors.join('\n'),
      exitCode: process.exitCode ?? 0,
    };
  } finally {
    process.exitCode = originalExitCode;
    logSpy.mockRestore();
    errSpy.mockRestore();
  }
}

describe('agent doctor and repair', () => {
  const originalCwd = process.cwd();
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;
  let sandboxRoot = '';
  let repoDir = '';

  beforeEach(() => {
    sandboxRoot = mkdtempSync(path.join(tmpdir(), 'memorix-agent-doctor-'));
    repoDir = path.join(sandboxRoot, 'repo');
    process.env.HOME = sandboxRoot;
    process.env.USERPROFILE = sandboxRoot;
    mkdirSync(path.join(repoDir, '.claude'), { recursive: true });
    execSync('git init', { cwd: repoDir, stdio: 'ignore' });
    process.chdir(repoDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    if (originalUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = originalUserProfile;
    rmSync(sandboxRoot, { recursive: true, force: true });
    vi.mocked(spawnSync).mockReset();
  });

  function writeStaleClaudeSetup() {
    writeFileSync(path.join(repoDir, 'CLAUDE.md'), [
      '# Memorix - Agent Instructions for Claude Code',
      '',
      'Use `memorix_search` when prior project context would help.',
      '',
      '## Dev Log',
      '',
      '- progress.txt: Current development state - read this first in every new session',
      '',
    ].join('\n'), 'utf-8');

    writeFileSync(path.join(repoDir, '.claude', 'settings.json'), JSON.stringify({
      mcpServers: {
        memorix: {
          command: 'node',
          args: [
            'E:\\old\\memorix\\.worktrees\\1.1.6-release-hardening\\dist\\cli\\index.js',
            'serve',
            '--mode',
            'micro',
          ],
        },
      },
    }, null, 2), 'utf-8');
  }

  function writeStaleClaudeLocalMcpSetup() {
    writeFileSync(path.join(sandboxRoot, '.claude.json'), JSON.stringify({
      projects: {
        [repoDir.replace(/\\/g, '/')]: {
          mcpServers: {
            memorix: {
              type: 'stdio',
              command: 'node',
              args: [
                path.join(repoDir, '.worktrees', '1.1.6-release-hardening', 'dist', 'cli', 'index.js'),
                'serve',
                '--mode',
                'micro',
              ],
            },
          },
        },
      },
    }, null, 2), 'utf-8');
  }

  function writeCurrentClaudeGuidance() {
    writeFileSync(path.join(repoDir, 'CLAUDE.md'), [
      '# Memorix - Agent Instructions for Claude Code',
      '',
      '## Memory Autopilot',
      '',
      '- Default first step for non-trivial coding work: call `memorix_project_context` with the user task.',
      '',
    ].join('\n'), 'utf-8');
  }

  function writeOutdatedGlobalClaudeGuidance() {
    mkdirSync(path.join(sandboxRoot, '.claude'), { recursive: true });
    writeFileSync(path.join(sandboxRoot, '.claude', 'CLAUDE.md'), [
      '# Old Claude instructions',
      '',
      '- read progress.txt first in every new session',
      '',
    ].join('\n'), 'utf-8');
  }

  function writeCurrentClaudeLocalMcpSetup() {
    writeFileSync(path.join(sandboxRoot, '.claude.json'), JSON.stringify({
      projects: {
        [repoDir.replace(/\\/g, '/')]: {
          mcpServers: {
            memorix: {
              type: 'stdio',
              command: 'memorix',
              args: ['serve'],
              alwaysLoad: true,
            },
          },
        },
      },
    }, null, 2), 'utf-8');
  }

  function writeCurrentCodexPluginSetup() {
    const pluginPath = path.join(sandboxRoot, '.codex', 'plugins', 'memorix');
    mkdirSync(path.join(pluginPath, '.codex-plugin'), { recursive: true });
    mkdirSync(path.join(pluginPath, 'hooks'), { recursive: true });
    mkdirSync(path.join(sandboxRoot, '.agents', 'plugins'), { recursive: true });

    writeFileSync(path.join(pluginPath, '.codex-plugin', 'plugin.json'), JSON.stringify({
      name: 'memorix',
      version: getCliVersion(),
      hooks: './hooks/hooks.json',
    }, null, 2), 'utf-8');
    writeFileSync(path.join(pluginPath, 'hooks', 'hooks.json'), JSON.stringify({
      hooks: {
        SessionStart: [],
        UserPromptSubmit: [],
        PostToolUse: [],
        PreCompact: [],
        Stop: [],
      },
    }, null, 2), 'utf-8');
    writeFileSync(path.join(sandboxRoot, '.codex', 'config.toml'), [
      '[hooks.state."memorix@personal:hooks/hooks.json:session_start:0:0"]',
      'trusted_hash = "sha256:test"',
      '[hooks.state."memorix@personal:hooks/hooks.json:user_prompt_submit:0:0"]',
      'trusted_hash = "sha256:test"',
      '[hooks.state."memorix@personal:hooks/hooks.json:post_tool_use:0:0"]',
      'trusted_hash = "sha256:test"',
      '[hooks.state."memorix@personal:hooks/hooks.json:pre_compact:0:0"]',
      'trusted_hash = "sha256:test"',
      '[hooks.state."memorix@personal:hooks/hooks.json:stop:0:0"]',
      'trusted_hash = "sha256:test"',
    ].join('\n'), 'utf-8');
    writeFileSync(path.join(sandboxRoot, '.agents', 'plugins', 'marketplace.json'), JSON.stringify({
      name: 'personal',
      plugins: [{
        name: 'memorix',
        source: { source: 'local', path: './.codex/plugins/memorix' },
      }],
    }, null, 2), 'utf-8');
  }

  function mockCodexPluginList(enabled = true) {
    vi.mocked(spawnSync).mockReturnValue({
      status: 0,
      stdout: JSON.stringify({
        installed: [{
          pluginId: 'memorix@personal',
          name: 'memorix',
          marketplaceName: 'personal',
          version: getCliVersion(),
          installed: true,
          enabled,
        }],
        available: [],
      }),
      stderr: '',
      output: [],
      pid: 0,
      signal: null,
    } as ReturnType<typeof spawnSync>);
  }

  it('doctor agents detects stale MCP paths and outdated Claude guidance', async () => {
    writeStaleClaudeSetup();

    const result = await runCommand(doctorCommand, {
      _: ['agents'],
      agent: 'claude',
      scope: 'project',
      json: true,
    });

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    const claude = parsed.agents.entries.find((entry: any) => entry.agent === 'claude');

    expect(claude.mcp.status).toBe('repairable');
    expect(claude.mcp.issues).toContain('stale-command-path');
    expect(claude.mcp.issues).toContain('claude-always-load-missing');
    expect(claude.guidance.status).toBe('repairable');
    expect(claude.guidance.issues).toContain('guidance-outdated');
    expect(parsed.agents.repairCommand).toContain('memorix repair agents --agent claude');
  });

  it('repair agents upgrades owned guidance and rewrites the Memorix MCP entry', async () => {
    writeStaleClaudeSetup();

    const result = await runCommand(repairCommand, {
      _: ['agents'],
      agent: 'claude',
      scope: 'project',
      json: true,
    });

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.repair.changed).toContain('claude:mcp:project');
    expect(parsed.repair.changed).toContain('claude:guidance:project');

    const settings = JSON.parse(readFileSync(path.join(repoDir, '.claude', 'settings.json'), 'utf-8'));
    expect(settings.mcpServers.memorix).toMatchObject({
      command: 'memorix',
      args: ['serve'],
      alwaysLoad: true,
    });

    const guidance = readFileSync(path.join(repoDir, 'CLAUDE.md'), 'utf-8');
    expect(guidance).toContain('Default first step for non-trivial coding work');
    expect(guidance).toContain('memorix_project_context');
    expect(guidance).not.toContain('read this first in every new session');
  });

  it('doctor agents detects stale Claude local MCP config', async () => {
    writeStaleClaudeLocalMcpSetup();

    const result = await runCommand(doctorCommand, {
      _: ['agents'],
      agent: 'claude',
      scope: 'local',
      json: true,
    });

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    const claude = parsed.agents.entries.find((entry: any) => entry.agent === 'claude');

    expect(claude.mcp.status).toBe('repairable');
    expect(claude.mcp.issues).toContain('stale-command-path');
    expect(claude.mcp.issues).toContain('nonstandard-mcp-command');
    expect(claude.mcp.issues).toContain('claude-always-load-missing');
    expect(claude.mcp.checks[0].scope).toBe('local');
  });

  it('doctor agents treats one healthy scope as enough in all-scope mode', async () => {
    writeCurrentClaudeGuidance();
    writeCurrentClaudeLocalMcpSetup();
    writeOutdatedGlobalClaudeGuidance();

    const result = await runCommand(doctorCommand, {
      _: ['agents'],
      agent: 'claude',
      scope: 'all',
      json: true,
    });

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    const claude = parsed.agents.entries.find((entry: any) => entry.agent === 'claude');

    expect(claude.mcp.status).toBe('ok');
    expect(claude.mcp.issues).toEqual([]);
    expect(claude.guidance.status).toBe('ok');
    expect(claude.guidance.issues).toEqual([]);
    expect(parsed.agents.summary.ok).toBe(1);
  });

  it('repair agents rewrites Claude local MCP config to memorix serve', async () => {
    writeStaleClaudeLocalMcpSetup();

    const result = await runCommand(repairCommand, {
      _: ['agents'],
      agent: 'claude',
      scope: 'local',
      json: true,
    });

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.repair.changed).toContain('claude:mcp:local');

    const config = JSON.parse(readFileSync(path.join(sandboxRoot, '.claude.json'), 'utf-8'));
    const project = config.projects[repoDir.replace(/\\/g, '/')];
    expect(project.mcpServers.memorix).toEqual({
      type: 'stdio',
      command: 'memorix',
      args: ['serve'],
      alwaysLoad: true,
    });
  });

  it('doctor agents verifies the Codex bundle, marketplace, enabled plugin, and hook contract', async () => {
    writeCurrentCodexPluginSetup();
    mockCodexPluginList(true);

    const result = await runCommand(doctorCommand, {
      _: ['agents'],
      agent: 'codex',
      scope: 'global',
      json: true,
    });

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    const codex = parsed.agents.entries.find((entry: any) => entry.agent === 'codex');

    expect(codex.plugin.status).toBe('ok');
    expect(codex.plugin.checks.map((check: any) => check.kind)).toEqual([
      'bundle',
      'marketplace',
      'runtime',
      'hook-trust',
    ]);
    expect(codex.plugin.checks[0].hooks.declared).toEqual(expect.arrayContaining([
      'SessionStart',
      'UserPromptSubmit',
      'PostToolUse',
      'PreCompact',
      'Stop',
    ]));
    expect(codex.plugin.checks[2].runtime).toMatchObject({ installed: true, enabled: true });
    expect(codex.plugin.checks[3].hookTrust.trusted).toHaveLength(5);
  });

  it('doctor agents reports a disabled Codex plugin as repairable', async () => {
    writeCurrentCodexPluginSetup();
    mockCodexPluginList(false);

    const result = await runCommand(doctorCommand, {
      _: ['agents'],
      agent: 'codex',
      scope: 'global',
      json: true,
    });

    const parsed = JSON.parse(result.stdout);
    const codex = parsed.agents.entries.find((entry: any) => entry.agent === 'codex');
    expect(codex.plugin.status).toBe('repairable');
    expect(codex.plugin.issues).toContain('codex-plugin-disabled');
  });

  it('repair agents leaves a disabled Codex plugin for the plugin browser', async () => {
    writeCurrentCodexPluginSetup();
    mockCodexPluginList(false);

    const result = await runCommand(repairCommand, {
      _: ['agents'],
      agent: 'codex',
      scope: 'global',
      json: true,
    });

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.repair.changed).not.toContain('codex:plugin:global');
    expect(parsed.repair.skipped).toContain('codex:plugin:global:enable-in-plugin-browser');
  });
});
