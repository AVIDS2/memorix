import type { AgentName } from '../hooks/types.js';

export type IntegrationEntry =
  | 'official-plugin'
  | 'official-extension'
  | 'official-package'
  | 'official-bundle'
  | 'local-plugin'
  | 'official-config'
  | 'native'
  | 'mcp-fallback';

export type IntegrationStatus = 'ready' | 'planned';
export type IntegrationTransport = 'stdio' | 'http';
export type IntegrationScope = 'project' | 'global';
export type IntegrationLifecycleAction = 'install' | 'repair' | 'doctor' | 'uninstall';

export interface IntegrationCapabilityManifest {
  schemaVersion: '1';
  agent: AgentName | 'memcode' | 'any-mcp';
  name: string;
  transport: {
    supported: IntegrationTransport[];
    default: IntegrationTransport | 'host-owned' | 'none';
    command?: string;
  };
  artifacts: {
    packageFiles: string[];
    hookFiles: string[];
    ruleFiles: string[];
    skillFiles: string[];
    guidanceFiles: string[];
  };
  hooks: {
    supported: boolean;
    events: string[];
  };
  scopes: IntegrationScope[];
  lifecycle: Record<IntegrationLifecycleAction, boolean>;
  hostCompatibility: {
    range: string;
    verified: boolean;
  };
  requirements: {
    projectRoot: boolean;
    http: boolean;
    stdio: boolean;
    credential: boolean;
  };
  source: {
    registry: 'src/integrations/registry.ts';
    generatedBy: string[];
    documentation: string[];
  };
}

export interface MemorixIntegration {
  agent: AgentName | 'memcode' | 'any-mcp';
  name: string;
  entry: IntegrationEntry;
  status: IntegrationStatus;
  install: string;
  surfaces: string[];
  /** False for agents that are in the registry but use a narrower installer. */
  setup?: boolean;
  capabilities: IntegrationCapabilityManifest;
  note?: string;
}

export interface SetupIntegrationRow {
  agent: AgentName;
  name: string;
  entry: IntegrationEntry;
  status: IntegrationStatus;
  install: string;
  surfaces: string;
}

const integrationEntries: Array<Omit<MemorixIntegration, 'capabilities'>> = [
  {
    agent: 'claude',
    name: 'Claude Code',
    entry: 'official-plugin',
    status: 'ready',
    install: 'memorix setup --agent claude',
    surfaces: ['MCP', 'skills', 'hooks', 'local marketplace'],
  },
  {
    agent: 'codex',
    name: 'Codex',
    entry: 'official-plugin',
    status: 'ready',
    install: 'memorix setup --agent codex',
    surfaces: ['MCP', 'skills', 'hooks', 'Personal marketplace'],
  },
  {
    agent: 'codebuddy',
    name: 'CodeBuddy Code',
    entry: 'official-plugin',
    status: 'ready',
    install: 'memorix setup --agent codebuddy --global',
    surfaces: ['MCP', 'skills', 'hooks', 'local marketplace'],
    note: 'Uses CodeBuddy\'s official .codebuddy-plugin marketplace package and leaves existing settings untouched.',
  },
  {
    agent: 'copilot',
    name: 'GitHub Copilot CLI',
    entry: 'official-plugin',
    status: 'ready',
    install: 'memorix setup --agent copilot',
    surfaces: ['MCP', 'skills', 'hooks'],
  },
  {
    agent: 'grok',
    name: 'Grok Build',
    entry: 'official-config',
    status: 'ready',
    install: 'memorix setup --agent grok --global',
    surfaces: ['hooks', 'AGENTS.md'],
    note: 'Writes ~/.grok/hooks/memorix.json and leaves Grok MCP host-owned by default. Pass --mcp http to write [mcp_servers.memorix] in Grok config.toml.',
  },
  {
    agent: 'qwen',
    name: 'Qwen Code',
    entry: 'official-config',
    status: 'ready',
    setup: false,
    install: 'memorix hooks install --agent qwen',
    surfaces: ['hooks', 'QWEN.md guidance'],
    note: 'Qwen uses the hook installer lane; it is intentionally excluded from the full setup command until a native MCP/package lane exists.',
  },
  {
    agent: 'cursor',
    name: 'Cursor',
    entry: 'official-config',
    status: 'ready',
    install: 'memorix setup --agent cursor',
    surfaces: ['MCP', 'rules', 'skills', 'hooks'],
  },
  {
    agent: 'gemini-cli',
    name: 'Gemini CLI',
    entry: 'official-extension',
    status: 'ready',
    install: 'memorix setup --agent gemini-cli',
    surfaces: ['MCP', 'GEMINI.md context', 'hooks', 'skills'],
    note: 'Antigravity CLI has an official Gemini CLI migration path, but Gemini CLI remains an active standalone Google CLI target.',
  },
  {
    agent: 'opencode',
    name: 'OpenCode',
    entry: 'local-plugin',
    status: 'ready',
    install: 'memorix setup --agent opencode',
    surfaces: ['MCP', 'local plugin file', 'skills', 'AGENTS.md'],
  },
  {
    agent: 'openclaw',
    name: 'OpenClaw',
    entry: 'official-bundle',
    status: 'ready',
    install: 'memorix setup --agent openclaw',
    surfaces: ['MCP', 'skills', 'OpenClaw hook pack', 'compatible bundle'],
    note: 'OpenClaw support installs a compatible bundle with .mcp.json, skills, and OpenClaw-style HOOK.md/handler.ts hooks.',
  },
  {
    agent: 'hermes',
    name: 'Hermes Agent',
    entry: 'official-plugin',
    status: 'ready',
    install: 'memorix setup --agent hermes',
    surfaces: ['MCP', 'plugin', 'hooks', 'slash command', 'CLI command', 'skills'],
    note: 'Hermes support installs plugins/memorix under Hermes home, enables it in config.yaml, and keeps MCP in the official mcp_servers YAML format.',
  },
  {
    agent: 'omp',
    name: 'Oh-my-Pi',
    entry: 'official-package',
    status: 'ready',
    install: 'memorix setup --agent omp',
    surfaces: ['MCP', 'omp.extensions package', 'slash command', 'skills'],
    note: 'Oh-my-Pi support installs an omp.extensions package and writes .omp/mcp.json for projects or ~/.omp/agent/mcp.json for global setup.',
  },
  {
    agent: 'windsurf',
    name: 'Windsurf',
    entry: 'official-config',
    status: 'ready',
    install: 'memorix setup --agent windsurf',
    surfaces: ['MCP', 'rules', 'hooks'],
  },
  {
    agent: 'kiro',
    name: 'Kiro',
    entry: 'official-config',
    status: 'ready',
    install: 'memorix setup --agent kiro',
    surfaces: ['MCP', 'steering', 'hooks'],
  },
  {
    agent: 'antigravity',
    name: 'Antigravity',
    entry: 'official-plugin',
    status: 'ready',
    install: 'memorix setup --agent antigravity',
    surfaces: ['MCP', 'plugin', 'hooks', 'skills', 'rules'],
    note: 'Antigravity support installs a native plugin with plugin.json, mcp_config.json, hooks.json, skills, and rules under the official plugin directories.',
  },
  {
    agent: 'trae',
    name: 'Trae',
    entry: 'official-config',
    status: 'ready',
    install: 'memorix setup --agent trae',
    surfaces: ['MCP', 'rules'],
  },
  {
    agent: 'dsh',
    name: 'DeepSeek Harness',
    entry: 'official-config',
    status: 'ready',
    install: 'memorix setup --agent dsh',
    surfaces: ['MCP', 'AGENTS.md', 'skills'],
    note: 'DeepSeek Harness support writes a @deepseek-ai/dsh-mcp-client row into $DSH_HOME/cordis.patch.yml (default ~/.dsh/cordis.patch.yml), guidance into the harness AGENTS.md, and skills under $DSH_HOME/skills.',
  },
  {
    agent: 'workbuddy',
    name: 'WorkBuddy',
    entry: 'official-config',
    status: 'ready',
    install: 'memorix setup --agent workbuddy',
    surfaces: ['MCP', 'AGENTS.md'],
    note: 'WorkBuddy support writes a memorix MCP server row into ~/.workbuddy/mcp.json (or <project>/.workbuddy/mcp.json for project installs) and guidance into AGENTS.md.',
  },
  {
    agent: 'memcode',
    name: 'memcode',
    entry: 'native',
    status: 'ready',
    install: 'memorix memcode',
    surfaces: ['native agent', 'Memorix runtime'],
  },
  {
    agent: 'pi',
    name: 'pi coding agent',
    entry: 'official-package',
    status: 'ready',
    install: 'memorix setup --agent pi',
    surfaces: ['MCP', 'Pi package', 'extension API', 'skills', 'hooks'],
    note: 'Requires Pi 1.0+. Uses native .pi/mcp.json or ~/.pi/agent/mcp.json alongside the extension/skills package.',
  },
  {
    agent: 'any-mcp',
    name: 'Any MCP client',
    entry: 'mcp-fallback',
    status: 'ready',
    install: 'memorix serve',
    surfaces: ['MCP stdio'],
  },
];

const PACKAGE_ENTRIES = new Set<IntegrationEntry>([
  'official-plugin',
  'official-extension',
  'official-package',
  'official-bundle',
  'local-plugin',
]);

const DEFAULT_HOOK_EVENTS = ['session_start', 'user_prompt', 'post_tool', 'pre_compact', 'session_end'];

function packageRoot(agent: MemorixIntegration['agent']): string {
  return agent === 'gemini-cli' ? 'plugins/gemini/memorix' : `plugins/${agent}/memorix`;
}

function capabilityManifest(entry: Omit<MemorixIntegration, 'capabilities'>): IntegrationCapabilityManifest {
  const lowerSurfaces = entry.surfaces.map(surface => surface.toLowerCase());
  const hasMcp = entry.agent === 'grok' || lowerSurfaces.some(surface => surface.includes('mcp'));
  const hasHooks = lowerSurfaces.some(surface => surface.includes('hook'));
  const hasRules = lowerSurfaces.some(surface => (
    surface.includes('rule') || surface.includes('steering') || surface.includes('guidance')
  ));
  const hasSkills = lowerSurfaces.some(surface => surface.includes('skill'));
  const hasGuidance = hasRules || lowerSurfaces.some(surface => (
    surface.includes('agents.md') || surface.includes('context') || surface.includes('gemini')
  ));
  const supported: IntegrationTransport[] = hasMcp
    ? entry.agent === 'grok' ? ['http'] : ['stdio', 'http']
    : [];
  const defaultTransport = entry.agent === 'grok'
    ? 'host-owned' as const
    : supported.includes('stdio')
      ? 'stdio' as const
      : 'none' as const;
  const generatedBy = [
    'src/integrations/registry.ts',
    ...(hasMcp ? ['src/workspace/mcp-adapters/' + entry.agent + '.ts'] : []),
    ...(hasHooks || hasRules || hasSkills ? ['src/hooks/installers/index.ts'] : []),
    ...(entry.agent !== 'any-mcp' && entry.agent !== 'memcode' ? ['src/cli/commands/setup.ts'] : []),
  ];
  const packageFiles = PACKAGE_ENTRIES.has(entry.entry)
    ? [packageRoot(entry.agent)]
    : [];
  const hookFiles = hasHooks ? [entry.agent === 'qwen' ? '.qwen/settings.json' : 'host hook configuration'] : [];
  const ruleFiles = hasRules ? ['host rules or steering file'] : [];
  const skillFiles = hasSkills ? ['official Memorix skills'] : [];
  const guidanceFiles = hasGuidance ? ['host guidance file'] : [];

  return {
    schemaVersion: '1',
    agent: entry.agent,
    name: entry.name,
    transport: {
      supported,
      default: defaultTransport,
      ...(defaultTransport === 'stdio' ? { command: 'memorix serve' } : {}),
    },
    artifacts: { packageFiles, hookFiles, ruleFiles, skillFiles, guidanceFiles },
    hooks: { supported: hasHooks, events: hasHooks ? [...DEFAULT_HOOK_EVENTS] : [] },
    scopes: ['project', 'global'],
    lifecycle: {
      install: true,
      repair: entry.setup !== false,
      doctor: entry.setup !== false,
      uninstall: true,
    },
    hostCompatibility: {
      range: entry.agent === 'memcode' ? 'Memorix runtime' : 'unknown',
      verified: entry.agent === 'memcode',
    },
    requirements: {
      projectRoot: entry.agent !== 'any-mcp',
      http: supported.includes('http'),
      stdio: supported.includes('stdio'),
      credential: false,
    },
    source: {
      registry: 'src/integrations/registry.ts',
      generatedBy,
      documentation: ['docs/INTEGRATIONS.md', 'docs/API_REFERENCE.md'],
    },
  };
}

export const MEMORIX_INTEGRATIONS: MemorixIntegration[] = integrationEntries.map((entry) => ({
  ...entry,
  capabilities: capabilityManifest(entry),
}));

function isAgentEntry(item: MemorixIntegration): item is MemorixIntegration & { agent: AgentName } {
  return item.agent !== 'memcode' && item.agent !== 'any-mcp';
}

export function getAgentIntegrationEntries(): Array<MemorixIntegration & { agent: AgentName }> {
  return MEMORIX_INTEGRATIONS.filter(isAgentEntry);
}

export function getSetupAgentTargets(): AgentName[] {
  return MEMORIX_INTEGRATIONS
    .filter((item): item is MemorixIntegration & { agent: AgentName } => (
      isAgentEntry(item) && item.status === 'ready' && item.setup !== false
    ))
    .map(item => item.agent);
}

/** Return contract violations before a new adapter is allowed to ship. */
export function validateIntegrationRegistry(): string[] {
  const issues: string[] = [];
  const agents = getAgentIntegrationEntries();
  const seen = new Set<string>();
  for (const entry of agents) {
    if (seen.has(entry.agent)) issues.push(`duplicate agent: ${entry.agent}`);
    seen.add(entry.agent);
    const manifest = entry.capabilities;
    if (manifest.schemaVersion !== '1') issues.push(`${entry.agent}: unsupported manifest schema`);
    if (manifest.agent !== entry.agent) issues.push(`${entry.agent}: manifest agent mismatch`);
    if (manifest.transport.default !== 'none'
      && manifest.transport.default !== 'host-owned'
      && !manifest.transport.supported.includes(manifest.transport.default)) {
      issues.push(`${entry.agent}: default transport is not supported`);
    }
    if (manifest.hooks.supported && manifest.hooks.events.length === 0) {
      issues.push(`${entry.agent}: hooks are enabled without lifecycle events`);
    }
    for (const action of ['install', 'repair', 'doctor', 'uninstall'] as const) {
      if (typeof manifest.lifecycle[action] !== 'boolean') issues.push(`${entry.agent}: invalid lifecycle action ${action}`);
    }
    if (manifest.source.registry !== 'src/integrations/registry.ts') {
      issues.push(`${entry.agent}: invalid registry source`);
    }
  }
  if (agents.length !== 19) issues.push(`expected 19 agent manifests, found ${agents.length}`);
  return issues;
}

export function getSetupIntegrationRows(): SetupIntegrationRow[] {
  return MEMORIX_INTEGRATIONS
    .filter((item): item is MemorixIntegration & { agent: AgentName } => (
      isAgentEntry(item) && item.status === 'ready' && item.setup !== false
    ))
    .map((item) => ({
      agent: item.agent,
      name: item.name,
      entry: item.entry,
      status: item.status,
      install: item.install,
      surfaces: item.surfaces.join(', '),
    }));
}
