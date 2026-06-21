import type { AgentName } from '../hooks/types.js';

export type IntegrationEntry =
  | 'official-plugin'
  | 'official-extension'
  | 'official-package'
  | 'local-plugin'
  | 'official-config'
  | 'native'
  | 'mcp-fallback';

export type IntegrationStatus = 'ready' | 'planned';

export interface MemorixIntegration {
  agent: AgentName | 'memcode' | 'any-mcp';
  name: string;
  entry: IntegrationEntry;
  status: IntegrationStatus;
  install: string;
  surfaces: string[];
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

export const MEMORIX_INTEGRATIONS: MemorixIntegration[] = [
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
    agent: 'copilot',
    name: 'GitHub Copilot CLI',
    entry: 'official-plugin',
    status: 'ready',
    install: 'memorix setup --agent copilot',
    surfaces: ['MCP', 'skills', 'hooks'],
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
    surfaces: ['MCP', 'GEMINI.md context'],
    note: 'Google Antigravity is the newer Google agent lane; Gemini CLI remains supported.',
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
    entry: 'official-config',
    status: 'ready',
    install: 'memorix setup --agent antigravity',
    surfaces: ['MCP', 'GEMINI.md context', 'hooks'],
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
    surfaces: ['Pi package', 'extension API', 'skills', 'hooks'],
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

export function getSetupIntegrationRows(): SetupIntegrationRow[] {
  return MEMORIX_INTEGRATIONS
    .filter((item): item is MemorixIntegration & { agent: AgentName } => (
      item.status === 'ready' &&
      item.agent !== 'memcode' &&
      item.agent !== 'any-mcp'
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
