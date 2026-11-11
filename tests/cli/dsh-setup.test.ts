import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DshMCPAdapter } from '../../src/workspace/mcp-adapters/dsh.js';
import { buildSetupPlan, installMcpConfig } from '../../src/cli/commands/setup.js';
import { inspectAgentIntegrations } from '../../src/cli/commands/agent-integrations.js';
import { getAgentRulesPath } from '../../src/hooks/installers/index.js';

const MEMORIX_ROW_ID = 'memory-memorix';

describe('DeepSeek Harness (DSH) integration', () => {
  const originalDshHome = process.env.DSH_HOME;
  let tempHome = '';

  beforeEach(() => {
    tempHome = mkdtempSync(path.join(tmpdir(), 'memorix-dsh-'));
    process.env.DSH_HOME = tempHome;
  });

  afterEach(() => {
    if (originalDshHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = originalDshHome;
    rmSync(tempHome, { recursive: true, force: true });
  });

  describe('DshMCPAdapter', () => {
    it('resolves the config path under $DSH_HOME/cordis.patch.yml', () => {
      const adapter = new DshMCPAdapter();
      expect(adapter.getConfigPath('/any/project')).toBe(path.join(tempHome, 'cordis.patch.yml'));
    });

    it('round-trips a stdio Memorix row through generate/parse', () => {
      const adapter = new DshMCPAdapter();
      const generated = adapter.generate([{
        name: 'memorix',
        command: 'memorix',
        args: ['serve'],
      }]);

      expect(generated).toContain('name: "@deepseek-ai/dsh-mcp-client"');
      expect(generated).toContain('serverName: memorix');
      expect(generated).toContain('transport: stdio');

      const entries = adapter.parse(generated);
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ name: 'memorix', command: 'memorix', args: ['serve'] });
    });

    it('round-trips a streamable-http row', () => {
      const adapter = new DshMCPAdapter();
      const generated = adapter.generate([{
        name: 'memorix',
        command: '',
        args: [],
        url: 'http://localhost:3211/mcp',
      }]);

      const entries = adapter.parse(generated);
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ name: 'memorix', url: 'http://localhost:3211/mcp' });
      expect(generated).toContain('transport: streamable-http');
    });

    it('ignores unrelated rows when parsing', () => {
      const adapter = new DshMCPAdapter();
      const content = [
        '- insert:',
        '    - id: mcp-other',
        "      name: '@deepseek-ai/dsh-mcp-client'",
        '      config:',
        '        serverName: other',
        '        transport: stdio',
        '        command: other-tool',
        '- insert:',
        `    - id: ${MEMORIX_ROW_ID}`,
        "      name: '@deepseek-ai/dsh-mcp-client'",
        '      config:',
        '        serverName: memorix',
        '        transport: stdio',
        '        command: memorix',
        '        args: [serve]',
      ].join('\n');

      const entries = adapter.parse(content);
      expect(entries).toHaveLength(1);
      expect(entries[0].name).toBe('memorix');
    });
  });

  describe('installMcpConfig', () => {
    const userPatch = [
      '# user-owned comment',
      '- insert:',
      '    - id: mcp-user',
      "      name: '@deepseek-ai/dsh-mcp-client'",
      '      config:',
      '        serverName: other',
      '        transport: stdio',
      '        command: other-tool',
    ].join('\n');

    it('merges the Memorix row into an existing user patch without clobbering', async () => {
      writeFileSync(path.join(tempHome, 'cordis.patch.yml'), userPatch, 'utf-8');
      await installMcpConfig({ agent: 'dsh', mcp: 'stdio' });

      const content = readFileSync(path.join(tempHome, 'cordis.patch.yml'), 'utf-8');
      expect(content).toContain('mcp-user');
      expect(content).toContain(MEMORIX_ROW_ID);
      expect(content).toContain('serverName: memorix');

      const entries = new DshMCPAdapter().parse(content);
      expect(entries.map((entry) => entry.name)).toEqual(['memorix']);
    });

    it('is idempotent across repeated installs', async () => {
      await installMcpConfig({ agent: 'dsh', mcp: 'stdio' });
      await installMcpConfig({ agent: 'dsh', mcp: 'stdio' });

      const content = readFileSync(path.join(tempHome, 'cordis.patch.yml'), 'utf-8');
      const occurrences = content.split(MEMORIX_ROW_ID).length - 1;
      expect(occurrences).toBe(1);
    });

    it('appends to a file that is not a parseable patch list instead of overwriting it', async () => {
      writeFileSync(path.join(tempHome, 'cordis.patch.yml'), 'not: [valid\n  user content:', 'utf-8');
      await installMcpConfig({ agent: 'dsh', mcp: 'stdio' });

      const content = readFileSync(path.join(tempHome, 'cordis.patch.yml'), 'utf-8');
      expect(content).toContain('user content');
      expect(content).toContain(MEMORIX_ROW_ID);
    });
  });

  describe('setup wiring', () => {
    it('plans stdio MCP and project guidance without a plugin package', () => {
      const plan = buildSetupPlan({ agent: 'dsh' });
      expect(plan.actions).toContain('mcp-stdio');
      expect(plan.actions).toContain('project-guidance');
      expect(plan.actions).not.toContain('plugin-package');
      expect(plan.actions).not.toContain('extension-package');
    });

    it('uses AGENTS.md for project guidance and the harness home globally', () => {
      expect(getAgentRulesPath('dsh', path.join(tmpdir(), 'root'))).toBe(path.join(tmpdir(), 'root', 'AGENTS.md'));
      // With $DSH_HOME set, global guidance lands in the harness home DSH reads.
      expect(getAgentRulesPath('dsh', path.join(tmpdir(), 'home'), true)).toBe(path.join(tempHome, 'AGENTS.md'));
    });

    it('falls back to ~/.dsh/AGENTS.md when $DSH_HOME is unset', () => {
      delete process.env.DSH_HOME;
      expect(getAgentRulesPath('dsh', path.join(tmpdir(), 'home'), true))
        .toBe(path.join(tmpdir(), 'home', '.dsh', 'AGENTS.md'));
    });

    it('is reported OK by the agent doctor under an explicit global scope', async () => {
      await installMcpConfig({ agent: 'dsh', mcp: 'stdio' });
      const report = await inspectAgentIntegrations({ agent: 'dsh', scope: 'global' });
      expect(report.entries).toHaveLength(1);
      expect(report.entries[0].mcp.status).toBe('ok');
      expect(report.entries[0].mcp.checks?.[0]?.path).toBe(path.join(tempHome, 'cordis.patch.yml'));
    });
  });
});
