import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  buildSetupPlan,
  getSetupIntegrationRows,
  installMcpConfig,
  installGeminiExtensionPackage,
  installPiPackage,
  installPluginPackage,
  getSetupAgentTargets,
} from '../../src/cli/commands/setup.js';

function makeTmpDir(): string {
  return fsSync.mkdtempSync(path.join(os.tmpdir(), 'memorix-setup-test-'));
}

const OFFICIAL_SKILL_NAMES = [
  'memorix-memory',
  'memorix-reasoning',
  'memorix-sessions',
  'memorix-git-memory',
  'memorix-mini-skills',
  'memorix-orchestrate',
  'memorix-troubleshooting',
];

async function cleanup(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true });
}

async function expectOfficialSkills(skillsRoot: string): Promise<void> {
  for (const name of OFFICIAL_SKILL_NAMES) {
    const skillPath = path.join(skillsRoot, name, 'SKILL.md');
    const content = await fs.readFile(skillPath, 'utf-8');
    expect(content).toContain(`name: ${name}`);
    expect(content).toContain('CLI fallback');
  }
}

describe('setup command planning', () => {
  it('defaults to stdio MCP and no HTTP control plane', () => {
    const plan = buildSetupPlan({ agent: 'codex', mcp: 'stdio' });
    expect(plan.mcp).toBe('stdio');
    expect(plan.actions).toContain('plugin-package');
    expect(plan.actions).toContain('project-guidance');
    expect(plan.actions).not.toContain('http-control-plane');
  });

  it('treats HTTP as an explicit advanced transport', () => {
    const plan = buildSetupPlan({ agent: 'codex', mcp: 'http' });
    expect(plan.mcp).toBe('http');
    expect(plan.actions).toContain('http-control-plane');
  });

  it('lists plugin-capable setup targets', () => {
    expect(getSetupAgentTargets()).toContain('claude');
    expect(getSetupAgentTargets()).toContain('codex');
    expect(getSetupAgentTargets()).toContain('copilot');
    expect(getSetupAgentTargets()).toContain('cursor');
    expect(getSetupAgentTargets()).toContain('gemini-cli');
    expect(getSetupAgentTargets()).toContain('opencode');
    expect(getSetupAgentTargets()).toContain('pi');
  });

  it('uses official package or extension lanes where supported', () => {
    expect(buildSetupPlan({ agent: 'copilot', mcp: 'stdio' }).actions).toContain('plugin-package');
    expect(buildSetupPlan({ agent: 'cursor', mcp: 'stdio' }).actions).not.toContain('plugin-package');
    expect(buildSetupPlan({ agent: 'gemini-cli', mcp: 'stdio' }).actions).toContain('extension-package');
    expect(buildSetupPlan({ agent: 'opencode', mcp: 'stdio' }).actions).toContain('opencode-local-plugin');
    expect(buildSetupPlan({ agent: 'pi', mcp: 'none' }).actions).toContain('pi-package');
    expect(buildSetupPlan({ agent: 'windsurf', mcp: 'stdio' }).actions).not.toContain('plugin-package');
  });

  it('exposes a user-facing setup integration matrix', () => {
    const rows = getSetupIntegrationRows();
    expect(rows.find((row) => row.agent === 'copilot')).toMatchObject({
      entry: 'official-plugin',
      status: 'ready',
    });
    expect(rows.find((row) => row.agent === 'cursor')).toMatchObject({
      entry: 'official-config',
      status: 'ready',
    });
    expect(rows.find((row) => row.agent === 'gemini-cli')).toMatchObject({
      entry: 'official-extension',
      status: 'ready',
    });
    expect(rows.find((row) => row.agent === 'pi')).toMatchObject({
      entry: 'official-package',
      status: 'ready',
    });
    expect(rows.find((row) => row.agent === 'windsurf')).toMatchObject({
      entry: 'official-config',
      status: 'ready',
    });
  });
});

describe('plugin package installer', () => {
  it('installs the Codex plugin into a local marketplace', async () => {
    const tmpDir = makeTmpDir();
    try {
      const result = await installPluginPackage({
        agent: 'codex',
        homeDir: tmpDir,
      });

      const pluginManifest = path.join(tmpDir, '.codex', 'plugins', 'memorix', '.codex-plugin', 'plugin.json');
      const marketplace = path.join(tmpDir, '.agents', 'plugins', 'marketplace.json');
      const skillsRoot = path.join(tmpDir, '.codex', 'plugins', 'memorix', 'skills');

      expect(result.pluginPath).toBe(path.join(tmpDir, '.codex', 'plugins', 'memorix'));
      expect(result.marketplacePath).toBe(marketplace);
      expect(JSON.parse(await fs.readFile(pluginManifest, 'utf-8')).name).toBe('memorix');
      await expectOfficialSkills(skillsRoot);
      expect(await fs.readFile(path.join(skillsRoot, 'memorix-git-memory', 'SKILL.md'), 'utf-8')).toContain('Git Memory');

      const catalog = JSON.parse(await fs.readFile(marketplace, 'utf-8'));
      expect(catalog.name).toBe('personal');
      expect(catalog.plugins[0]).toMatchObject({
        name: 'memorix',
        source: { source: 'local', path: './.codex/plugins/memorix' },
        policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' },
        category: 'Developer Tools',
      });
    } finally {
      await cleanup(tmpDir);
    }
  });

  it('installs the Claude plugin package as a local marketplace', async () => {
    const tmpDir = makeTmpDir();
    try {
      const result = await installPluginPackage({
        agent: 'claude',
        homeDir: tmpDir,
      });

      const marketplaceRoot = path.join(tmpDir, '.claude', 'plugins', 'marketplaces', 'memorix-local');
      const marketplace = path.join(marketplaceRoot, '.claude-plugin', 'marketplace.json');
      const manifest = path.join(marketplaceRoot, 'plugins', 'memorix', '.claude-plugin', 'plugin.json');
      const skillsRoot = path.join(marketplaceRoot, 'plugins', 'memorix', 'skills');

      expect(result.pluginPath).toBe(path.join(marketplaceRoot, 'plugins', 'memorix'));
      expect(result.marketplacePath).toBe(marketplace);
      expect(result.marketplaceRoot).toBe(marketplaceRoot);
      const pluginManifest = JSON.parse(await fs.readFile(manifest, 'utf-8'));
      expect(pluginManifest.name).toBe('memorix');
      expect(pluginManifest.skills).toContain('./skills/memorix-troubleshooting');
      await expectOfficialSkills(skillsRoot);

      const catalog = JSON.parse(await fs.readFile(marketplace, 'utf-8'));
      expect(catalog.name).toBe('memorix-local');
      expect(catalog.plugins[0]).toMatchObject({
        name: 'memorix',
        source: './plugins/memorix',
        category: 'development',
      });
    } finally {
      await cleanup(tmpDir);
    }
  });

  it('installs the GitHub Copilot CLI plugin package', async () => {
    const tmpDir = makeTmpDir();
    try {
      const result = await installPluginPackage({
        agent: 'copilot',
        homeDir: tmpDir,
      });

      const pluginPath = path.join(tmpDir, '.copilot', 'plugins', 'local', 'memorix');
      const manifest = path.join(pluginPath, 'plugin.json');
      const mcpConfig = path.join(pluginPath, '.mcp.json');
      const hooksConfig = path.join(pluginPath, 'hooks', 'hooks.json');
      const skillsRoot = path.join(pluginPath, 'skills');

      expect(result.pluginPath).toBe(pluginPath);
      expect(JSON.parse(await fs.readFile(manifest, 'utf-8')).name).toBe('memorix');
      await expectOfficialSkills(skillsRoot);
      expect(JSON.parse(await fs.readFile(mcpConfig, 'utf-8')).mcpServers.memorix).toMatchObject({
        command: 'memorix',
        args: ['serve'],
      });
      expect(JSON.parse(await fs.readFile(hooksConfig, 'utf-8')).hooks.postToolUse[0]).toMatchObject({
        type: 'command',
      });
    } finally {
      await cleanup(tmpDir);
    }
  });

});

describe('extension package installer', () => {
  it('installs the Gemini CLI extension package into the official extension folder', async () => {
    const tmpDir = makeTmpDir();
    try {
      const result = await installGeminiExtensionPackage({
        homeDir: tmpDir,
      });

      const extensionPath = path.join(tmpDir, '.gemini', 'extensions', 'memorix');
      const manifest = path.join(extensionPath, 'gemini-extension.json');
      const contextFile = path.join(extensionPath, 'GEMINI.md');

      expect(result.extensionPath).toBe(extensionPath);
      expect(JSON.parse(await fs.readFile(manifest, 'utf-8'))).toMatchObject({
        name: 'memorix',
        contextFileName: 'GEMINI.md',
      });
      expect(await fs.readFile(contextFile, 'utf-8')).toContain('Memorix');
    } finally {
      await cleanup(tmpDir);
    }
  });

  it('installs the Pi coding-agent package template', async () => {
    const tmpDir = makeTmpDir();
    try {
      const packageDir = path.join(tmpDir, 'memorix-pi-package');
      const result = await installPiPackage({ packageDir });

      const manifest = path.join(packageDir, 'package.json');
      const extension = path.join(packageDir, 'extensions', 'memorix.js');
      const skill = path.join(packageDir, 'skills', 'memorix-memory', 'SKILL.md');
      const skillsRoot = path.join(packageDir, 'skills');

      expect(result.packagePath).toBe(packageDir);
      expect(JSON.parse(await fs.readFile(manifest, 'utf-8'))).toMatchObject({
        name: 'memorix-pi-package',
        pi: {
          extensions: ['./extensions'],
          skills: ['./skills'],
        },
      });
      expect(await fs.readFile(extension, 'utf-8')).toContain("hook_event_name: 'pi.tool_result'");
      expect(await fs.readFile(skill, 'utf-8')).toContain('name: memorix-memory');
      await expectOfficialSkills(skillsRoot);
    } finally {
      await cleanup(tmpDir);
    }
  });
});

describe('setup MCP config installer', () => {
  it('writes Cursor stdio MCP config without removing existing servers', async () => {
    const tmpDir = makeTmpDir();
    try {
      const configPath = path.join(tmpDir, '.cursor', 'mcp.json');
      await fs.mkdir(path.dirname(configPath), { recursive: true });
      await fs.writeFile(
        configPath,
        JSON.stringify({ mcpServers: { context7: { command: 'context7', args: [] } } }, null, 2),
        'utf-8',
      );

      const result = await installMcpConfig({ agent: 'cursor', projectRoot: tmpDir, mcp: 'stdio' });
      const config = JSON.parse(await fs.readFile(result.configPath, 'utf-8'));

      expect(result.configPath).toBe(configPath);
      expect(config.mcpServers.context7.command).toBe('context7');
      expect(config.mcpServers.memorix).toMatchObject({ command: 'memorix', args: ['serve'] });
    } finally {
      await cleanup(tmpDir);
    }
  });

  it('writes OpenCode local MCP config in opencode.json', async () => {
    const tmpDir = makeTmpDir();
    try {
      const result = await installMcpConfig({ agent: 'opencode', projectRoot: tmpDir, mcp: 'stdio' });
      const config = JSON.parse(await fs.readFile(result.configPath, 'utf-8'));

      expect(result.configPath).toBe(path.join(tmpDir, 'opencode.json'));
      expect(config.mcp.memorix).toMatchObject({
        type: 'local',
        command: ['memorix', 'serve'],
      });
    } finally {
      await cleanup(tmpDir);
    }
  });

  it('replaces only the Codex memorix TOML block', async () => {
    const tmpDir = makeTmpDir();
    try {
      const configPath = path.join(tmpDir, '.codex', 'config.toml');
      await fs.mkdir(path.dirname(configPath), { recursive: true });
      await fs.writeFile(
        configPath,
        [
          '[mcp_servers.other]',
          'command = "other"',
          'args = []',
          '',
          '[mcp_servers.memorix]',
          'command = "old"',
          'args = ["old"]',
          '',
        ].join('\n'),
        'utf-8',
      );

      const result = await installMcpConfig({ agent: 'codex', projectRoot: tmpDir, mcp: 'stdio' });
      const content = await fs.readFile(result.configPath, 'utf-8');

      expect(result.configPath).toBe(configPath);
      expect(content).toContain('[mcp_servers.other]');
      expect(content).toContain('command = "other"');
      expect(content).toContain('[mcp_servers.memorix]');
      expect(content).toContain('command = "memorix"');
      expect(content).toContain('args = ["serve"]');
      expect(content).not.toContain('command = "old"');
    } finally {
      await cleanup(tmpDir);
    }
  });
});
