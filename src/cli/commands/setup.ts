/**
 * CLI Command: memorix setup
 *
 * One command for installing the best available Memorix integration for an
 * agent host. Plugin-capable hosts receive plugin packages; other hosts get
 * host-native MCP config, rules, and hooks where supported.
 */

import { defineCommand } from 'citty';
import * as p from '@clack/prompts';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AgentName } from '../../hooks/types.js';
import type { MCPConfigAdapter, MCPServerEntry } from '../../types.js';
import { ClaudeCodeMCPAdapter } from '../../workspace/mcp-adapters/claude-code.js';
import { CodexMCPAdapter } from '../../workspace/mcp-adapters/codex.js';
import { CursorMCPAdapter } from '../../workspace/mcp-adapters/cursor.js';
import { WindsurfMCPAdapter } from '../../workspace/mcp-adapters/windsurf.js';
import { CopilotMCPAdapter } from '../../workspace/mcp-adapters/copilot.js';
import { AntigravityMCPAdapter } from '../../workspace/mcp-adapters/antigravity.js';
import { GeminiCLIMCPAdapter } from '../../workspace/mcp-adapters/gemini-cli.js';
import { KiroMCPAdapter } from '../../workspace/mcp-adapters/kiro.js';
import { OpenCodeMCPAdapter } from '../../workspace/mcp-adapters/opencode.js';
import { TraeMCPAdapter } from '../../workspace/mcp-adapters/trae.js';
import { getSetupIntegrationRows as readSetupIntegrationRows } from '../../integrations/registry.js';
import { OFFICIAL_MEMORIX_SKILLS } from '../../hooks/official-skills.js';
import { getCliVersion } from '../version.js';

export type SetupAgent = AgentName | 'all';
export type SetupMcpTransport = 'stdio' | 'http' | 'none';
export type SetupAction =
  | 'plugin-package'
  | 'extension-package'
  | 'pi-package'
  | 'project-guidance'
  | 'hooks'
  | 'mcp-stdio'
  | 'http-control-plane'
  | 'opencode-local-plugin';

export interface SetupPlan {
  agent: SetupAgent;
  mcp: SetupMcpTransport;
  actions: SetupAction[];
}

export interface PluginInstallOptions {
  agent: Extract<AgentName, 'claude' | 'codex' | 'copilot'>;
  homeDir?: string;
}

export interface PluginInstallResult {
  agent: 'claude' | 'codex' | 'copilot';
  pluginPath: string;
  marketplacePath?: string;
  marketplaceRoot?: string;
  installHint: string;
}

export interface GeminiExtensionInstallOptions {
  homeDir?: string;
}

export interface GeminiExtensionInstallResult {
  agent: 'gemini-cli';
  extensionPath: string;
  installHint: string;
}

export interface McpConfigInstallResult {
  agent: AgentName;
  configPath: string;
  transport: Exclude<SetupMcpTransport, 'none'>;
}

export interface PiPackageInstallOptions {
  packageDir?: string;
}

export interface PiPackageInstallResult {
  agent: 'pi';
  packagePath: string;
  installHint: string;
}

const PLUGIN_PACKAGE_AGENTS = new Set<AgentName>(['claude', 'codex', 'copilot']);
const EXTENSION_PACKAGE_AGENTS = new Set<AgentName>(['gemini-cli']);
const PI_PACKAGE_AGENTS = new Set<AgentName>(['pi']);
const SUPPORTED_SETUP_AGENTS: AgentName[] = [
  'claude',
  'codex',
  'opencode',
  'cursor',
  'windsurf',
  'copilot',
  'gemini-cli',
  'antigravity',
  'kiro',
  'trae',
  'pi',
];

export function getSetupAgentTargets(): AgentName[] {
  return [...SUPPORTED_SETUP_AGENTS];
}

export const getSetupIntegrationRows = readSetupIntegrationRows;

export function buildSetupPlan(options: {
  agent: SetupAgent;
  mcp?: SetupMcpTransport;
  hooks?: boolean;
  rules?: boolean;
  plugin?: boolean;
}): SetupPlan {
  const mcp = options.mcp ?? 'stdio';
  const actions: SetupAction[] = [];

  if (mcp === 'stdio') actions.push('mcp-stdio');
  if (mcp === 'http') actions.push('http-control-plane');

  const wantsPlugin = options.plugin ?? true;
  if (wantsPlugin && options.agent !== 'all') {
    if (options.agent === 'opencode') {
      actions.push('opencode-local-plugin');
    } else if (PLUGIN_PACKAGE_AGENTS.has(options.agent)) {
      actions.push('plugin-package');
    } else if (EXTENSION_PACKAGE_AGENTS.has(options.agent)) {
      actions.push('extension-package');
    } else if (PI_PACKAGE_AGENTS.has(options.agent)) {
      actions.push('pi-package');
    }
  }

  if (options.rules ?? true) actions.push('project-guidance');
  if (options.hooks ?? true) actions.push('hooks');

  return { agent: options.agent, mcp, actions };
}

function findPackageRoot(start = path.dirname(fileURLToPath(import.meta.url))): string {
  let dir = start;
  for (let i = 0; i < 8; i++) {
    if (
      existsSync(path.join(dir, 'package.json')) &&
      existsSync(path.join(dir, 'plugins'))
    ) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

async function copyDir(source: string, destination: string): Promise<void> {
  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });
  const entries = await readdir(source, { withFileTypes: true });
  for (const entry of entries) {
    const src = path.join(source, entry.name);
    const dest = path.join(destination, entry.name);
    if (entry.isDirectory()) {
      await copyDir(src, dest);
    } else {
      await mkdir(path.dirname(dest), { recursive: true });
      await copyFile(src, dest);
    }
  }
}

async function writeOfficialSkills(skillsRoot: string): Promise<string[]> {
  const written: string[] = [];
  for (const skill of OFFICIAL_MEMORIX_SKILLS) {
    const skillPath = path.join(skillsRoot, skill.name, 'SKILL.md');
    await mkdir(path.dirname(skillPath), { recursive: true });
    await writeFile(skillPath, skill.content, 'utf-8');
    written.push(skillPath);
  }
  return written;
}

function relativePosix(from: string, to: string): string {
  let rel = path.relative(from, to).replace(/\\/g, '/');
  if (!rel.startsWith('./') && !rel.startsWith('../')) rel = `./${rel}`;
  return rel;
}

type McpConfigAgent = Exclude<AgentName, 'pi'>;

function getMcpAdapter(agent: McpConfigAgent): MCPConfigAdapter {
  const adapters: Record<McpConfigAgent, MCPConfigAdapter> = {
    claude: new ClaudeCodeMCPAdapter(),
    codex: new CodexMCPAdapter(),
    cursor: new CursorMCPAdapter(),
    windsurf: new WindsurfMCPAdapter(),
    copilot: new CopilotMCPAdapter(),
    antigravity: new AntigravityMCPAdapter(),
    'gemini-cli': new GeminiCLIMCPAdapter(),
    kiro: new KiroMCPAdapter(),
    opencode: new OpenCodeMCPAdapter(),
    trae: new TraeMCPAdapter(),
  };
  return adapters[agent];
}

function buildMemorixServer(mcp: Exclude<SetupMcpTransport, 'none'>): MCPServerEntry {
  if (mcp === 'http') {
    return {
      name: 'memorix',
      command: '',
      args: [],
      url: 'http://localhost:3211/mcp',
    };
  }

  return {
    name: 'memorix',
    command: 'memorix',
    args: ['serve'],
  };
}

function mergeJsonMcpConfig(existingContent: string | null, generatedContent: string): string {
  let generated: Record<string, unknown>;
  try {
    generated = JSON.parse(generatedContent);
  } catch {
    return generatedContent.endsWith('\n') ? generatedContent : `${generatedContent}\n`;
  }

  let existing: Record<string, unknown> = {};
  try {
    existing = existingContent ? JSON.parse(existingContent) : {};
  } catch {
    existing = {};
  }

  const merged: Record<string, unknown> = { ...existing };
  for (const key of ['mcpServers', 'mcp_servers', 'servers', 'mcp'] as const) {
    const generatedValue = generated[key];
    if (generatedValue && typeof generatedValue === 'object' && !Array.isArray(generatedValue)) {
      const existingValue = existing[key];
      merged[key] = {
        ...(
          existingValue && typeof existingValue === 'object' && !Array.isArray(existingValue)
            ? existingValue as Record<string, unknown>
            : {}
        ),
        ...(generatedValue as Record<string, unknown>),
      };
    }
  }

  if (generated.$schema && !merged.$schema) merged.$schema = generated.$schema;
  return JSON.stringify(merged, null, 2) + '\n';
}

function removeTomlSection(content: string, section: string): string {
  const lines = content.split(/\r?\n/);
  const output: string[] = [];
  let skipping = false;
  const sectionHeader = `[${section}]`;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === sectionHeader) {
      skipping = true;
      continue;
    }
    if (skipping && trimmed.startsWith('[') && trimmed.endsWith(']')) {
      skipping = false;
    }
    if (!skipping) output.push(line);
  }

  return output.join('\n').trimEnd();
}

function mergeTomlMcpConfig(existingContent: string | null, generatedContent: string): string {
  let content = existingContent ?? '';
  content = removeTomlSection(content, 'mcp_servers.memorix.env');
  content = removeTomlSection(content, 'mcp_servers.memorix');
  const parts = [content.trimEnd(), generatedContent.trim()].filter(Boolean);
  return `${parts.join('\n\n')}\n`;
}

export async function installMcpConfig(options: {
  agent: McpConfigAgent;
  projectRoot?: string;
  global?: boolean;
  mcp: Exclude<SetupMcpTransport, 'none'>;
}): Promise<McpConfigInstallResult> {
  const adapter = getMcpAdapter(options.agent);
  const projectRoot = options.global ? undefined : (options.projectRoot ?? process.cwd());
  const configPath = adapter.getConfigPath(projectRoot);
  const server = buildMemorixServer(options.mcp);

  let existingContent: string | null = null;
  try {
    existingContent = await readFile(configPath, 'utf-8');
  } catch {
    existingContent = null;
  }

  const generated = adapter.generate([server]);
  const content = options.agent === 'codex'
    ? mergeTomlMcpConfig(existingContent, generated)
    : mergeJsonMcpConfig(existingContent, generated);

  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(configPath, content, 'utf-8');

  return { agent: options.agent, configPath, transport: options.mcp };
}

async function upsertCodexMarketplace(marketplacePath: string, pluginPath: string): Promise<void> {
  await mkdir(path.dirname(marketplacePath), { recursive: true });
  let catalog: {
    name: string;
    interface?: { displayName?: string };
    plugins: Array<Record<string, unknown>>;
  };
  try {
    catalog = JSON.parse(await readFile(marketplacePath, 'utf-8'));
    if (!Array.isArray(catalog.plugins)) catalog.plugins = [];
    if (!catalog.name) catalog.name = 'personal';
  } catch {
    catalog = {
      name: 'personal',
      interface: { displayName: 'Personal' },
      plugins: [],
    };
  }

  const marketplaceDir = path.dirname(marketplacePath);
  const agentsDir = path.dirname(marketplaceDir);
  const marketplaceRoot = path.basename(agentsDir) === '.agents'
    ? path.dirname(agentsDir)
    : marketplaceDir;
  const sourcePath = relativePosix(marketplaceRoot, pluginPath);
  const entry = {
    name: 'memorix',
    source: {
      source: 'local',
      path: sourcePath,
    },
    policy: {
      installation: 'AVAILABLE',
      authentication: 'ON_INSTALL',
    },
    category: 'Developer Tools',
  };

  const index = catalog.plugins.findIndex((plugin) => plugin.name === 'memorix');
  if (index >= 0) {
    catalog.plugins[index] = entry;
  } else {
    catalog.plugins.push(entry);
  }

  await writeFile(marketplacePath, JSON.stringify(catalog, null, 2) + '\n', 'utf-8');
}

async function writeClaudeMarketplace(marketplacePath: string): Promise<void> {
  await mkdir(path.dirname(marketplacePath), { recursive: true });
  const catalog = {
    $schema: 'https://anthropic.com/claude-code/marketplace.schema.json',
    name: 'memorix-local',
    description: 'Local marketplace for the Memorix Claude Code plugin.',
    owner: {
      name: 'AVIDS2',
      url: 'https://github.com/AVIDS2',
    },
    plugins: [
      {
        name: 'memorix',
        description: 'Shared workspace memory for Claude Code and other AI coding agents.',
        version: getCliVersion(),
        author: {
          name: 'AVIDS2',
          url: 'https://github.com/AVIDS2',
        },
        category: 'development',
        source: './plugins/memorix',
        homepage: 'https://github.com/AVIDS2/memorix#readme',
      },
    ],
  };
  await writeFile(marketplacePath, JSON.stringify(catalog, null, 2) + '\n', 'utf-8');
}

export async function installPluginPackage(options: PluginInstallOptions): Promise<PluginInstallResult> {
  const home = options.homeDir ?? homedir();
  const packageRoot = findPackageRoot();
  const source = path.join(packageRoot, 'plugins', options.agent, 'memorix');
  if (!existsSync(source)) {
    throw new Error(`Plugin package template not found: ${source}`);
  }

  if (options.agent === 'codex') {
    const pluginPath = path.join(home, '.codex', 'plugins', 'memorix');
    const marketplacePath = path.join(home, '.agents', 'plugins', 'marketplace.json');
    await copyDir(source, pluginPath);
    await writeOfficialSkills(path.join(pluginPath, 'skills'));
    await upsertCodexMarketplace(marketplacePath, pluginPath);
    return {
      agent: 'codex',
      pluginPath,
      marketplacePath,
      installHint: 'Start a new Codex thread so the plugin, MCP server, hooks, and skills load.',
    };
  }

  if (options.agent === 'copilot') {
    const pluginPath = path.join(home, '.copilot', 'plugins', 'local', 'memorix');
    await copyDir(source, pluginPath);
    await writeOfficialSkills(path.join(pluginPath, 'skills'));
    return {
      agent: 'copilot',
      pluginPath,
      installHint: 'Run `copilot plugin install <path>` if automatic install is unavailable, then restart Copilot CLI.',
    };
  }

  const marketplaceRoot = path.join(home, '.claude', 'plugins', 'marketplaces', 'memorix-local');
  const marketplacePath = path.join(marketplaceRoot, '.claude-plugin', 'marketplace.json');
  const pluginPath = path.join(marketplaceRoot, 'plugins', 'memorix');
  await copyDir(source, pluginPath);
  await writeOfficialSkills(path.join(pluginPath, 'skills'));
  await writeClaudeMarketplace(marketplacePath);
  return {
    agent: 'claude',
    pluginPath,
    marketplacePath,
    marketplaceRoot,
    installHint: 'Setup registers the local marketplace and installs `memorix@memorix-local`; restart Claude Code after install.',
  };
}

export async function installGeminiExtensionPackage(
  options: GeminiExtensionInstallOptions = {},
): Promise<GeminiExtensionInstallResult> {
  const home = options.homeDir ?? homedir();
  const packageRoot = findPackageRoot();
  const source = path.join(packageRoot, 'plugins', 'gemini', 'memorix');
  if (!existsSync(source)) {
    throw new Error(`Gemini extension template not found: ${source}`);
  }

  const extensionPath = path.join(home, '.gemini', 'extensions', 'memorix');
  await copyDir(source, extensionPath);
  return {
    agent: 'gemini-cli',
    extensionPath,
    installHint: 'Restart Gemini CLI or run `gemini extensions list` to confirm the Memorix extension is loaded.',
  };
}

export async function installPiPackage(options: PiPackageInstallOptions = {}): Promise<PiPackageInstallResult> {
  const packageRoot = findPackageRoot();
  const source = path.join(packageRoot, 'plugins', 'pi', 'memorix');
  if (!existsSync(source)) {
    throw new Error(`Pi package template not found: ${source}`);
  }

  const packagePath = options.packageDir ?? path.join(process.cwd(), '.pi', 'packages', 'memorix');
  await copyDir(source, packagePath);
  await writeOfficialSkills(path.join(packagePath, 'skills'));
  return {
    agent: 'pi',
    packagePath,
    installHint: `Setup runs \`pi install "${packagePath}" -l --approve\`. If Pi is unavailable, run that command from the project root after installing Pi.`,
  };
}

function tryInstallClaudePlugin(marketplaceRoot: string): { ok: boolean; message: string } {
  const add = spawnSync('claude', ['plugin', 'marketplace', 'add', marketplaceRoot], {
    encoding: 'utf-8',
    stdio: 'pipe',
    shell: process.platform === 'win32',
  });

  const alreadyAdded = `${add.stderr || ''}\n${add.stdout || ''}`.toLowerCase().includes('already');
  if (add.status !== 0 && !alreadyAdded) {
    const detail = (add.stderr || add.stdout || add.error?.message || '').trim();
    return {
      ok: false,
      message: detail
        ? `claude: local marketplace written, but automatic marketplace registration did not finish: ${detail}`
        : `claude: local marketplace written. Run \`claude plugin marketplace add "${marketplaceRoot}"\`, then \`claude plugin install memorix@memorix-local\`.`,
    };
  }

  const install = spawnSync('claude', ['plugin', 'install', 'memorix@memorix-local'], {
    encoding: 'utf-8',
    stdio: 'pipe',
    shell: process.platform === 'win32',
  });

  const installOutput = `${install.stderr || ''}\n${install.stdout || ''}`.toLowerCase();
  if (install.status === 0) {
    return { ok: true, message: 'claude: plugin installed from memorix-local marketplace' };
  }
  if (installOutput.includes('already')) {
    return { ok: true, message: 'claude: plugin already installed from memorix-local marketplace' };
  }

  const installDetail = (install.stderr || install.stdout || install.error?.message || '').trim();
  return {
    ok: false,
    message: installDetail
      ? `claude: marketplace registered, but automatic plugin install did not finish: ${installDetail}`
      : 'claude: marketplace registered. Run `claude plugin install memorix@memorix-local`.',
  };
}

function tryInstallCodexPlugin(): { ok: boolean; message: string } {
  const result = spawnSync('codex', ['plugin', 'add', 'memorix@personal', '--json'], {
    encoding: 'utf-8',
    stdio: 'pipe',
    shell: process.platform === 'win32',
  });

  if (result.status === 0) {
    return { ok: true, message: 'codex: plugin installed from Personal marketplace' };
  }

  const output = `${result.stderr || ''}\n${result.stdout || ''}`.toLowerCase();
  if (output.includes('already')) {
    return { ok: true, message: 'codex: plugin already installed from Personal marketplace' };
  }

  const detail = (result.stderr || result.stdout || result.error?.message || '').trim();
  return {
    ok: false,
    message: detail
      ? `codex: plugin package registered, but automatic install did not finish: ${detail}`
      : 'codex: plugin package registered, but automatic install did not finish. Run `codex plugin add memorix@personal`.',
  };
}

function tryInstallCopilotPlugin(pluginPath: string): { ok: boolean; message: string } {
  const result = spawnSync('copilot', ['plugin', 'install', pluginPath], {
    encoding: 'utf-8',
    stdio: 'pipe',
    shell: process.platform === 'win32',
  });

  if (result.status === 0) {
    return { ok: true, message: 'copilot: plugin installed from local package path' };
  }

  const output = `${result.stderr || ''}\n${result.stdout || ''}`.toLowerCase();
  if (output.includes('already')) {
    return { ok: true, message: 'copilot: plugin already installed from local package path' };
  }

  const detail = (result.stderr || result.stdout || result.error?.message || '').trim();
  return {
    ok: false,
    message: detail
      ? `copilot: plugin package written, but automatic install did not finish: ${detail}`
      : `copilot: plugin package written. Run \`copilot plugin install "${pluginPath}"\`.`,
  };
}

function tryInstallPiPackage(packagePath: string): { ok: boolean; message: string } {
  const result = spawnSync('pi', ['install', packagePath, '-l', '--approve'], {
    encoding: 'utf-8',
    stdio: 'pipe',
    shell: process.platform === 'win32',
  });

  if (result.status === 0) {
    return { ok: true, message: 'pi: package installed into project .pi/settings.json' };
  }

  const output = `${result.stderr || ''}\n${result.stdout || ''}`.toLowerCase();
  if (output.includes('already') || output.includes('no changes')) {
    return { ok: true, message: 'pi: package already registered in project settings' };
  }

  const detail = (result.stderr || result.stdout || result.error?.message || '').trim();
  return {
    ok: false,
    message: detail
      ? `pi: package written, but automatic install did not finish: ${detail}`
      : `pi: package written. Run \`pi install "${packagePath}" -l --approve\`.`,
  };
}

async function installAgentSetup(agent: AgentName, plan: SetupPlan, global: boolean): Promise<void> {
  const { installAgentGuidance, installHooks } = await import('../../hooks/installers/index.js');
  const targetRoot = global ? homedir() : process.cwd();
  const hasPluginPackage = plan.actions.includes('plugin-package') && PLUGIN_PACKAGE_AGENTS.has(agent);
  const hasExtensionPackage = plan.actions.includes('extension-package') && agent === 'gemini-cli';
  const hasPiPackage = plan.actions.includes('pi-package') && agent === 'pi';
  const wantsMcpConfig = plan.mcp !== 'none' && agent !== 'pi';

  if (hasPluginPackage) {
    const result = await installPluginPackage({ agent: agent as PluginInstallOptions['agent'] });
    p.log.success(`${agent}: plugin package -> ${result.pluginPath}`);
    if (result.marketplacePath) {
      p.log.info(`${agent}: marketplace -> ${result.marketplacePath}`);
    }
    if (agent === 'codex') {
      const install = tryInstallCodexPlugin();
      if (install.ok) p.log.success(install.message);
      else p.log.warn(install.message);
    } else if (agent === 'claude' && result.marketplaceRoot) {
      const install = tryInstallClaudePlugin(result.marketplaceRoot);
      if (install.ok) p.log.success(install.message);
      else p.log.warn(install.message);
    } else if (agent === 'copilot') {
      const install = tryInstallCopilotPlugin(result.pluginPath);
      if (install.ok) p.log.success(install.message);
      else p.log.warn(install.message);
    }
    p.log.info(result.installHint);
  }

  if (hasExtensionPackage) {
    const result = await installGeminiExtensionPackage();
    p.log.success(`${agent}: extension package -> ${result.extensionPath}`);
    p.log.info(result.installHint);
  }

  if (hasPiPackage) {
    const result = await installPiPackage();
    p.log.success(`${agent}: package -> ${result.packagePath}`);
    const install = tryInstallPiPackage(result.packagePath);
    if (install.ok) p.log.success(install.message);
    else p.log.warn(install.message);
    p.log.info(result.installHint);
  }

  if (wantsMcpConfig) {
    if ((hasPluginPackage || hasExtensionPackage) && plan.mcp === 'stdio') {
      p.log.info(`${agent}: stdio MCP is bundled in the ${hasExtensionPackage ? 'extension package' : 'plugin package'}`);
    } else {
      const mcp = plan.mcp === 'http' ? 'http' : 'stdio';
      const result = await installMcpConfig({ agent: agent as McpConfigAgent, projectRoot: targetRoot, global, mcp });
      p.log.success(`${agent}: MCP config -> ${result.configPath}`);
    }
  }

  if (hasPluginPackage) {
    if (plan.actions.includes('project-guidance') && (agent === 'claude' || agent === 'codex')) {
      const rulesPath = await installAgentGuidance(agent, targetRoot, global);
      p.log.success(`${agent}: guidance -> ${rulesPath}`);
    } else {
      p.log.info(`${agent}: guidance and hooks are bundled in the plugin package`);
    }
  } else if (hasPiPackage) {
    p.log.info(`${agent}: extension and skill are bundled in the Pi package`);
  } else if (hasExtensionPackage) {
    if (plan.actions.includes('hooks') || plan.actions.includes('project-guidance')) {
      const result = await installHooks(agent, targetRoot, global);
      p.log.success(`${agent}: integration files -> ${result.configPath}`);
    }
  } else if (agent === 'opencode' || plan.actions.includes('hooks') || plan.actions.includes('project-guidance')) {
    const result = await installHooks(agent, targetRoot, global);
    p.log.success(`${agent}: integration files -> ${result.configPath}`);
  }

  if (agent === 'pi') {
    p.log.info('pi: Pi has no MCP config lane in the current CLI; use the installed package extension and skill.');
  } else if (plan.mcp === 'stdio') {
    p.log.info(`${agent}: MCP server command is \`memorix serve\``);
  } else if (plan.mcp === 'http') {
    p.log.info(`${agent}: start HTTP MCP with \`memorix background start\` and use http://localhost:3211/mcp`);
  }
}

function parseMcp(raw: unknown): SetupMcpTransport {
  const value = String(raw || 'stdio').toLowerCase();
  if (value === 'stdio' || value === 'http' || value === 'none') return value;
  throw new Error('--mcp must be one of: stdio, http, none');
}

function printSetupIntegrationRows(): void {
  const rows = getSetupIntegrationRows();
  const table = [
    'Agent                  Entry                Status   Install',
    '-----                  -----                ------   -------',
    ...rows.map((row) => [
      row.name.padEnd(22),
      row.entry.padEnd(20),
      row.status.padEnd(8),
      row.install,
    ].join('')),
  ].join('\n');
  p.note(table, 'Memorix integrations');
}

export default defineCommand({
  meta: {
    name: 'setup',
    description: 'Install the best Memorix integration package for an agent',
  },
  args: {
    agent: {
      type: 'string',
      description: 'Target agent (claude, codex, opencode, cursor, windsurf, copilot, gemini-cli, antigravity, kiro, trae, pi, all)',
      required: false,
    },
    mcp: {
      type: 'string',
      description: 'MCP transport to document/configure: stdio, http, or none',
      required: false,
      default: 'stdio',
    },
    global: {
      type: 'boolean',
      description: 'Install global hooks/rules where the target supports them',
      required: false,
    },
    noHooks: {
      type: 'boolean',
      description: 'Skip hook installation',
      required: false,
    },
    noRules: {
      type: 'boolean',
      description: 'Skip generated project guidance',
      required: false,
    },
    noPlugin: {
      type: 'boolean',
      description: 'Skip plugin package installation',
      required: false,
    },
    list: {
      type: 'boolean',
      description: 'List supported agent entrypoints',
      required: false,
    },
  },
  run: async ({ args }) => {
    if (args.list) {
      printSetupIntegrationRows();
      return;
    }

    let mcp: SetupMcpTransport;
    try {
      mcp = parseMcp(args.mcp);
    } catch (error) {
      p.log.error(error instanceof Error ? error.message : String(error));
      return;
    }

    let selectedAgent = args.agent as SetupAgent | undefined;
    if (!selectedAgent) {
      const selected = await p.select({
        message: 'Install Memorix for which agent?',
        options: [
          { value: 'claude', label: 'Claude Code', hint: 'plugin package + hooks + MCP' },
          { value: 'codex', label: 'Codex', hint: 'plugin package + marketplace + MCP' },
          { value: 'copilot', label: 'GitHub Copilot CLI', hint: 'plugin package + hooks + MCP' },
          { value: 'cursor', label: 'Cursor', hint: 'MCP + rules + skills' },
          { value: 'gemini-cli', label: 'Gemini CLI', hint: 'extension + MCP' },
          { value: 'pi', label: 'Pi coding agent', hint: 'package + extension + skill' },
          { value: 'opencode', label: 'OpenCode', hint: 'local plugin + AGENTS.md + MCP' },
          { value: 'windsurf', label: 'Windsurf', hint: 'rules + hooks + MCP' },
          { value: 'all', label: 'All supported agents', hint: 'install detected-compatible files' },
        ],
      });
      if (p.isCancel(selected)) {
        p.outro('Cancelled.');
        return;
      }
      selectedAgent = selected as SetupAgent;
    }

    if (selectedAgent !== 'all' && !SUPPORTED_SETUP_AGENTS.includes(selectedAgent as AgentName)) {
      p.log.error(`Unsupported agent: ${selectedAgent}`);
      return;
    }

    const targets = selectedAgent === 'all'
      ? SUPPORTED_SETUP_AGENTS
      : [selectedAgent as AgentName];

    p.intro('Memorix Setup');
    for (const agent of targets) {
      const plan = buildSetupPlan({
        agent,
        mcp,
        hooks: !args.noHooks,
        rules: !args.noRules,
        plugin: !args.noPlugin,
      });
      await installAgentSetup(agent, plan, Boolean(args.global));
    }

    p.outro('Setup finished. Restart the target agent so it can load new plugins, MCP servers, rules, or hooks.');
  },
});
