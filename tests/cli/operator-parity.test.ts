import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';

import memoryCommand from '../../src/cli/commands/memory.js';
import syncCommand from '../../src/cli/commands/sync.js';
import ingestCommand from '../../src/cli/commands/ingest.js';
import reasoningCommand from '../../src/cli/commands/reasoning.js';
import retentionCommand from '../../src/cli/commands/retention.js';
import formationCommand from '../../src/cli/commands/formation.js';
import auditCommand from '../../src/cli/commands/audit.js';
import transferCommand from '../../src/cli/commands/transfer.js';
import skillsCommand from '../../src/cli/commands/skills.js';
import { CLI_NATIVE_PARITY } from '../../src/cli/capability-map.js';
import { TOOL_PROFILES } from '../../src/server/tool-profile.js';
import { closeAllDatabases } from '../../src/store/sqlite-db.js';
import { resetObservationStore } from '../../src/store/obs-store.js';
import { resetSessionStore } from '../../src/store/session-store.js';
import { resetTeamStore } from '../../src/team/team-store.js';
import { resetMiniSkillStore } from '../../src/store/mini-skill-store.js';
import { resetMiniSkillFreshness } from '../../src/memory/freshness.js';

async function runCommand(command: any, args: Record<string, unknown>) {
  const logs: string[] = [];
  const errors: string[] = [];
  const logSpy = vi.spyOn(console, 'log').mockImplementation((...parts) => {
    logs.push(parts.map(String).join(' '));
  });
  const errSpy = vi.spyOn(console, 'error').mockImplementation((...parts) => {
    errors.push(parts.map(String).join(' '));
  });
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

describe('CLI native parity', () => {
  const originalCwd = process.cwd();
  const originalDataDir = process.env.MEMORIX_DATA_DIR;
  const originalEmbedding = process.env.MEMORIX_EMBEDDING;
  let sandboxRoot = '';
  let repoDir = '';
  let dataDir = '';

  beforeEach(() => {
    sandboxRoot = mkdtempSync(path.join(tmpdir(), 'memorix-cli-parity-'));
    repoDir = path.join(sandboxRoot, 'repo');
    dataDir = path.join(sandboxRoot, 'data');
    mkdirSync(repoDir, { recursive: true });
    writeFileSync(path.join(repoDir, 'README.md'), '# test\n', 'utf8');
    execSync('git init', { cwd: repoDir, stdio: 'ignore' });
    execSync('git config user.email test@example.com', { cwd: repoDir, stdio: 'ignore' });
    execSync('git config user.name "Memorix Test"', { cwd: repoDir, stdio: 'ignore' });
    process.chdir(repoDir);
    process.env.MEMORIX_DATA_DIR = dataDir;
    process.env.MEMORIX_EMBEDDING = 'off';
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (originalDataDir === undefined) {
      delete process.env.MEMORIX_DATA_DIR;
    } else {
      process.env.MEMORIX_DATA_DIR = originalDataDir;
    }
    if (originalEmbedding === undefined) {
      delete process.env.MEMORIX_EMBEDDING;
    } else {
      process.env.MEMORIX_EMBEDDING = originalEmbedding;
    }
    resetObservationStore();
    resetSessionStore();
    resetTeamStore();
    resetMiniSkillStore();
    resetMiniSkillFreshness();
    closeAllDatabases();
    rmSync(sandboxRoot, { recursive: true, force: true });
  });

  it('provides an explicit CLI route for every Memorix-native MCP tool', () => {
    const nativeTools = Object.keys(TOOL_PROFILES).filter((toolName) => !toolName.startsWith('create_')
      && !toolName.startsWith('delete_')
      && !toolName.startsWith('read_')
      && !toolName.startsWith('search_nodes')
      && !toolName.startsWith('open_nodes')
      && !toolName.startsWith('add_observations'));

    expect(new Set(Object.keys(CLI_NATIVE_PARITY))).toEqual(new Set(nativeTools));
  });

  it('exposes reasoning, retention, formation, and transfer via JSON-first CLI commands', async () => {
    const stored = await runCommand(reasoningCommand, {
      _: ['store'],
      entity: 'cli-parity',
      decision: 'Use CLI as the primary product surface',
      rationale: 'Human operators should not need MCP for core operations',
      alternatives: 'MCP-only,hybrid-first',
      constraints: 'No new runtime semantics',
      expectedOutcome: 'Every native operation has a CLI route',
      risks: 'Broader help surface',
      concepts: 'cli,mcp,ux',
      json: true,
    });

    expect(stored.exitCode).toBe(0);
    const storedJson = JSON.parse(stored.stdout);
    expect(storedJson.observation.type).toBe('reasoning');

    const searched = await runCommand(reasoningCommand, {
      _: ['search'],
      query: 'primary product surface',
      json: true,
    });
    expect(searched.exitCode).toBe(0);
    const searchJson = JSON.parse(searched.stdout);
    expect(searchJson.entries.length).toBeGreaterThanOrEqual(1);

    const retention = await runCommand(retentionCommand, {
      _: ['status'],
      json: true,
    });
    expect(retention.exitCode).toBe(0);
    expect(JSON.parse(retention.stdout).summary).toBeDefined();

    const formation = await runCommand(formationCommand, {
      _: ['metrics'],
      json: true,
    });
    expect(formation.exitCode).toBe(0);
    expect(JSON.parse(formation.stdout).summary).toBeDefined();

    const exported = await runCommand(transferCommand, {
      _: ['export'],
      format: 'json',
      json: true,
    });
    expect(exported.exitCode).toBe(0);
    const exportJson = JSON.parse(exported.stdout);
    expect(exportJson.export.stats.observationCount).toBeGreaterThanOrEqual(1);

    const imported = await runCommand(transferCommand, {
      _: ['import'],
      data: JSON.stringify(exportJson.export),
      json: true,
    });
    expect(imported.exitCode).toBe(0);
    expect(JSON.parse(imported.stdout).result.sessionsImported).toBeGreaterThanOrEqual(0);
  });

  it('extends memory, audit, sync, skills, and ingest namespaces without changing their product semantics', async () => {
    const topicKey = await runCommand(memoryCommand, {
      _: ['suggest-topic-key'],
      type: 'decision',
      title: 'CLI parity command surface',
      json: true,
    });
    expect(topicKey.exitCode).toBe(0);
    expect(JSON.parse(topicKey.stdout).topicKey).toContain('cli');

    const first = await runCommand(memoryCommand, {
      _: ['store'],
      text: 'Windows path handling must stay explicit in CLI docs.',
      title: 'Windows CLI doc gotcha',
      entity: 'cli-docs',
      type: 'gotcha',
      json: true,
    });
    const second = await runCommand(memoryCommand, {
      _: ['store'],
      text: 'Windows path handling must stay explicit in CLI help and setup docs.',
      title: 'Windows CLI doc gotcha follow-up',
      entity: 'cli-docs',
      type: 'gotcha',
      json: true,
    });
    expect(first.exitCode).toBe(0);
    expect(second.exitCode).toBe(0);

    const consolidate = await runCommand(memoryCommand, {
      _: ['consolidate'],
      action: 'preview',
      json: true,
    });
    expect(consolidate.exitCode).toBe(0);
    expect(JSON.parse(consolidate.stdout).clusters).toBeDefined();

    const promote = await runCommand(memoryCommand, {
      _: ['promote'],
      ids: `${JSON.parse(first.stdout).observation.id}`,
      json: true,
    });
    expect(promote.exitCode).toBe(0);
    expect(JSON.parse(promote.stdout).skill.id).toBeTypeOf('number');

    const audit = await runCommand(auditCommand, {
      _: ['list'],
      json: true,
    });
    expect(audit.exitCode).toBe(0);
    expect(JSON.parse(audit.stdout).entries).toBeDefined();

    writeFileSync(path.join(repoDir, '.windsurfrules'), 'Always write tests first.\n', 'utf8');
    const rulesStatus = await runCommand(syncCommand, {
      _: ['rules'],
      action: 'status',
      json: true,
    });
    expect(rulesStatus.exitCode).toBe(0);
    expect(JSON.parse(rulesStatus.stdout).status.totalRules).toBeGreaterThanOrEqual(1);

    const workspaceScan = await runCommand(syncCommand, {
      _: ['workspace'],
      action: 'scan',
      json: true,
    });
    expect(workspaceScan.exitCode).toBe(0);
    expect(JSON.parse(workspaceScan.stdout).scan).toBeDefined();

    const skillList = await runCommand(skillsCommand, {
      _: ['list'],
      json: true,
    });
    expect(skillList.exitCode).toBe(0);
    expect(JSON.parse(skillList.stdout).skills).toBeDefined();

    const samplePngBase64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+XWZ0AAAAASUVORK5CYII=';
    const imagePath = path.join(repoDir, 'sample.png');
    writeFileSync(imagePath, Buffer.from(samplePngBase64, 'base64'));
    const ingestImage = await runCommand(ingestCommand, {
      _: ['image'],
      path: imagePath,
      json: true,
    });
    expect(ingestImage.exitCode).toBe(1);
    expect(JSON.parse(ingestImage.stderr).error).toContain('LLM');
  });

  it('generates and shows project skills through the dedicated skills namespace', async () => {
    for (let index = 0; index < 3; index += 1) {
      const result = await runCommand(memoryCommand, {
        _: ['store'],
        text: `CLI gotcha ${index}: operators should prefer memorix session start without team join unless needed.`,
        title: `CLI team gotcha ${index}`,
        entity: 'session-start-cli',
        type: 'gotcha',
        json: true,
      });
      expect(result.exitCode).toBe(0);
    }

    const generated = await runCommand(skillsCommand, {
      _: ['generate'],
      json: true,
    });
    expect(generated.exitCode).toBe(0);
    const generatedJson = JSON.parse(generated.stdout);
    expect(generatedJson.skills.length).toBeGreaterThanOrEqual(1);

    const firstSkill = generatedJson.skills[0].name;
    const shown = await runCommand(skillsCommand, {
      _: ['show'],
      name: firstSkill,
      json: true,
    });
    expect(shown.exitCode).toBe(0);
    expect(JSON.parse(shown.stdout).skill.name).toBe(firstSkill);
  });
});
