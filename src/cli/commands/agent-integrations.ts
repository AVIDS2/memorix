import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { homedir } from 'node:os';
import type { MCPServerEntry } from '../../types.js';
import type { AgentName } from '../../hooks/types.js';
import { getAgentRulesPath, installAgentGuidance } from '../../hooks/installers/index.js';
import {
  getMcpAdapter,
  getSetupAgentTargets,
  installMcpConfig,
  type McpConfigAgent,
} from './setup.js';

export type AgentIntegrationScope = 'project' | 'global' | 'all';
export type AgentIntegrationStatus = 'ok' | 'missing' | 'repairable' | 'skipped';

export interface AgentMcpCheck {
  scope: Exclude<AgentIntegrationScope, 'all'>;
  path: string;
  exists: boolean;
  status: AgentIntegrationStatus;
  issues: string[];
  server?: {
    transport: 'stdio' | 'http';
    command?: string;
    args?: string[];
    url?: string;
    alwaysLoad?: boolean;
    envKeys?: string[];
  };
}

export interface AgentGuidanceCheck {
  scope: Exclude<AgentIntegrationScope, 'all'>;
  path: string;
  exists: boolean;
  status: AgentIntegrationStatus;
  issues: string[];
}

export interface AgentIntegrationEntry {
  agent: AgentName;
  mcp: {
    status: AgentIntegrationStatus;
    issues: string[];
    checks: AgentMcpCheck[];
  };
  guidance: {
    status: AgentIntegrationStatus;
    issues: string[];
    checks: AgentGuidanceCheck[];
  };
}

export interface AgentIntegrationReport {
  projectRoot: string;
  scope: AgentIntegrationScope;
  entries: AgentIntegrationEntry[];
  summary: {
    checked: number;
    ok: number;
    missing: number;
    repairable: number;
  };
  repairCommand: string;
}

export interface AgentRepairResult {
  projectRoot: string;
  scope: AgentIntegrationScope;
  changed: string[];
  skipped: string[];
  before: AgentIntegrationReport;
  after?: AgentIntegrationReport;
}

const GUIDANCE_AGENTS = new Set<AgentName>([
  'claude',
  'codex',
  'cursor',
  'windsurf',
  'copilot',
  'gemini-cli',
  'antigravity',
  'kiro',
  'opencode',
  'trae',
]);

function requestedAgents(agent?: string): AgentName[] {
  const all = getSetupAgentTargets();
  if (!agent || agent === 'all') return all;
  return all.includes(agent as AgentName) ? [agent as AgentName] : [];
}

function requestedScopes(scope?: string): Array<Exclude<AgentIntegrationScope, 'all'>> {
  if (scope === 'project' || scope === 'global') return [scope];
  return ['project', 'global'];
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function worstStatus(statuses: AgentIntegrationStatus[]): AgentIntegrationStatus {
  if (statuses.includes('repairable')) return 'repairable';
  if (statuses.includes('missing')) return 'missing';
  if (statuses.includes('ok')) return 'ok';
  return 'skipped';
}

function isMcpConfigAgent(agent: AgentName): agent is McpConfigAgent {
  return agent !== 'pi';
}

function looksLikeStaleMemorixCommand(server: MCPServerEntry): boolean {
  const text = [server.command, ...(server.args ?? [])].join(' ');
  return /[\\/]\.worktrees[\\/]/i.test(text) || /[\\/]dist[\\/]cli[\\/]index\.js/i.test(text);
}

function isRecommendedStdioServer(server: MCPServerEntry): boolean {
  const commandBase = basename(server.command).toLowerCase().replace(/\.(cmd|ps1|exe)$/i, '');
  return commandBase === 'memorix' && server.args?.[0] === 'serve';
}

function sanitizeServer(server: MCPServerEntry): AgentMcpCheck['server'] {
  if (server.url) {
    return {
      transport: 'http',
      url: server.url,
      envKeys: server.env ? Object.keys(server.env) : undefined,
    };
  }
  return {
    transport: 'stdio',
    command: server.command,
    args: server.args ?? [],
    alwaysLoad: server.alwaysLoad,
    envKeys: server.env ? Object.keys(server.env) : undefined,
  };
}

async function inspectMcp(agent: AgentName, projectRoot: string, scope: AgentIntegrationScope): Promise<AgentIntegrationEntry['mcp']> {
  if (!isMcpConfigAgent(agent)) {
    return { status: 'skipped', issues: ['mcp-managed-by-package'], checks: [] };
  }

  const adapter = getMcpAdapter(agent);
  const checks: AgentMcpCheck[] = [];

  for (const targetScope of requestedScopes(scope)) {
    const configPath = adapter.getConfigPath(targetScope === 'project' ? projectRoot : undefined);
    if (targetScope === 'global' && configPath === adapter.getConfigPath(projectRoot)) continue;

    if (!existsSync(configPath)) {
      checks.push({
        scope: targetScope,
        path: configPath,
        exists: false,
        status: 'missing',
        issues: ['mcp-config-missing'],
      });
      continue;
    }

    const content = await readFile(configPath, 'utf-8');
    const servers = adapter.parse(content);
    const server = servers.find((entry) => entry.name === 'memorix');
    if (!server) {
      checks.push({
        scope: targetScope,
        path: configPath,
        exists: true,
        status: 'repairable',
        issues: ['memorix-server-missing'],
      });
      continue;
    }

    const issues: string[] = [];
    if (!server.url && looksLikeStaleMemorixCommand(server)) issues.push('stale-command-path');
    if (!server.url && !isRecommendedStdioServer(server)) issues.push('nonstandard-mcp-command');
    if (agent === 'claude' && server.alwaysLoad !== true) issues.push('claude-always-load-missing');

    checks.push({
      scope: targetScope,
      path: configPath,
      exists: true,
      status: issues.length > 0 ? 'repairable' : 'ok',
      issues,
      server: sanitizeServer(server),
    });
  }

  return {
    status: worstStatus(checks.map((check) => check.status)),
    issues: unique(checks.flatMap((check) => check.issues)),
    checks,
  };
}

function isCurrentGuidance(content: string): boolean {
  return (
    content.includes('Memory Autopilot') &&
    content.includes('Default first step for non-trivial coding work') &&
    content.includes('memorix_project_context')
  );
}

async function inspectGuidance(agent: AgentName, projectRoot: string, scope: AgentIntegrationScope): Promise<AgentIntegrationEntry['guidance']> {
  if (!GUIDANCE_AGENTS.has(agent)) {
    return { status: 'skipped', issues: ['guidance-managed-by-package'], checks: [] };
  }

  const checks: AgentGuidanceCheck[] = [];
  for (const targetScope of requestedScopes(scope)) {
    const root = targetScope === 'project' ? projectRoot : homedir();
    const rulesPath = getAgentRulesPath(agent, root, targetScope === 'global');

    if (!existsSync(rulesPath)) {
      checks.push({
        scope: targetScope,
        path: rulesPath,
        exists: false,
        status: 'missing',
        issues: ['guidance-missing'],
      });
      continue;
    }

    const content = await readFile(rulesPath, 'utf-8');
    const issues = isCurrentGuidance(content) ? [] : ['guidance-outdated'];
    checks.push({
      scope: targetScope,
      path: rulesPath,
      exists: true,
      status: issues.length > 0 ? 'repairable' : 'ok',
      issues,
    });
  }

  return {
    status: worstStatus(checks.map((check) => check.status)),
    issues: unique(checks.flatMap((check) => check.issues)),
    checks,
  };
}

export async function inspectAgentIntegrations(options: {
  projectRoot?: string;
  agent?: string;
  scope?: string;
} = {}): Promise<AgentIntegrationReport> {
  const projectRoot = options.projectRoot ?? process.cwd();
  const scope = (options.scope === 'project' || options.scope === 'global' || options.scope === 'all')
    ? options.scope
    : 'all';
  const agents = requestedAgents(options.agent);
  const entries: AgentIntegrationEntry[] = [];

  for (const agent of agents) {
    entries.push({
      agent,
      mcp: await inspectMcp(agent, projectRoot, scope),
      guidance: await inspectGuidance(agent, projectRoot, scope),
    });
  }

  const entryStatuses = entries.map((entry) => worstStatus([entry.mcp.status, entry.guidance.status]));
  return {
    projectRoot,
    scope,
    entries,
    summary: {
      checked: entries.length,
      ok: entryStatuses.filter((status) => status === 'ok').length,
      missing: entryStatuses.filter((status) => status === 'missing').length,
      repairable: entryStatuses.filter((status) => status === 'repairable').length,
    },
    repairCommand: `memorix repair agents${options.agent ? ` --agent ${options.agent}` : ''}${scope === 'all' ? '' : ` --scope ${scope}`}`,
  };
}

export function formatAgentIntegrationReport(report: AgentIntegrationReport): string {
  const lines = [
    'Memorix Agent Doctor',
    `Project: ${report.projectRoot}`,
    `Scope: ${report.scope}`,
    '',
  ];

  for (const entry of report.entries) {
    const status = worstStatus([entry.mcp.status, entry.guidance.status]);
    lines.push(`${entry.agent}: ${status}`);
    if (entry.mcp.issues.length > 0) lines.push(`  MCP: ${entry.mcp.issues.join(', ')}`);
    if (entry.guidance.issues.length > 0) lines.push(`  Guidance: ${entry.guidance.issues.join(', ')}`);
  }

  lines.push('');
  lines.push(`Repair: ${report.repairCommand}`);
  return lines.join('\n');
}

export async function repairAgentIntegrations(options: {
  projectRoot?: string;
  agent?: string;
  scope?: string;
  dry?: boolean;
} = {}): Promise<AgentRepairResult> {
  const projectRoot = options.projectRoot ?? process.cwd();
  const scope = (options.scope === 'project' || options.scope === 'global' || options.scope === 'all')
    ? options.scope
    : 'all';
  const before = await inspectAgentIntegrations({ projectRoot, agent: options.agent, scope });
  const changed: string[] = [];
  const skipped: string[] = [];
  const canInstallMissing = Boolean(options.agent && scope !== 'all');

  for (const entry of before.entries) {
    if (isMcpConfigAgent(entry.agent)) {
      for (const check of entry.mcp.checks) {
        if (check.status === 'ok' || check.status === 'skipped') continue;
        if (check.status === 'missing' && !canInstallMissing) {
          skipped.push(`${entry.agent}:mcp:${check.scope}:missing`);
          continue;
        }
        if (!options.dry) {
          await installMcpConfig({
            agent: entry.agent,
            projectRoot,
            global: check.scope === 'global',
            mcp: 'stdio',
          });
        }
        changed.push(`${entry.agent}:mcp:${check.scope}`);
      }
    } else {
      skipped.push(`${entry.agent}:mcp`);
    }

    if (GUIDANCE_AGENTS.has(entry.agent)) {
      for (const check of entry.guidance.checks) {
        if (check.status === 'ok' || check.status === 'skipped') continue;
        if (check.status === 'missing' && !canInstallMissing) {
          skipped.push(`${entry.agent}:guidance:${check.scope}:missing`);
          continue;
        }
        if (!options.dry) {
          await installAgentGuidance(entry.agent, projectRoot, check.scope === 'global');
        }
        changed.push(`${entry.agent}:guidance:${check.scope}`);
      }
    } else {
      skipped.push(`${entry.agent}:guidance`);
    }
  }

  return {
    projectRoot,
    scope,
    changed,
    skipped,
    before,
    after: options.dry ? undefined : await inspectAgentIntegrations({ projectRoot, agent: options.agent, scope }),
  };
}

export function formatAgentRepairResult(result: AgentRepairResult): string {
  const lines = [
    'Memorix Agent Repair',
    `Project: ${result.projectRoot}`,
    `Scope: ${result.scope}`,
    '',
  ];

  if (result.changed.length === 0) {
    lines.push('No repairable agent integration issues found.');
  } else {
    lines.push('Changed:');
    for (const item of result.changed) lines.push(`- ${item}`);
  }

  if (result.skipped.length > 0) {
    lines.push('');
    lines.push('Skipped:');
    for (const item of result.skipped) lines.push(`- ${item}`);
  }

  return lines.join('\n');
}
