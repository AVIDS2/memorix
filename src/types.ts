/**
 * Memorix Core Types
 *
 * Data model sources:
 * - Entity/Relation/KnowledgeGraph: MCP Official Memory Server (v0.6.3)
 * - Observation/ObservationType: claude-mem Progressive Disclosure
 * - UnifiedRule/RuleSource: Memorix original (rules sync)
 *
 * Designed for extensibility: new agent formats (Kiro, Copilot, Antigravity)
 * can be added by extending RuleSource and adding format adapters.
 */

// ============================================================
// Knowledge Graph (adopted from MCP Official Memory Server)
// ============================================================

/** A node in the knowledge graph representing a concept, component, or config */
export interface Entity {
  name: string;
  entityType: string;
  observations: string[];
}

/** A directed edge between two entities */
export interface Relation {
  from: string;
  to: string;
  relationType: string;
}

/** The complete knowledge graph */
export interface KnowledgeGraph {
  entities: Entity[];
  relations: Relation[];
}

// ============================================================
// Observation (adopted from claude-mem Progressive Disclosure)
// ============================================================

/**
 * Observation type classification using claude-mem's icon-based legend system.
 *
 * Icon mapping:
 * 🎯 session-request   — User's original goal
 * 🔴 gotcha            — Critical pitfall / trap
 * 🟡 problem-solution  — Bug fix or workaround
 * 🔵 how-it-works      — Technical explanation
 * 🟢 what-changed      — Code/architecture change
 * 🟣 discovery         — New learning or insight
 * 🟠 why-it-exists     — Design rationale
 * 🟤 decision          — Architecture decision
 * ⚖️ trade-off         — Deliberate compromise
 */
export type ObservationType =
  | 'session-request'
  | 'gotcha'
  | 'problem-solution'
  | 'how-it-works'
  | 'what-changed'
  | 'discovery'
  | 'why-it-exists'
  | 'decision'
  | 'trade-off';

/** Map from ObservationType to display icon */
export const OBSERVATION_ICONS: Record<ObservationType, string> = {
  'session-request': '🎯',
  'gotcha': '🔴',
  'problem-solution': '🟡',
  'how-it-works': '🔵',
  'what-changed': '🟢',
  'discovery': '🟣',
  'why-it-exists': '🟠',
  'decision': '🟤',
  'trade-off': '⚖️',
};

/** A rich observation record attached to an entity */
export interface Observation {
  id: number;
  entityName: string;
  type: ObservationType;
  title: string;
  narrative: string;
  facts: string[];
  filesModified: string[];
  concepts: string[];
  tokens: number;
  createdAt: string;
  updatedAt?: string;
  projectId: string;
  /** Whether the observation contains causal language (because, due to, etc.) */
  hasCausalLanguage?: boolean;
  /** Optional topic key for upsert — same project+topicKey updates existing observation */
  topicKey?: string;
  /** How many times this observation was revised via topic key upsert (starts at 1) */
  revisionCount?: number;
  /** Session ID this observation belongs to */
  sessionId?: string;
}

// ============================================================
// Session Lifecycle (inspired by Engram's session management)
// ============================================================

/** A coding session tracked by Memorix */
export interface Session {
  id: string;
  projectId: string;
  startedAt: string;
  endedAt?: string;
  summary?: string;
  status: 'active' | 'completed';
  /** Agent/IDE that started this session */
  agent?: string;
}

// ============================================================
// Compact Engine (adopted from claude-mem 3-layer workflow)
// ============================================================

/** L1 index entry — lightweight, ~50-100 tokens per result */
export interface IndexEntry {
  id: number;
  time: string;
  type: ObservationType;
  icon: string;
  title: string;
  tokens: number;
}

/** L2 timeline context — observations around an anchor */
export interface TimelineContext {
  anchorId: number;
  anchorEntry: IndexEntry | null;
  before: IndexEntry[];
  after: IndexEntry[];
}

/** Search options for the compact engine */
export interface SearchOptions {
  query: string;
  limit?: number;
  type?: ObservationType;
  projectId?: string;
  since?: string;
  until?: string;
  /** Token budget — trim results to fit within this many tokens (0 = unlimited) */
  maxTokens?: number;
}

/** Topic key family heuristics for suggesting stable topic keys */
export const TOPIC_KEY_FAMILIES: Record<string, string[]> = {
  'architecture': ['architecture', 'design', 'adr', 'structure', 'pattern'],
  'bug': ['bugfix', 'fix', 'error', 'regression', 'crash', 'problem-solution'],
  'decision': ['decision', 'trade-off', 'choice', 'strategy'],
  'config': ['config', 'setup', 'env', 'environment', 'deployment'],
  'discovery': ['discovery', 'learning', 'insight', 'gotcha'],
  'pattern': ['pattern', 'convention', 'standard', 'best-practice'],
};

// ============================================================
// Orama Document Schema
// ============================================================

/** The document shape stored in Orama */
export interface MemorixDocument {
  id: string;
  observationId: number;
  entityName: string;
  type: string;
  title: string;
  narrative: string;
  facts: string;
  filesModified: string;
  concepts: string;
  tokens: number;
  createdAt: string;
  projectId: string;
  /** Number of times this observation was returned in search results */
  accessCount: number;
  /** ISO timestamp of last access via search/detail */
  lastAccessedAt: string;
}

// ============================================================
// Rules System (Memorix original — extensible for new agents)
// ============================================================

/**
 * Supported agent/IDE rule sources.
 * All 7 major AI IDEs are supported.
 */
export type RuleSource =
  | 'cursor'
  | 'claude-code'
  | 'codex'
  | 'windsurf'
  | 'antigravity'
  | 'copilot'
  | 'kiro'
  | 'memorix';

/** A parsed rule in the unified intermediate representation */
export interface UnifiedRule {
  id: string;
  content: string;
  description?: string;
  source: RuleSource;
  scope: 'global' | 'project' | 'path-specific';
  paths?: string[];
  alwaysApply?: boolean;
  priority: number;
  hash: string;
}

/**
 * Format adapter interface — implement this for each agent/IDE.
 * Adding a new agent (e.g., Kiro) only requires implementing this interface.
 */
export interface RuleFormatAdapter {
  /** Unique identifier for this agent format */
  readonly source: RuleSource;

  /** File paths/globs this adapter can parse */
  readonly filePatterns: string[];

  /** Parse rule files into unified representation */
  parse(filePath: string, content: string): UnifiedRule[];

  /** Generate rule file content from unified representation */
  generate(rules: UnifiedRule[]): { filePath: string; content: string }[];
}

// ============================================================
// Project Identity
// ============================================================

export interface ProjectInfo {
  id: string;
  name: string;
  gitRemote?: string;
  rootPath: string;
}

// ============================================================
// Memorix Server Configuration
// ============================================================

export interface MemorixConfig {
  dataDir: string;
  projectId: string;
  projectName: string;
  enableEmbeddings: boolean;
  enableRulesSync: boolean;
  watchRuleFiles: boolean;
}

export const DEFAULT_CONFIG: Partial<MemorixConfig> = {
  enableEmbeddings: false,
  enableRulesSync: false,
  watchRuleFiles: false,
};

// ============================================================
// Workspace Sync — Cross-Agent workspace migration
// ============================================================

/** Supported agent targets for workspace sync */
export type AgentTarget = 'windsurf' | 'cursor' | 'claude-code' | 'codex' | 'copilot' | 'antigravity' | 'kiro' | 'opencode';

/** A unified MCP server entry across all agent config formats */
export interface MCPServerEntry {
  name: string;
  /** Command for stdio transport */
  command: string;
  /** Args for stdio transport */
  args: string[];
  /** Environment variables */
  env?: Record<string, string> | null;
  /** URL for HTTP/SSE transport (Codex uses `url`, Windsurf uses `serverUrl`) */
  url?: string;
  /** HTTP headers (Windsurf uses `headers` for HTTP transport) */
  headers?: Record<string, string>;
  /** Whether this server is disabled */
  disabled?: boolean;
}

/** Unified workflow entry */
export interface WorkflowEntry {
  name: string;
  description: string;
  content: string;
  source: AgentTarget;
  filePath: string;
}

/** A skill folder discovered from an agent's skills directory */
export interface SkillEntry {
  name: string;
  description: string;
  sourcePath: string;
  sourceAgent: AgentTarget;
}

/** Conflict when two agents have a skill with the same folder name */
export interface SkillConflict {
  name: string;
  kept: SkillEntry;
  skipped: SkillEntry;
}

/** Result of a workspace sync operation */
export interface WorkspaceSyncResult {
  mcpServers: {
    scanned: MCPServerEntry[];
    generated: { filePath: string; content: string }[];
  };
  workflows: {
    scanned: WorkflowEntry[];
    generated: { filePath: string; content: string }[];
  };
  rules: {
    scanned: number;
    generated: number;
  };
  skills: {
    scanned: SkillEntry[];
    conflicts: SkillConflict[];
    copied: string[];
    skipped: string[];
  };
}

/** MCP config format adapter interface */
export interface MCPConfigAdapter {
  readonly source: AgentTarget;
  /** Parse MCP server entries from a config file */
  parse(content: string): MCPServerEntry[];
  /** Generate config file content from MCP server entries */
  generate(servers: MCPServerEntry[]): string;
  /** Get the default config file path for this agent */
  getConfigPath(projectRoot?: string): string;
}
