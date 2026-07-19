import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getCliVersion } from '../../src/cli/version.js';

import {
  buildSetupPlan,
  getSetupIntegrationRows,
  installAntigravityPluginPackage,
  installMcpConfig,
  installGeminiExtensionPackage,
  installHermesPluginPackage,
  installAgentSetup,
  installOmpPackage,
  installOpenClawBundlePackage,
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
  it('defaults to project-scoped stdio MCP without changing user plugins', () => {
    const plan = buildSetupPlan({ agent: 'codex', mcp: 'stdio' });
    expect(plan.mcp).toBe('stdio');
    expect(plan.actions).not.toContain('plugin-package');
    expect(plan.actions).toContain('project-guidance');
    expect(plan.actions).not.toContain('http-control-plane');
  });

  it('uses the user-level plugin package only when --global is requested', () => {
    for (const agent of ['claude', 'codex', 'copilot'] as const) {
      expect(buildSetupPlan({ agent, mcp: 'stdio', global: true }).actions).toContain('plugin-package');
      expect(buildSetupPlan({ agent, mcp: 'stdio', global: false }).actions).not.toContain('plugin-package');
    }
  });

  it('treats HTTP as an explicit advanced transport', () => {
    const plan = buildSetupPlan({ agent: 'codex', mcp: 'http' });
    expect(plan.mcp).toBe('http');
    expect(plan.actions).toContain('http-control-plane');
  });

  it('keeps Claude guidance while honoring --noHooks', async () => {
    const tmpDir = makeTmpDir();
    const originalCwd = process.cwd();
    try {
      process.chdir(tmpDir);
      const plan = buildSetupPlan({
        agent: 'claude',
        mcp: 'none',
        hooks: false,
        plugin: false,
      });

      await installAgentSetup('claude', plan, false);

      await expect(fs.readFile(path.join(tmpDir, 'CLAUDE.md'), 'utf-8'))
        .resolves.toContain('Memorix');
      await expect(fs.access(path.join(tmpDir, '.claude', 'settings.local.json')))
        .rejects.toThrow();
    } finally {
      process.chdir(originalCwd);
      await cleanup(tmpDir);
    }
  });

  it('lists plugin-capable setup targets', () => {
    expect(getSetupAgentTargets()).toContain('claude');
    expect(getSetupAgentTargets()).toContain('codex');
    expect(getSetupAgentTargets()).toContain('copilot');
    expect(getSetupAgentTargets()).toContain('cursor');
    expect(getSetupAgentTargets()).toContain('gemini-cli');
    expect(getSetupAgentTargets()).toContain('openclaw');
    expect(getSetupAgentTargets()).toContain('hermes');
    expect(getSetupAgentTargets()).toContain('omp');
    expect(getSetupAgentTargets()).toContain('opencode');
    expect(getSetupAgentTargets()).toContain('pi');
  });

  it('uses official package or extension lanes where supported', () => {
    expect(buildSetupPlan({ agent: 'copilot', mcp: 'stdio', global: true }).actions).toContain('plugin-package');
    expect(buildSetupPlan({ agent: 'cursor', mcp: 'stdio' }).actions).not.toContain('plugin-package');
    expect(buildSetupPlan({ agent: 'gemini-cli', mcp: 'stdio' }).actions).toContain('extension-package');
    expect(buildSetupPlan({ agent: 'opencode', mcp: 'stdio' }).actions).toContain('opencode-local-plugin');
    expect(buildSetupPlan({ agent: 'pi', mcp: 'none' }).actions).toContain('pi-package');
    expect(buildSetupPlan({ agent: 'windsurf', mcp: 'stdio' }).actions).not.toContain('plugin-package');
  });

  it('uses native package lanes for Antigravity, OpenClaw, Hermes, and Oh-my-Pi', () => {
    expect(buildSetupPlan({ agent: 'antigravity', mcp: 'stdio' }).actions).toContain('antigravity-plugin');
    expect(buildSetupPlan({ agent: 'openclaw', mcp: 'stdio' }).actions).toContain('openclaw-bundle');
    expect(buildSetupPlan({ agent: 'hermes', mcp: 'stdio' }).actions).toContain('hermes-plugin');
    expect(buildSetupPlan({ agent: 'omp', mcp: 'stdio' }).actions).toContain('omp-package');

    for (const agent of ['antigravity', 'openclaw', 'hermes', 'omp'] as const) {
      const plan = buildSetupPlan({ agent, mcp: 'stdio' });
      expect(plan.actions).toContain('mcp-stdio');
      expect(plan.actions).not.toContain('project-guidance');
      expect(plan.actions).not.toContain('hooks');
    }
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
    expect(rows.find((row) => row.agent === 'antigravity')).toMatchObject({
      entry: 'official-plugin',
      status: 'ready',
    });
    expect(rows.find((row) => row.agent === 'pi')).toMatchObject({
      entry: 'official-package',
      status: 'ready',
    });
    expect(rows.find((row) => row.agent === 'openclaw')).toMatchObject({
      entry: 'official-bundle',
      status: 'ready',
    });
    expect(rows.find((row) => row.agent === 'hermes')).toMatchObject({
      entry: 'official-plugin',
      status: 'ready',
    });
    expect(rows.find((row) => row.agent === 'omp')).toMatchObject({
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
      const hooksConfig = path.join(tmpDir, '.codex', 'plugins', 'memorix', 'hooks', 'hooks.json');
      const marketplace = path.join(tmpDir, '.agents', 'plugins', 'marketplace.json');
      const skillsRoot = path.join(tmpDir, '.codex', 'plugins', 'memorix', 'skills');

      expect(result.pluginPath).toBe(path.join(tmpDir, '.codex', 'plugins', 'memorix'));
      expect(result.marketplacePath).toBe(marketplace);
      const manifest = JSON.parse(await fs.readFile(pluginManifest, 'utf-8'));
      const hooks = JSON.parse(await fs.readFile(hooksConfig, 'utf-8'));
      expect(manifest.name).toBe('memorix');
      expect(manifest.version).toBe(getCliVersion());
      expect(manifest.hooks).toBe('./hooks/hooks.json');
      expect(hooks.hooks.SessionStart[0].hooks[0]).toMatchObject({
        command: 'memorix hook --agent codex',
        commandWindows: 'memorix.cmd hook --agent codex',
      });
      expect(hooks.hooks).toHaveProperty('PreCompact');
      expect(hooks.hooks).toHaveProperty('Stop');
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
      const mcpConfig = path.join(marketplaceRoot, 'plugins', 'memorix', '.mcp.json');
      const skillsRoot = path.join(marketplaceRoot, 'plugins', 'memorix', 'skills');

      expect(result.pluginPath).toBe(path.join(marketplaceRoot, 'plugins', 'memorix'));
      expect(result.marketplacePath).toBe(marketplace);
      expect(result.marketplaceRoot).toBe(marketplaceRoot);
      const pluginManifest = JSON.parse(await fs.readFile(manifest, 'utf-8'));
      expect(pluginManifest.name).toBe('memorix');
      expect(pluginManifest.skills).toContain('./skills/memorix-troubleshooting');
      expect(JSON.parse(await fs.readFile(mcpConfig, 'utf-8')).mcpServers.memorix).toMatchObject({
        command: 'memorix',
        args: ['serve'],
        alwaysLoad: true,
      });
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

  it('can install plugin packages without hook capture files', async () => {
    const tmpDir = makeTmpDir();
    try {
      const result = await installPluginPackage({
        agent: 'copilot',
        homeDir: tmpDir,
        includeHooks: false,
      });

      const pluginPath = result.pluginPath;
      const manifest = JSON.parse(await fs.readFile(path.join(pluginPath, 'plugin.json'), 'utf-8'));

      expect(manifest.hooks).toBeUndefined();
      await expect(fs.access(path.join(pluginPath, 'hooks', 'hooks.json'))).rejects.toThrow();
      await expectOfficialSkills(path.join(pluginPath, 'skills'));
      expect(JSON.parse(await fs.readFile(path.join(pluginPath, '.mcp.json'), 'utf-8')).mcpServers.memorix).toMatchObject({
        command: 'memorix',
        args: ['serve'],
      });
    } finally {
      await cleanup(tmpDir);
    }
  });

});

describe('extension package installer', () => {
  it('installs the Antigravity plugin package into the official plugin folder', async () => {
    const tmpDir = makeTmpDir();
    try {
      const result = await installAntigravityPluginPackage({
        homeDir: tmpDir,
        global: true,
      });
      const pluginPath = path.join(tmpDir, '.gemini', 'config', 'plugins', 'memorix');
      const hooks = JSON.parse(await fs.readFile(path.join(pluginPath, 'hooks.json'), 'utf-8'));

      expect(result.pluginPath).toBe(pluginPath);
      expect(JSON.parse(await fs.readFile(path.join(pluginPath, 'plugin.json'), 'utf-8'))).toMatchObject({
        name: 'memorix',
      });
      expect(JSON.parse(await fs.readFile(path.join(pluginPath, 'mcp_config.json'), 'utf-8')).mcpServers.memorix).toMatchObject({
        command: 'memorix',
        args: ['serve'],
      });
      expect(hooks.memorix.PreInvocation[0].command).toContain('--event PreInvocation');
      expect(hooks.memorix.PreToolUse[0].hooks[0].command).toContain('--event PreToolUse');
      expect(await fs.readFile(path.join(pluginPath, 'rules', 'memorix.md'), 'utf-8')).toContain('memorix_search');
      await expectOfficialSkills(path.join(pluginPath, 'skills'));
    } finally {
      await cleanup(tmpDir);
    }
  });

  it('installs the Antigravity plugin package into the workspace plugin folder', async () => {
    const tmpDir = makeTmpDir();
    try {
      const result = await installAntigravityPluginPackage({
        projectRoot: tmpDir,
        global: false,
        includeHooks: false,
      });
      const pluginPath = path.join(tmpDir, '.agents', 'plugins', 'memorix');

      expect(result.pluginPath).toBe(pluginPath);
      await expect(fs.access(path.join(pluginPath, 'hooks.json'))).rejects.toThrow();
      await expectOfficialSkills(path.join(pluginPath, 'skills'));
    } finally {
      await cleanup(tmpDir);
    }
  });

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

  it('installs the OpenClaw-compatible bundle package', async () => {
    const tmpDir = makeTmpDir();
    try {
      const result = await installOpenClawBundlePackage({ homeDir: tmpDir });
      const bundlePath = path.join(tmpDir, '.openclaw', 'extensions', 'memorix');
      const manifest = JSON.parse(await fs.readFile(path.join(bundlePath, '.codex-plugin', 'plugin.json'), 'utf-8'));
      const hookMetadata = await fs.readFile(path.join(bundlePath, 'hooks', 'memorix', 'HOOK.md'), 'utf-8');
      const hookHandler = await fs.readFile(path.join(bundlePath, 'hooks', 'memorix', 'handler.ts'), 'utf-8');

      expect(result.bundlePath).toBe(bundlePath);
      expect(manifest.name).toBe('memorix');
      expect(manifest.interface.capabilities).toContain('Hooks');
      expect(hookMetadata).toContain('name: memorix');
      expect(hookMetadata).toContain('agent:bootstrap');
      expect(hookHandler).toContain("memorix hook --agent openclaw");
      await expectOfficialSkills(path.join(bundlePath, 'skills'));
      expect(JSON.parse(await fs.readFile(path.join(bundlePath, '.mcp.json'), 'utf-8')).mcpServers.memorix).toMatchObject({
        command: 'memorix',
        args: ['serve'],
      });
    } finally {
      await cleanup(tmpDir);
    }
  });

  it('can install the OpenClaw-compatible bundle without hook capture files', async () => {
    const tmpDir = makeTmpDir();
    try {
      const result = await installOpenClawBundlePackage({ homeDir: tmpDir, includeHooks: false });
      const manifest = JSON.parse(await fs.readFile(path.join(result.bundlePath, '.codex-plugin', 'plugin.json'), 'utf-8'));

      expect(manifest.interface.capabilities).not.toContain('Hooks');
      await expect(fs.access(path.join(result.bundlePath, 'hooks'))).rejects.toThrow();
      await expectOfficialSkills(path.join(result.bundlePath, 'skills'));
    } finally {
      await cleanup(tmpDir);
    }
  });

  it('installs the Hermes plugin package and enables it in config.yaml', async () => {
    const tmpDir = makeTmpDir();
    try {
      const result = await installHermesPluginPackage({ homeDir: tmpDir });
      const pluginPath = path.join(tmpDir, '.hermes', 'plugins', 'memorix');
      const manifest = await fs.readFile(path.join(pluginPath, 'plugin.yaml'), 'utf-8');
      const pluginCode = await fs.readFile(path.join(pluginPath, '__init__.py'), 'utf-8');
      const config = await fs.readFile(path.join(tmpDir, '.hermes', 'config.yaml'), 'utf-8');

      expect(result.pluginPath).toBe(pluginPath);
      expect(manifest).toContain('name: memorix');
      expect(manifest).toContain('provides_hooks:');
      expect(pluginCode).toContain('ctx.register_hook("pre_llm_call"');
      expect(pluginCode).toContain('ctx.register_command("memorix"');
      expect(pluginCode).toContain('ctx.register_cli_command("memorix"');
      expect(pluginCode).toContain('ctx.register_skill(child.name, skill_md)');
      expect(config).toContain('enabled:');
      expect(config).toContain('- memorix');
      await expectOfficialSkills(path.join(pluginPath, 'skills'));
    } finally {
      await cleanup(tmpDir);
    }
  });

  it('installs the Oh-my-Pi extension package template with omp manifest fields', async () => {
    const tmpDir = makeTmpDir();
    try {
      const packageDir = path.join(tmpDir, 'memorix-omp-package');
      const result = await installOmpPackage({ packageDir });
      const manifest = JSON.parse(await fs.readFile(path.join(packageDir, 'package.json'), 'utf-8'));
      const extension = await fs.readFile(path.join(packageDir, 'extensions', 'memorix.js'), 'utf-8');

      expect(result.packagePath).toBe(packageDir);
      expect(manifest).toMatchObject({
        name: 'memorix-omp-package',
        omp: {
          extensions: ['./extensions/memorix.js'],
        },
      });
      expect(extension).toContain("hook_event_name: 'omp.tool_result'");
      expect(extension).toContain("pi.registerCommand('memorix'");
      await expectOfficialSkills(path.join(packageDir, 'skills'));
    } finally {
      await cleanup(tmpDir);
    }
  });

  it('uses the Pi user package directory for global setup', async () => {
    const tmpDir = makeTmpDir();
    try {
      const result = await installPiPackage({ homeDir: tmpDir, global: true });
      const packageDir = path.join(tmpDir, '.pi', 'agent', 'packages', 'memorix');

      expect(result.packagePath).toBe(packageDir);
      expect(result.installHint).toContain('pi install');
      expect(result.installHint).not.toContain(' -l ');
      expect(JSON.parse(await fs.readFile(path.join(packageDir, 'package.json'), 'utf-8')).name).toBe('memorix-pi-package');
      await expectOfficialSkills(path.join(packageDir, 'skills'));
    } finally {
      await cleanup(tmpDir);
    }
  });
});

describe('setup MCP config installer', () => {
  it('writes Claude stdio MCP config with official eager tool loading', async () => {
    const tmpDir = makeTmpDir();
    try {
      const result = await installMcpConfig({ agent: 'claude', projectRoot: tmpDir, mcp: 'stdio' });
      const config = JSON.parse(await fs.readFile(result.configPath, 'utf-8'));

      expect(result.configPath).toBe(path.join(tmpDir, '.claude', 'settings.json'));
      expect(config.mcpServers.memorix).toMatchObject({
        command: 'memorix',
        args: ['serve'],
        alwaysLoad: true,
      });
    } finally {
      await cleanup(tmpDir);
    }
  });

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
