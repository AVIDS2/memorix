import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { WorkbuddyMCPAdapter } from '../../src/workspace/mcp-adapters/workbuddy.js';
import { buildSetupPlan, installMcpConfig } from '../../src/cli/commands/setup.js';
import { getAgentRulesPath, installHooks } from '../../src/hooks/installers/index.js';

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
