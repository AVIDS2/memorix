import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import * as p from '@clack/prompts';
import { buildSetupPlan, installAgentSetup, installMcpConfig } from '../../src/cli/commands/setup.js';
import { inspectAgentIntegrations, repairAgentIntegrations } from '../../src/cli/commands/agent-integrations.js';
import { getMCPConfigEntries } from '../../src/cli/commands/uninstall.js';
import { MEMORIX_INTEGRATIONS } from '../../src/integrations/registry.js';
import { OFFICIAL_MEMORIX_SKILLS } from '../../src/hooks/official-skills.js';

const homedirMock = vi.hoisted(() => vi.fn());
vi.mock('node:os', async () => ({
  ...await vi.importActual<typeof import('node:os')>('node:os'),
  homedir: homedirMock,
}));
// Never invoke an installed Pi or change the contributor's real Pi settings.
vi.mock('node:child_process', async () => ({
  ...await vi.importActual<typeof import('node:child_process')>('node:child_process'),
  spawnSync: vi.fn(() => ({ status: 0, stdout: '', stderr: '' })),
}));

describe('Pi native MCP setup', () => {
  let root: string;
  let home: string;
  let project: string;
  let originalCwd: string;

  beforeEach(() => {
    root = realpathSync(mkdtempSync(path.join(tmpdir(), 'memorix-pi-setup-')));
    home = path.join(root, 'home');
    project = path.join(root, 'project');
    mkdirSync(home);
    mkdirSync(project);
    homedirMock.mockReturnValue(home);
    originalCwd = process.cwd();
    process.chdir(project);
    vi.mocked(spawnSync).mockClear();
    vi.spyOn(p.log, 'info').mockImplementation(() => {});
    vi.spyOn(p.log, 'success').mockImplementation(() => {});
  });

  afterEach(() => {
    process.chdir(originalCwd);
    vi.restoreAllMocks();
    rmSync(root, { recursive: true, force: true });
  });

  function configPath(global: boolean): string {
    return global
      ? path.join(home, '.pi', 'agent', 'mcp.json')
      : path.join(project, '.pi', 'mcp.json');
  }

  for (const global of [false, true]) {
    describe(global ? 'global scope' : 'project scope', () => {
      for (const mcp of ['stdio', 'http'] as const) {
        it(`installs ${mcp} MCP alongside the extension and skills`, async () => {
          const plan = buildSetupPlan({ agent: 'pi', mcp, global });
          expect(plan.actions).toContain('pi-package');
          expect(plan.actions).toContain(mcp === 'stdio' ? 'mcp-stdio' : 'http-control-plane');
          await installAgentSetup('pi', plan, global);

          const config = JSON.parse(readFileSync(configPath(global), 'utf-8'));
          expect(config.mcpServers.memorix).toEqual(mcp === 'stdio'
            ? { command: 'memorix', args: ['serve', '--mode', 'lite'] }
            : { url: 'http://localhost:3211/mcp' });
          expect(existsSync(configPath(!global))).toBe(false);

          const packagePath = global
            ? path.join(home, '.pi', 'agent', 'packages', 'memorix')
            : path.join(project, '.pi', 'packages', 'memorix');
          expect(existsSync(path.join(packagePath, 'extensions', 'memorix.js'))).toBe(true);
          expect(existsSync(path.join(packagePath, 'skills', 'memorix-memory', 'SKILL.md'))).toBe(true);
          expect(spawnSync).toHaveBeenCalledWith('pi',
            global ? ['install', packagePath, '--approve'] : ['install', packagePath, '-l', '--approve'],
            expect.any(Object));
          expect(p.log.info).toHaveBeenCalledWith(expect.stringContaining('pi: run `pi mcp list`'));
          expect(p.log.info).not.toHaveBeenCalledWith(expect.stringContaining('Pi has no MCP'));
          if (mcp === 'http') {
            expect(p.log.info).toHaveBeenCalledWith(expect.stringContaining('memorix background start'));
          }
        });
      }

      it('skips MCP configuration with --mcp none and leaves existing MCP untouched', async () => {
        const file = configPath(global);
        const plan = buildSetupPlan({ agent: 'pi', mcp: 'none', global });
        expect(plan.actions).not.toContain('mcp-stdio');
        expect(plan.actions).not.toContain('http-control-plane');
        await installAgentSetup('pi', plan, global);
        expect(existsSync(file)).toBe(false);

        mkdirSync(path.dirname(file), { recursive: true });
        const existing = '{"mcpServers":{"other":{"command":"other"}}}\n';
        writeFileSync(file, existing);
        await installAgentSetup('pi', plan, global);
        expect(readFileSync(file, 'utf-8')).toBe(existing);
        expect(p.log.info).not.toHaveBeenCalledWith(expect.stringContaining('pi: run `pi mcp list`'));
      });

      it('preserves unrelated servers and settings across idempotent installs and transport changes', async () => {
        const file = configPath(global);
        mkdirSync(path.dirname(file), { recursive: true });
        const other = { url: 'https://example.test/mcp', enabled: false, exposure: 'deferred', toolExposure: { delete: 'hidden' } };
        writeFileSync(file, JSON.stringify({ autoEnableCodemode: false, mcpServers: { other } }));
        for (const mcp of ['stdio', 'stdio', 'http', 'http', 'stdio'] as const) {
          await installMcpConfig({ agent: 'pi', mcp, global, projectRoot: project });
          const config = JSON.parse(readFileSync(file, 'utf-8'));
          expect(config.autoEnableCodemode).toBe(false);
          expect(config.mcpServers.other).toEqual(other);
          expect(Object.keys(config.mcpServers)).toEqual(['other', 'memorix']);
          expect(config.mcpServers.memorix).toEqual(mcp === 'stdio'
            ? { command: 'memorix', args: ['serve', '--mode', 'lite'] }
            : { url: 'http://localhost:3211/mcp' });
        }
      });
    });
  }

  it.each([false, true])('keeps workflow-only skills on reinstall (global=%s)', async global => {
    const plan = buildSetupPlan({ agent: 'pi', global });
    const skillsRoot = global
      ? path.join(home, '.pi', 'agent', 'packages', 'memorix', 'skills')
      : path.join(project, '.pi', 'packages', 'memorix', 'skills');
    for (let install = 0; install < 2; install++) {
      await installAgentSetup('pi', plan, global);
      for (const { name } of OFFICIAL_MEMORIX_SKILLS) {
        const content = readFileSync(path.join(skillsRoot, name, 'SKILL.md'), 'utf-8');
        const template = new URL(`../../plugins/pi/memorix/skills/${name}/SKILL.md`, import.meta.url);
        expect(content).toBe(readFileSync(template, 'utf-8'));
        expect(content).toContain(`name: ${name}`);
        expect(content).not.toContain('## Tool Router');
        expect(content).not.toContain('| Situation | Prefer | CLI fallback |');
      }
    }
    const memory = readFileSync(path.join(skillsRoot, 'memorix-memory', 'SKILL.md'), 'utf-8');
    expect(memory).toContain('Do not store secrets');
    expect(memory).toContain('verify behavior');
    expect(memory).not.toContain('| What to store | Type |');
    const sessions = readFileSync(path.join(skillsRoot, 'memorix-sessions', 'SKILL.md'), 'utf-8');
    expect(sessions).toContain('In HTTP mode, pass the absolute workspace path as `projectRoot`');
    const reasoning = readFileSync(path.join(skillsRoot, 'memorix-reasoning', 'SKILL.md'), 'utf-8');
    expect(reasoning).toContain('alternatives considered');
  });

  it('defaults to stdio and supports MCP-only setup without the package', async () => {
    const plan = buildSetupPlan({ agent: 'pi', plugin: false, hooks: false, rules: false });
    expect(plan.mcp).toBe('stdio');
    expect(plan.actions).not.toContain('pi-package');
    await installAgentSetup('pi', plan, false);
    expect(JSON.parse(readFileSync(configPath(false), 'utf-8')).mcpServers.memorix.command).toBe('memorix');
    expect(spawnSync).not.toHaveBeenCalled();
  });

  it('advertises both native transports in the integration registry', () => {
    const entry = MEMORIX_INTEGRATIONS.find(entry => entry.agent === 'pi');
    expect(entry?.capabilities.transport).toMatchObject({ supported: ['stdio', 'http'], default: 'stdio' });
    expect(entry?.capabilities.source.generatedBy).toContain('src/workspace/mcp-adapters/pi.ts');
  });

  it('inspects and repairs native Pi MCP rather than treating it as package-managed', async () => {
    const missing = await inspectAgentIntegrations({ agent: 'pi', projectRoot: project, scope: 'project' });
    expect(missing.entries[0].mcp.status).toBe('missing');
    const repair = await repairAgentIntegrations({ agent: 'pi', projectRoot: project, scope: 'project' });
    expect(repair.changed).toContain('pi:mcp:project');
    const installed = await inspectAgentIntegrations({ agent: 'pi', projectRoot: project, scope: 'project' });
    expect(installed.entries[0].mcp.status).toBe('ok');
    expect(installed.entries[0].mcp.checks[0].path).toBe(configPath(false));
    await installMcpConfig({ agent: 'pi', projectRoot: project, mcp: 'http' });
    const http = await inspectAgentIntegrations({ agent: 'pi', projectRoot: project, scope: 'project' });
    expect(http.entries[0].mcp.status).toBe('ok');
    expect(http.entries[0].capability.observedTransports).toEqual(['http']);
  });

  it('discovers both native Pi configs for manual uninstall without changing them', async () => {
    await installMcpConfig({ agent: 'pi', mcp: 'stdio', global: true });
    await installMcpConfig({ agent: 'pi', mcp: 'http', projectRoot: project });
    const entries = getMCPConfigEntries(home, project).filter(entry => entry.agent === 'Pi');
    expect(entries.map(entry => [entry.kind, entry.path, entry.detected])).toEqual([
      ['global', configPath(true), true], ['project', configPath(false), true],
    ]);
    expect(existsSync(configPath(true))).toBe(true);
    expect(existsSync(configPath(false))).toBe(true);
  });
});
