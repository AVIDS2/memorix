import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import doctorCommand from '../../src/cli/commands/doctor.js';
import repairCommand from '../../src/cli/commands/repair.js';

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
  let sandboxRoot = '';
  let repoDir = '';

  beforeEach(() => {
    sandboxRoot = mkdtempSync(path.join(tmpdir(), 'memorix-agent-doctor-'));
    repoDir = path.join(sandboxRoot, 'repo');
    mkdirSync(path.join(repoDir, '.claude'), { recursive: true });
    execSync('git init', { cwd: repoDir, stdio: 'ignore' });
    process.chdir(repoDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(sandboxRoot, { recursive: true, force: true });
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
});
