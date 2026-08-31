import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { WorkbuddyMCPAdapter } from '../../src/workspace/mcp-adapters/workbuddy.js';
import { buildSetupPlan, installMcpConfig } from '../../src/cli/commands/setup.js';
import {
  getAgentRulesPath,
  getProjectConfigPath,
  installHooks,
  uninstallHooks,
} from '../../src/hooks/installers/index.js';
import { getMCPConfigEntries } from '../../src/cli/commands/uninstall.js';

const homedirMock = vi.hoisted(() => vi.fn(() => 'C:\\Users\\Tester'));

vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os');
  return { ...actual, homedir: homedirMock };
});

describe('WorkBuddy integration', () => {
  let tempHome = '';

  beforeEach(() => {
    tempHome = mkdtempSync(path.join(tmpdir(), 'memorix-workbuddy-'));
    homedirMock.mockReturnValue(tempHome);
  });

  afterEach(() => {
    rmSync(tempHome, { recursive: true, force: true });
  });

  describe('WorkbuddyMCPAdapter', () => {
    it('resolves project-scope config to <project>/.workbuddy/mcp.json', () => {
      const adapter = new WorkbuddyMCPAdapter();
      expect(adapter.getConfigPath('/any/project')).toBe(path.join('/any/project', '.workbuddy', 'mcp.json'));
    });

    it('resolves global config (no projectRoot) to ~/.workbuddy/mcp.json', () => {
      const adapter = new WorkbuddyMCPAdapter();
      expect(adapter.getConfigPath()).toBe(path.join(tempHome, '.workbuddy', 'mcp.json'));
      expect(adapter.getConfigPath(undefined)).toBe(path.join(tempHome, '.workbuddy', 'mcp.json'));
    });

    it('round-trips a stdio Memorix entry through generate/parse', () => {
      const adapter = new WorkbuddyMCPAdapter();
      const generated = adapter.generate([{
        name: 'memorix',
        command: 'memorix',
        args: ['serve'],
      }]);

      const parsed = JSON.parse(generated);
      expect(parsed.mcpServers.memorix).toMatchObject({ command: 'memorix', args: ['serve'] });

      const entries = adapter.parse(generated);
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ name: 'memorix', command: 'memorix', args: ['serve'] });
    });

    it('round-trips a streamable-http entry', () => {
      const adapter = new WorkbuddyMCPAdapter();
      const generated = adapter.generate([{
        name: 'memorix',
        command: '',
        args: [],
        url: 'http://localhost:3211/mcp',
      }]);

      const entries = adapter.parse(generated);
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ name: 'memorix', url: 'http://localhost:3211/mcp' });
    });

    it('preserves unrelated servers when parsing', () => {
      const adapter = new WorkbuddyMCPAdapter();
      const content = JSON.stringify({
        mcpServers: {
          other: { command: 'other-tool', args: [] },
          memorix: { command: 'memorix', args: ['serve'] },
        },
      });

      const entries = adapter.parse(content);
      expect(entries.map((e) => e.name)).toEqual(['other', 'memorix']);
    });
  });

  describe('installMcpConfig', () => {
    it('is idempotent across repeated installs', async () => {
      await installMcpConfig({ agent: 'workbuddy', mcp: 'stdio', global: true });
      await installMcpConfig({ agent: 'workbuddy', mcp: 'stdio', global: true });

      const content = readFileSync(path.join(tempHome, '.workbuddy', 'mcp.json'), 'utf-8');
      const parsed = JSON.parse(content);
      expect(Object.keys(parsed.mcpServers)).toEqual(['memorix']);
    });

    it('writes project-scope config to <project>/.workbuddy/mcp.json without polluting user-level', async () => {
      const root = path.join(tmpdir(), 'wb-project');
      await installMcpConfig({ agent: 'workbuddy', mcp: 'stdio', global: false, projectRoot: root });

      const content = readFileSync(path.join(root, '.workbuddy', 'mcp.json'), 'utf-8');
      const parsed = JSON.parse(content);
      expect(Object.keys(parsed.mcpServers)).toEqual(['memorix']);
      // Project install must not leak into the user-level file.
      expect(existsSync(path.join(tempHome, '.workbuddy', 'mcp.json'))).toBe(false);
    });

    it('preserves unrelated servers when merging into a project config', async () => {
      const root = path.join(tmpdir(), 'wb-project-merge');
      const projectFile = path.join(root, '.workbuddy', 'mcp.json');
      mkdirSync(path.dirname(projectFile), { recursive: true });
      writeFileSync(projectFile, JSON.stringify({
        mcpServers: { other: { command: 'other-tool', args: [] } },
      }), 'utf-8');

      await installMcpConfig({ agent: 'workbuddy', mcp: 'stdio', global: false, projectRoot: root });

      const parsed = JSON.parse(readFileSync(projectFile, 'utf-8'));
      expect(Object.keys(parsed.mcpServers).sort()).toEqual(['memorix', 'other']);
    });
  });

  describe('installHooks', () => {
    it('installs AGENTS.md guidance but no skills (no documented skills path)', async () => {
      const root = path.join(tmpdir(), 'wb-hooks-project');
      const result = await installHooks('workbuddy', root, false);

      expect(result.configPath).toBe(path.join(root, 'AGENTS.md'));
      expect(existsSync(path.join(root, '.workbuddy', 'skills'))).toBe(false);
      expect(existsSync(path.join(tempHome, '.workbuddy', 'skills'))).toBe(false);
    });

    it('reports a clear no-op for global install and writes no file', async () => {
      const root = path.join(tmpdir(), 'wb-global-hooks');
      const result = await installHooks('workbuddy', root, true);

      // Must not report a path that was never written.
      expect(result.configPath).toBe('');
      expect(result.generated.note).toMatch(/no hook system|mcp only/i);
      // Neither the generic default nor any global file may be created.
      expect(existsSync(path.join(root, '.memorix', 'hooks.json'))).toBe(false);
      expect(existsSync(path.join(tempHome, '.workbuddy', 'hooks.json'))).toBe(false);
    });
  });

  describe('hook detection boundaries', () => {
    it('excludes WorkBuddy from hook detection (no hook file path)', () => {
      const root = path.join(tmpdir(), 'wb-hook-detect');

      // WorkBuddy has no hook file at all, so there is no path to detect.
      expect(getProjectConfigPath('workbuddy', root)).toBe('');
      expect(existsSync(getProjectConfigPath('workbuddy', root))).toBe(false);
    });

    it('treats hook uninstall as a no-op at both scopes', async () => {
      const root = path.join(tmpdir(), 'wb-hook-uninstall');
      const hooksFile = path.join(root, '.memorix', 'hooks.json');
      mkdirSync(path.dirname(hooksFile), { recursive: true });
      writeFileSync(hooksFile, '{}', 'utf-8');

      expect(await uninstallHooks('workbuddy', root, false)).toBe(false);
      expect(await uninstallHooks('workbuddy', root, true)).toBe(false);
      // The generic default path must be left untouched.
      expect(existsSync(hooksFile)).toBe(true);
    });
  });

  describe('uninstall discovery', () => {
    it('discovers project-level WorkBuddy MCP config', () => {
      const root = mkdtempSync(path.join(tmpdir(), 'wb-uninstall-project-'));
      const projectFile = path.join(root, '.workbuddy', 'mcp.json');
      mkdirSync(path.dirname(projectFile), { recursive: true });
      writeFileSync(projectFile, JSON.stringify({
        mcpServers: { memorix: { command: 'memorix', args: ['serve'] } },
      }), 'utf-8');

      const entries = getMCPConfigEntries(tempHome, root);
      const projectEntry = entries.find(
        (e) => e.agent === 'WorkBuddy' && e.kind === 'project',
      );

      expect(projectEntry).toBeDefined();
      expect(projectEntry?.path).toBe(projectFile);
      expect(projectEntry?.detected).toBe(true);

      rmSync(root, { recursive: true, force: true });
    });

    it('lists both global and project WorkBuddy paths', () => {
      const root = path.join(tmpdir(), 'wb-uninstall-both');
      const entries = getMCPConfigEntries(tempHome, root).filter((e) => e.agent === 'WorkBuddy');

      expect(entries.map((e) => e.kind).sort()).toEqual(['global', 'project']);
    });
  });

  describe('setup wiring', () => {
    it('plans stdio MCP and project guidance without a plugin package', () => {
      const plan = buildSetupPlan({ agent: 'workbuddy' });
      expect(plan.actions).toContain('mcp-stdio');
      expect(plan.actions).toContain('project-guidance');
      expect(plan.actions).not.toContain('plugin-package');
      expect(plan.actions).not.toContain('extension-package');
    });

    it('uses AGENTS.md for project guidance and skips global guidance', () => {
      const root = path.join(tmpdir(), 'root');
      expect(getAgentRulesPath('workbuddy', root)).toBe(path.join(root, 'AGENTS.md'));
      expect(getAgentRulesPath('workbuddy', path.join(tmpdir(), 'home'), true)).toBe('');
    });
  });
});
