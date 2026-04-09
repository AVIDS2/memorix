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
 * 🧠 reasoning         — Why this approach was chosen (System 2 reasoning trace)
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
  | 'trade-off'
  | 'reasoning';

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
  'reasoning': '🧠',
};

/** Observation lifecycle status */
export type ObservationStatus = 'active' | 'resolved' | 'archived';

/** Progress tracking for task/feature observations */
export interface ProgressInfo {
  feature: string;
  status: 'in-progress' | 'completed' | 'blocked';
  completion?: number;
}

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
  /** Lifecycle status: active (default) → resolved → archived */
  status?: ObservationStatus;
  /** ID of the observation that superseded this one (set when auto-resolved by topicKey upsert) */
  supersededBy?: number;
  /** Progress tracking for task/feature observations */
  progress?: ProgressInfo;
  /** Origin of this observation: agent (IDE hooks/MCP), git (commit ingest), manual (CLI) */
  source?: 'agent' | 'git' | 'manual';
  /** Git commit hash if source is 'git' */
  commitHash?: string;
  /** Related commit hashes — links reasoning memories to the commits they explain */
  relatedCommits?: string[];
  /** Related entity names — explicit cross-references to other memory entities */
  relatedEntities?: string[];
  /** Provenance detail: how this observation entered the system */
  sourceDetail?: 'explicit' | 'hook' | 'git-ingest';
  /** Value category from formation pipeline evaluation */
  valueCategory?: 'core' | 'contextual' | 'ephemeral';
  /** Phase 4a: Agent ID that created this observation (team attribution) */
  createdByAgentId?: string;
  /** Phase 4a: Monotonic write generation — snapshot of storage_generation at write time (watermark coherence) */
  writeGeneration?: number;
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
  /** Relevance score from search (time-decayed). Used by compact engine. */
  score?: number;
  /** Project that owns this observation. Needed to disambiguate global results. */
  projectId?: string;
  /** Origin of the memory for source-aware retrieval and display. */
  source?: 'agent' | 'git' | 'manual';
  /** Provenance detail for source-aware display */
  sourceDetail?: 'explicit' | 'hook' | 'git-ingest';
  /** Value category for source-aware ranking */
  valueCategory?: 'core' | 'contextual' | 'ephemeral';
  /** Explainable recall: why this result matched. */
  matchedFields?: string[];
  /** Entity name — used for entity-affinity scoring and workstream deduplication. */
  entityName?: string;
  /** Document type: observation or mini-skill (Phase 3a) */
  documentType?: DocumentType;
  /** Knowledge layer for layer-aware ranking (Phase 3a) */
  knowledgeLayer?: KnowledgeLayer;
}

/** Explicit reference to an observation, optionally scoped to a project. */
export interface ObservationRef {
  id: number;
  projectId?: string;
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
  /** Filter by observation status. Default: 'active' (only show active memories) */
  status?: ObservationStatus | 'all';
  /** Filter by observation source: 'agent', 'git', 'manual', or undefined for all */
  source?: 'agent' | 'git' | 'manual';
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
  /** Lifecycle status: active, resolved, archived */
  status: string;
  /** Origin: agent, git, manual */
  source: string;
  /** Provenance detail: explicit, hook, or git-ingest */
  sourceDetail?: string;
  /** Value category from formation evaluation */
  valueCategory?: string;
  /** Optional vector embedding for semantic/hybrid retrieval */
  embedding?: number[];
  /** Document type: observation or mini-skill (Phase 3a) */
  documentType?: DocumentType;
  /** Knowledge layer for layer-aware ranking (Phase 3a) */
  knowledgeLayer?: KnowledgeLayer;
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
  | 'gemini-cli'
  | 'copilot'
  | 'kiro'
  | 'trae'
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

/**
 * Diagnostic failure info from project detection.
 * Tells callers exactly WHY detection failed so they can report actionable errors.
 */
export type DetectionFailureReason =
  | 'path_not_found'
  | 'not_a_directory'
  | 'no_git'
  | 'git_worktree_error'
  | 'git_safe_directory'
  | 'remote_resolve_failed';

export interface DetectionFailure {
  reason: DetectionFailureReason;
  path: string;
  detail: string;
}

export interface DetectionResult {
  project: ProjectInfo | null;
  failure: DetectionFailure | null;
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
export type AgentTarget = 'windsurf' | 'cursor' | 'claude-code' | 'codex' | 'copilot' | 'antigravity' | 'gemini-cli' | 'kiro' | 'opencode' | 'trae';

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

// ============================================================
// Mini-Skills — Promoted memories that never decay
// ============================================================

/** A mini-skill promoted from one or more observations */
export interface MiniSkill {
  id: number;
  /** Observation IDs this mini-skill was derived from (live refs, best-effort) */
  sourceObservationIds: number[];
  /** Entity the source observations belong to */
  sourceEntity: string;
  /** Short title for the skill */
  title: string;
  /** What the agent should do (imperative instruction) */
  instruction: string;
  /** When this skill should be applied (scenario description) */
  trigger: string;
  /** Key facts extracted from source observations */
  facts: string[];
  /** Project this skill belongs to */
  projectId: string;
  /** ISO timestamp */
  createdAt: string;
  /** How many times this skill was injected in session_start */
  usedCount: number;
  /** Classification tags */
  tags: string[];
  /** Frozen source observation content at promote time (JSON, immutable provenance proof) */
  sourceSnapshot?: string;
  /** ISO timestamp of last modification (Phase 3a: set once at creation) */
  updatedAt?: string;
}

// ============================================================
// Source Snapshot — immutable provenance proof for promoted knowledge
// ============================================================

/** A single observation entry within a source snapshot */
export interface SnapshotObservation {
  id: number;
  title: string;
  type: string;
  narrative: string;
  facts: string[];
  entityName: string;
  projectId: string;
  createdAt: string;
  /** Frozen source detail for provenance (explicit / hook / git-ingest) */
  sourceDetail?: string;
}

/** Frozen source content captured at promote time */
export interface SourceSnapshot {
  observations: SnapshotObservation[];
  promotedAt: string;
}

// ============================================================
// Knowledge Layer — Phase 3a retrieval classification
// ============================================================

/** Classification of knowledge for layer-aware ranking */
export type KnowledgeLayer = 'project-truth' | 'promoted' | 'evidence';

/** Document type discriminator for Orama index */
export type DocumentType = 'observation' | 'mini-skill';

// ============================================================
// Typed Memory Reference — Phase 3a reference protocol
// ============================================================

/** A typed reference to a memory object (observation or mini-skill) */
export interface MemoryRef {
  kind: 'obs' | 'skill';
  id: number;
  projectId?: string;
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
