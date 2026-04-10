/**
 * Memorix MCP Server
 *
 * Registers all MCP tools and handles the server lifecycle.
 *
 * Tool sources:
 * - memorix_store / memorix_search / memorix_detail / memorix_timeline:
 *     Memorix extensions using claude-mem's 3-layer Progressive Disclosure
 * - create_entities / create_relations / add_observations / delete_entities /
 *   delete_observations / delete_relations / search_nodes / open_nodes / read_graph:
 *     MCP Official Memory Server compatible interface (P1)
 *
 * Extensibility:
 * - New tools can be registered via server.registerTool()
 * - Rules sync tools will be added in P2
 * - New agent format adapters plug in without changing this file
 */

import { watchFile } from 'node:fs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { KnowledgeGraphManager } from './memory/graph.js';
import { initObservations, storeObservation, prepareSearchIndex, migrateProjectIds, getObservation, getAllObservations } from './memory/observations.js';
import { withFreshIndex } from './memory/freshness.js';
import { initObservationStore, getObservationStore } from './store/obs-store.js';
import { resetDb } from './store/orama-store.js';
import { initMiniSkillStore } from './store/mini-skill-store.js';
import { initSessionStore } from './store/session-store.js';
import { checkProjectAttribution, auditProjectObservations } from './memory/attribution-guard.js';
import { createAutoRelations } from './memory/auto-relations.js';
import { extractEntities } from './memory/entity-extractor.js';
import { compactSearch, compactTimeline, compactDetail } from './compact/engine.js';
import { detectProject } from './project/detector.js';
import { registerAlias, initAliasRegistry, resolveAliases, autoMergeByBaseName } from './project/aliases.js';
import { getProjectDataDir } from './store/persistence.js';
import type { ObservationType, RuleSource, AgentTarget, MCPServerEntry } from './types.js';
import { RulesSyncer } from './rules/syncer.js';
import { WorkspaceSyncEngine } from './workspace/engine.js';
import { initLLM, isLLMEnabled, getLLMConfig } from './llm/provider.js';
import { compactOnWrite, deduplicateMemory } from './llm/memory-manager.js';
import type { ExistingMemory } from './llm/memory-manager.js';
import { runFormation, getMetricsSummary, getBeforeAfterMetrics } from './memory/formation/index.js';
import type { FormationConfig, SearchHit, FormedMemory } from './memory/formation/types.js';

// ── Timeout budgets for LLM-heavy paths ──────────────────────────
const FORMATION_TIMEOUT_MS = 12_000;   // Formation pipeline (extract+resolve+evaluate)
const COMPRESSION_TIMEOUT_MS = 5_000;  // Narrative compression
const DEDUP_PER_PAIR_TIMEOUT_MS = 5_000; // Per-pair dedup LLM call

/** Race a promise against a timeout. Rejects with a descriptive Error on timeout. */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    }),
  ]).finally(() => clearTimeout(timer!));
}

/** Timestamp of last MCP-initiated write — hot-reload skips changes within 10s */
let lastInternalWriteMs = 0;
const markInternalWrite = () => { lastInternalWriteMs = Date.now(); };

/** Valid observation types for input validation */
const OBSERVATION_TYPES: [string, ...string[]] = [
  'session-request',
  'gotcha',
  'problem-solution',
  'reasoning',
  'how-it-works',
  'what-changed',
  'discovery',
  'why-it-exists',
  'decision',
  'trade-off',
];

/**
 * Defensive parameter coercion for Claude Code CLI + non-Anthropic models (e.g. GLM).
 * Claude Code CLI has a known bug (#5504, #26027) where JSON objects/arrays
 * get serialized as strings. GLM models amplify this by producing string-encoded
 * arrays/numbers in tool calls. These helpers ensure Memorix works regardless.
 */
function coerceNumberArray(val: unknown): number[] {
  if (Array.isArray(val)) return val.map(Number);
  if (typeof val === 'string') {
    try {
      const parsed = JSON.parse(val);
      if (Array.isArray(parsed)) return parsed.map(Number);
    } catch { /* not valid JSON */ }
  }
  return [];
}

function coerceObservationRefs(val: unknown): Array<{ id: number; projectId?: string }> {
  if (Array.isArray(val)) {
    const refs: Array<{ id: number; projectId?: string }> = [];
    for (const item of val) {
      if (!item || typeof item !== 'object') continue;
      const record = item as Record<string, unknown>;
      const id = Number(record['id']);
      if (!Number.isFinite(id) || id <= 0) continue;

      const projectId = typeof record['projectId'] === 'string' ? record['projectId'] : undefined;
      refs.push(projectId ? { id, projectId } : { id });
    }
    return refs;
  }
  if (typeof val === 'string') {
    try {
      const parsed = JSON.parse(val);
      return coerceObservationRefs(parsed);
    } catch {
      return [];
    }
  }
  return [];
}

function coerceNumber(val: unknown, fallback: number): number {
  if (typeof val === 'number') return val;
  if (typeof val === 'string') {
    const n = Number(val);
    if (!Number.isNaN(n)) return n;
  }
  return fallback;
}

function coerceStringArray(val: unknown): string[] {
  if (Array.isArray(val)) return val.map(String);
  if (typeof val === 'string') {
    try {
      const parsed = JSON.parse(val);
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch { /* not valid JSON */ }
  }
  return [];
}

function coerceObject<T>(val: unknown): T | null {
  if (typeof val === 'object' && val !== null && !Array.isArray(val)) return val as T;
  if (typeof val === 'string') {
    try {
      const parsed = JSON.parse(val);
      if (typeof parsed === 'object' && parsed !== null) return parsed as T;
    } catch { /* not valid JSON */ }
  }
  return null;
}

function coerceObjectArray<T>(val: unknown): T[] {
  if (Array.isArray(val)) {
    return val.map(item => {
      if (typeof item === 'string') {
        try { return JSON.parse(item); } catch { return item; }
      }
      return item;
    });
  }
  if (typeof val === 'string') {
    try {
      const parsed = JSON.parse(val);
      if (Array.isArray(parsed)) return parsed;
    } catch { /* not valid JSON */ }
  }
  return [];
}

/**
 * Create and configure the Memorix MCP Server.
 */
/** Optional shared TeamStore — passed by serve-http so all sessions share state */
export interface SharedTeamInstances {
  teamStore: import('./team/team-store.js').TeamStore;
}

export interface CreateMemorixServerOptions {
  allowUntrackedFallback?: boolean;
  deferProjectInitUntilBound?: boolean;
}

export async function createMemorixServer(
  cwd?: string,
  existingServer?: McpServer,
  sharedTeam?: SharedTeamInstances,
  options: CreateMemorixServerOptions = {},
): Promise<{
  server: McpServer;
  graphManager: KnowledgeGraphManager;
  projectId: string;
  deferredInit: () => Promise<void>;
  switchProject: (newCwd: string) => Promise<boolean>;
  isExplicitlyBound: () => boolean;
}> {
  // Detect current project — strict .git-based detection
  const allowUntrackedFallback = options.allowUntrackedFallback ?? true;
  const deferProjectInitUntilBound = options.deferProjectInitUntilBound ?? false;
  const detectedProject = detectProject(cwd);
  let rawProject: import('./types.js').ProjectInfo;
  let projectResolved = true;
  let projectResolutionError: string | null = null;
  let explicitProjectBound = false; // Set true when memorix_session_start binds via projectRoot
  let currentAgentId: string | undefined; // Phase 4a: set by session_start auto-registration, used by observation writes
  if (detectedProject) {
    rawProject = detectedProject;
  } else {
    const basePath = cwd ?? process.cwd();
    const name = (await import('node:path')).basename(basePath) || 'unknown';
    projectResolved = false;
    projectResolutionError =
      `No git project could be resolved from "${basePath}". ` +
      'This client did not provide a usable workspace root, so project-scoped tools are disabled until a git-backed project is detected.';
    rawProject = allowUntrackedFallback
      ? { id: `untracked/${name}`, name, rootPath: basePath }
      : { id: '__unresolved__', name, rootPath: basePath };
    if (!allowUntrackedFallback && !deferProjectInitUntilBound) {
      console.error(`[memorix] WARNING: ${projectResolutionError}`);
    } else if (allowUntrackedFallback) {
      console.error(`[memorix] WARNING: No .git found in "${basePath}" - project isolation degraded`);
      console.error(`[memorix] Run "git init" in your project for proper isolation.`);
    }
  }

  // Migrate legacy per-project subdirectories into flat base directory (one-time, silent)
  try {
    const { migrateSubdirsToFlat } = await import('./store/persistence.js');
    const migrated = await migrateSubdirsToFlat();
    if (migrated) {
      console.error(`[memorix] Migrated per-project subdirectories into flat storage`);
    }
  } catch { /* migration is optional */ }

  let projectDir = await getProjectDataDir(rawProject.id);

  // Register aliases only for git-backed projects. Unresolved sessions should not
  // silently create canonical IDs or pollute alias mappings.
  let project = rawProject;
  if (projectResolved) {
    initAliasRegistry(projectDir);
    const canonicalId = await registerAlias(rawProject);
    project = { ...rawProject, id: canonicalId };
    if (canonicalId !== rawProject.id) {
      console.error(`[memorix] Alias resolved: ${rawProject.id} -> ${canonicalId}`);
    }
  }

  // Initialize project root for YAML config resolution — ensures all config getters
  // (getLLMApiKey, getGitConfig, etc.) pick up project-level memorix.yml, not just user-level.
  // Also load .env from project root for secrets (API keys, base URLs).
  try {
    const { initProjectRoot } = await import('./config/yaml-loader.js');
    initProjectRoot(project.rootPath);
    const { loadDotenv } = await import('./config/dotenv-loader.js');
    loadDotenv(project.rootPath);
  } catch { /* config init is best-effort */ }

  // Initialize components
  await initObservationStore(projectDir);
  await initMiniSkillStore(projectDir);
  await initSessionStore(projectDir);
  {
    const store = getObservationStore();
    console.error(`[memorix] ObservationStore backend: ${store.getBackendName()}, generation: ${store.getGeneration()}`);
  }
  let graphManager = new KnowledgeGraphManager(projectDir);
  await graphManager.init();
  await initObservations(projectDir);

  const lightweightUnresolvedSession = !projectResolved && deferProjectInitUntilBound;

  const initializeProjectRuntime = async (logPrefix: 'startup' | 'switch'): Promise<void> => {
    await initObservationStore(projectDir);
    await initMiniSkillStore(projectDir);
    await initSessionStore(projectDir);
    graphManager = new KnowledgeGraphManager(projectDir);
    await graphManager.init();
    await initObservations(projectDir);

    const indexed = await prepareSearchIndex();
    if (indexed > 0) {
      console.error(`[memorix] Prepared search index for ${indexed} observations in project: ${project.id}`);
    }

    const llmConfig = initLLM();
    if (llmConfig) {
      console.error(`[memorix] LLM enhanced mode: ${llmConfig.provider}/${llmConfig.model}`);
    } else {
      console.error(`[memorix] LLM mode: off (set MEMORIX_LLM_API_KEY or OPENAI_API_KEY to enable)`);
    }

    if (logPrefix === 'startup') {
      console.error(`[memorix] Project: ${project.id} (${project.name})`);
      console.error(`[memorix] Data dir: ${projectDir}`);
    } else {
      console.error(`[memorix] Project switched to: ${project.id} (${project.name})`);
      console.error(`[memorix] Data dir: ${projectDir}`);
    }
  };

  if (!lightweightUnresolvedSession) {
  // Auto-merge obvious alias groups by scanning observed projectIds in data.
  // This detects splits like local/foo + user/foo (legacy data migration)
  try {
    const { getAllObservations } = await import('./memory/observations.js');
    const allObs = getAllObservations();
    const observedIds = [...new Set(allObs.map(o => o.projectId))];
    const merged = await autoMergeByBaseName(observedIds);
    if (merged > 0) {
      console.error(`[memorix] Auto-merged ${merged} alias group(s) by base name`);
    }
  } catch { /* auto-merge is optional */ }

  // Migrate existing observations to canonical project ID for ALL alias groups.
  // This normalizes split projectIds like local/foo + user/foo → canonical.
  try {
    const { getAllAliasGroups } = await import('./project/aliases.js');
    const groups = await getAllAliasGroups();
    let totalMigrated = 0;
    for (const group of groups) {
      if (group.aliases.length > 1) {
        const migrated = await migrateProjectIds(group.aliases, group.canonical);
        if (migrated > 0) {
          console.error(`[memorix] Migrated ${migrated} observations → ${group.canonical}`);
          totalMigrated += migrated;
        }
      }
    }
    if (totalMigrated > 0) {
      console.error(`[memorix] Total migrated: ${totalMigrated} observations across ${groups.filter(g => g.aliases.length > 1).length} project(s)`);
    }
  } catch { /* migration is optional */ }

  await initializeProjectRuntime('startup');
  } else {
    // Intentionally silent — serve-http.ts deferred logging handles session lifecycle visibility.
    // Noisy per-probe 'awaiting binding' log was removed to reduce terminal spam.
  }

  // Sync advisory variables — populated by deferredInit(), used by memorix_search
  let syncAdvisoryShown = false;
  let syncAdvisory: string | null = null;
  const requireResolvedProject = (action: string) => {
    if (projectResolved) return null;
    return {
      content: [{
        type: 'text' as const,
        text:
          `Cannot ${action} yet.\n` +
          `${projectResolutionError ?? 'No git-backed project is currently bound to this session.'}\n\n` +
          'To bind this session to a project, call memorix_session_start with the projectRoot parameter:\n' +
          '  memorix_session_start({ projectRoot: "/path/to/your/project" })\n\n' +
          'The path should point to a directory containing a .git folder.',
      }],
      isError: true as const,
    };
  };

  // Create MCP server (or use existing one from roots-aware flow)
  const server = existingServer ?? new McpServer({
    name: 'memorix',
    version: typeof __MEMORIX_VERSION__ !== 'undefined' ? __MEMORIX_VERSION__ : '1.0.1',
  });

  // ================================================================
  // Memorix Extended Tools (3-layer Progressive Disclosure)
  // ================================================================

  /**
   * memorix_store — Store a new observation
   *
   * Primary write API. Agents call this to persist knowledge.
   * Auto-assigns ID, counts tokens, indexes for search.
   */
  server.registerTool(
    'memorix_store',
    {
      title: 'Store Memory',
      description:
        'Store a new observation/memory. Automatically indexed for search. ' +
        'Use type to classify: gotcha (🔴 critical pitfall), decision (🟤 architecture choice), ' +
        'problem-solution (🟡 bug fix), how-it-works (🔵 explanation), what-changed (🟢 change), ' +
        'discovery (🟣 insight), why-it-exists (🟠 rationale), trade-off (⚖️ compromise), ' +
        'session-request (🎯 original goal). ' +
        'Stored memories persist across sessions and are shared with other IDEs (Cursor, Windsurf, Claude Code, Codex, Copilot, Kiro, Antigravity, Trae) via the same local data directory.',
      inputSchema: {
        entityName: z.string().describe('The entity this observation belongs to (e.g., "auth-module", "port-config")'),
        type: z.enum(OBSERVATION_TYPES).describe('Observation type for classification'),
        title: z.string().describe('Short descriptive title (~5-10 words)'),
        narrative: z.string().describe('Full description of the observation'),
        facts: z.array(z.string()).optional().describe('Structured facts (e.g., "Default timeout: 60s")'),
        filesModified: z.array(z.string()).optional().describe('Files involved'),
        concepts: z.array(z.string()).optional().describe('Related concepts/keywords'),
        topicKey: z.string().optional().describe(
          'Optional topic identifier for upserts (e.g., "architecture/auth-model"). ' +
          'If an observation with the same topicKey already exists in this project, it will be UPDATED instead of creating a new one. ' +
          'Use memorix_suggest_topic_key to generate a stable key. Good for evolving decisions, architecture docs, etc.',
        ),
        progress: z.object({
          feature: z.string().describe('Feature or task name'),
          status: z.enum(['in-progress', 'completed', 'blocked']).describe('Current status'),
          completion: z.number().optional().describe('Completion percentage 0-100'),
        }).optional().describe('Progress tracking for task/feature observations'),
        relatedCommits: z.array(z.string()).optional().describe('Git commit hashes this memory relates to (links ground truth ↔ reasoning)'),
        relatedEntities: z.array(z.string()).optional().describe('Other entity names this memory cross-references'),
      },
    },
    async ({ entityName: rawEntityName, type: rawType, title: rawTitle, narrative, facts, filesModified, concepts, topicKey, progress, relatedCommits, relatedEntities }) => {
      const unresolved = requireResolvedProject('store memory in the current project');
      if (unresolved) return unresolved;
      return withFreshIndex(async () => {

      // Mutable copies — Formation Pipeline may improve these
      let entityName = rawEntityName;
      let type = rawType;
      let title = rawTitle;
      // Defensive coercion: Claude Code CLI + GLM may send string-encoded arrays
      let safeFacts = facts ? coerceStringArray(facts) : undefined;
      const safeFiles = filesModified ? coerceStringArray(filesModified) : undefined;
      const safeConcepts = concepts ? coerceStringArray(concepts) : undefined;

      // ── Determine decision maker based on Formation mode ─────────────
      // Priority: env var override > config.json > default (active)
      // - shadow: Formation observes only, old compact decides
      // - active: Formation decides storage behavior (new/merge/evolve/discard) [default]
      // - fallback: old compact decides (safe rollback)
      let formationMode: 'shadow' | 'active' | 'fallback' = 'active';
      if (process.env.MEMORIX_FORMATION_MODE) {
        formationMode = process.env.MEMORIX_FORMATION_MODE as typeof formationMode;
      } else {
        try {
          const { getBehaviorConfig } = await import('./config/behavior.js');
          formationMode = getBehaviorConfig().formationMode;
        } catch { /* default to active */ }
      }
      const useFormation = formationMode === 'active';

      // ── Formation Pipeline (active mode: decides storage) ─────────────
      let formationResult: FormedMemory | null = null;
      let formationNote = '';
      if (useFormation && !topicKey && !progress) {
        try {
          const formationConfig: FormationConfig = {
            mode: 'active',
            useLLM: isLLMEnabled(),
            minValueScore: 0.3,
            searchMemories: async (q: string, limit: number, pid: string): Promise<SearchHit[]> => {
              const result = await compactSearch({ query: q, limit, projectId: pid, status: 'active' });
              if (result.entries.length === 0) return [];
              const details = await compactDetail(result.entries.map(e => e.id));
              return details.documents.map((d, i) => ({
                id: Number(d.id.replace('obs-', '')),
                observationId: d.observationId,
                title: d.title,
                narrative: d.narrative,
                facts: d.facts,
                entityName: d.entityName,
                type: d.type,
                score: result.entries[i]?.score ?? 0,
              }));
            },
            getObservation: (id: number) => {
              const o = getObservation(id);
              if (!o) return null;
              return {
                id: o.id,
                entityName: o.entityName,
                type: o.type,
                title: o.title,
                narrative: o.narrative,
                facts: o.facts,
                topicKey: o.topicKey,
              };
            },
            getEntityNames: () => graphManager.getEntityNames(),
          };

          formationResult = await withTimeout(
            runFormation({
              entityName,
              type: type as ObservationType,
              title,
              narrative,
              facts: safeFacts,
              projectId: project.id,
              source: 'explicit',
            }, formationConfig),
            FORMATION_TIMEOUT_MS,
            'Formation pipeline',
          );

          const modeIcon = '⚡';
          formationNote = `\n${modeIcon} Formation[active]: ${formationResult.evaluation.category} (${formationResult.evaluation.score.toFixed(2)}) | ${formationResult.resolution.action} | ${formationResult.pipeline.durationMs}ms`;
          if (formationResult.extraction.extractedFacts.length > 0) {
            formationNote += ` | +${formationResult.extraction.extractedFacts.length} facts`;
          }
          if (formationResult.extraction.titleImproved) formationNote += ' | title↑';
          if (formationResult.extraction.entityResolved) formationNote += ` | entity→${formationResult.entityName}`;
          if (formationResult.extraction.typeCorrected) formationNote += ` | type→${formationResult.type}`;
        } catch (formationErr) {
          // Formation timeout or failure → fall through to store without enrichment
          const isTimeout = formationErr instanceof Error && formationErr.message.includes('timed out');
          formationNote = `\n⚠️ Formation ${isTimeout ? 'timed out' : 'failed'} — storing base observation without enrichment`;
        }
      }

      // ── Apply Formation decision (active mode only) ───────────────────
      if (useFormation && formationResult && formationResult.resolution.action !== 'new') {
        const { action, targetId, reason } = formationResult.resolution;

        if (action === 'merge' && targetId) {
          // Merge into existing observation
          const targetObs = getObservation(targetId);
          if (targetObs) {
            markInternalWrite();
            await storeObservation({
              entityName: targetObs.entityName,
              type: targetObs.type,
              title: formationResult.title,
              narrative: formationResult.narrative,
              facts: formationResult.facts,
              filesModified: safeFiles,
              concepts: safeConcepts,
              projectId: project.id,
              topicKey: targetObs.topicKey,
              progress: progress as import('./types.js').ProgressInfo | undefined,
              sourceDetail: 'explicit',
              createdByAgentId: currentAgentId,
            });
            return {
              content: [{
                type: 'text' as const,
                text: `🔄 Formation MERGE: merged into #${targetId} (${reason})${formationNote}`,
              }],
            };
          }
        } else if (action === 'evolve' && targetId) {
          // Evolve existing observation
          const targetObs = getObservation(targetId);
          if (targetObs) {
            markInternalWrite();
            await storeObservation({
              entityName: targetObs.entityName,
              type: targetObs.type,
              title: formationResult.title,
              narrative: formationResult.narrative,
              facts: formationResult.facts,
              filesModified: safeFiles,
              concepts: safeConcepts,
              projectId: project.id,
              topicKey: targetObs.topicKey,
              progress: progress as import('./types.js').ProgressInfo | undefined,
              sourceDetail: 'explicit',
              createdByAgentId: currentAgentId,
            });
            return {
              content: [{
                type: 'text' as const,
                text: `🔄 Formation EVOLVE: evolved #${targetId} (${reason})${formationNote}`,
              }],
            };
          }
        } else if (action === 'discard') {
          // Skip storing entirely
          return {
            content: [{
              type: 'text' as const,
              text: `⏭️ Formation DISCARD: ${reason}${formationNote}`,
            }],
          };
        }
      }

      // ── Compact on Write (fallback mode or Formation said 'new') ───────
      // Search for similar existing memories BEFORE storing.
      // If compact says UPDATE → merge into existing; NONE → skip storing.
      // This keeps memory count low and prevents duplication (Mem0-style).
      let compactAction = '';
      let compactMerged = false;
      if (!useFormation && !topicKey && !progress) {
        try {
          const searchResult = await compactSearch({
            query: `${title} ${narrative.substring(0, 200)}`,
            limit: 5,
            projectId: project.id,
            status: 'active',
          });
          const similarEntries = searchResult.entries.map(e => e);
          if (similarEntries.length > 0) {
            // Fetch full details for comparison
            const similarIds = similarEntries.map(e => e.id);
            const details = await compactDetail(similarIds);
            const existingMemories: ExistingMemory[] = details.documents.map((d, i) => ({
              id: d.observationId,
              title: d.title,
              narrative: d.narrative,
              facts: d.facts,
              score: similarEntries[i]?.score ?? 0,
            }));

            const decision = await withTimeout(
              compactOnWrite(
                { title, narrative, facts: safeFacts ?? [] },
                existingMemories,
              ),
              FORMATION_TIMEOUT_MS,
              'Compact-on-write',
            );

            if (decision.action === 'UPDATE' && decision.targetId) {
              // Merge into existing memory (Mem0-style UPDATE)
              const targetObs = getObservation(decision.targetId);
              if (targetObs) {
                markInternalWrite();
                await storeObservation({
                  entityName: targetObs.entityName,
                  type: targetObs.type,
                  title: decision.mergedNarrative ? title : targetObs.title,
                  narrative: decision.mergedNarrative ?? narrative,
                  facts: decision.mergedFacts ?? safeFacts,
                  filesModified: safeFiles,
                  concepts: safeConcepts,
                  projectId: project.id,
                  topicKey: targetObs.topicKey,
                  progress: progress as import('./types.js').ProgressInfo | undefined,
                  sourceDetail: 'explicit',
                  createdByAgentId: currentAgentId,
                });
                compactAction = `🔄 Compact UPDATE: merged into #${decision.targetId} (${decision.reason})`;
                compactMerged = true;

                // Return early — we updated existing, no new observation needed
                return {
                  content: [{
                    type: 'text' as const,
                    text: `${compactAction}\nMode: ${decision.usedLLM ? 'LLM' : 'heuristic'}`,
                  }],
                };
              }
            } else if (decision.action === 'NONE') {
              // Memory is redundant — skip storing entirely
              return {
                content: [{
                  type: 'text' as const,
                  text: `⏭️ Compact SKIP: ${decision.reason}\nExisting memory #${decision.targetId} already covers this.\nMode: ${decision.usedLLM ? 'LLM' : 'heuristic'}`,
                }],
              };
            } else if (decision.action === 'DELETE' && decision.targetId) {
              // Old memory is outdated — resolve it, then ADD the new one
              const { resolveObservations } = await import('./memory/observations.js');
              await resolveObservations([decision.targetId], 'resolved');
              compactAction = ` | Compact: resolved outdated #${decision.targetId}`;
            }
            // decision.action === 'ADD' or DELETE fallthrough → proceed to store normally
            if (decision.enrichedFacts && decision.enrichedFacts.length > 0) {
              // LLM extracted additional facts — merge them in
              const currentFacts = safeFacts ?? [];
              const newFacts = decision.enrichedFacts.filter((f: string) => !currentFacts.includes(f));
              if (newFacts.length > 0) {
                compactAction += ` | +${newFacts.length} LLM-extracted facts`;
              }
            }
          }
        } catch { /* compact is best-effort */ }
      }

      // ── Apply Formation enrichments for 'new' action ─────────────────
      // When Formation decided 'new', merge LLM-extracted facts into the store.
      if (formationResult && formationResult.resolution.action === 'new') {
        const llmFacts = formationResult.extraction.extractedFacts;
        if (llmFacts.length > 0) {
          const currentFacts = safeFacts ?? [];
          const currentLower = new Set(currentFacts.map(f => f.toLowerCase().trim()));
          const newFacts = llmFacts.filter(f => !currentLower.has(f.toLowerCase().trim()));
          if (newFacts.length > 0) {
            safeFacts = [...currentFacts, ...newFacts];
          }
        }
        if (formationResult.extraction.titleImproved && formationResult.title) {
          title = formationResult.title;
        }
        if (formationResult.extraction.typeCorrected && formationResult.type) {
          type = formationResult.type;
        }
        if (formationResult.extraction.entityResolved && formationResult.entityName) {
          entityName = formationResult.entityName;
        }
      }

      // ── Standard store flow ─────────────────────────────────────────
      // Ensure entity exists in knowledge graph
      await graphManager.createEntities([
        { name: entityName, entityType: 'auto', observations: [] },
      ]);

      // Auto-associate sessionId from active session
      let sessionId: string | undefined;
      try {
        const { getActiveSession } = await import('./memory/session.js');
        const active = await getActiveSession(projectDir, project.id);
        if (active) sessionId = active.id;
      } catch { /* session module not critical */ }

      // ── LLM Narrative Compression (premium quality) ─────────────────
      // Compress verbose narratives into concise core knowledge before storing.
      // Reduces token consumption ~60% while preserving all technical facts.
      let finalNarrative = narrative;
      let compressionNote = '';
      try {
        const { compressNarrative } = await import('./llm/quality.js');
        const { compressed, saved, usedLLM } = await withTimeout(
          compressNarrative(narrative, safeFacts, type),
          COMPRESSION_TIMEOUT_MS,
          'Narrative compression',
        );
        if (usedLLM && saved > 0) {
          finalNarrative = compressed;
          compressionNote = ` | compressed -${saved} tokens`;
        }
      } catch { /* compression is best-effort (timeout or LLM failure) */ }

      // ── Attribution guard (passive, non-blocking) ─────────────────
      // Warns when entityName is unknown in this project but well-established
      // in a different project — signals a potential wrong-bucket write.
      let attributionWarning = '';
      try {
        const attrCheck = await checkProjectAttribution(entityName, project.id, getAllObservations());
        if (attrCheck.suspicious) {
          attributionWarning = `\n⚠️ Attribution notice: entity "${entityName}" has 0 observations in ` +
            `"${project.id}" but ${attrCheck.count} in "${attrCheck.knownIn}" ` +
            `(confidence: ${attrCheck.confidence}). Verify the correct project is bound before storing.`;
        }
      } catch { /* guard is best-effort — never blocks the write */ }

      // Store the observation (may upsert if topicKey matches existing)
      markInternalWrite();
      const { observation: obs, upserted } = await storeObservation({
        entityName,
        type: type as ObservationType,
        title,
        narrative: finalNarrative,
        facts: safeFacts,
        filesModified: safeFiles,
        concepts: safeConcepts,
        projectId: project.id,
        topicKey,
        sessionId,
        progress: progress as import('./types.js').ProgressInfo | undefined,
        relatedCommits,
        relatedEntities,
        sourceDetail: 'explicit',
        valueCategory: formationResult?.evaluation.category,
        createdByAgentId: currentAgentId,
      });

      // Add a reference to the entity's observations
      await graphManager.addObservations([
        { entityName, contents: [`[#${obs.id}] ${title}`] },
      ]);

      // Implicit memory: auto-create relations from entity extraction
      const extracted = extractEntities([title, narrative, ...(safeFacts ?? [])].join(' '));
      const autoRelCount = await createAutoRelations(obs, extracted, graphManager);

      // Build enrichment summary
      const enrichmentParts: string[] = [];
      const autoFiles = obs.filesModified.filter((f: string) => !(safeFiles ?? []).includes(f));
      const autoConcepts = obs.concepts.filter((c: string) => !(safeConcepts ?? []).includes(c));
      if (autoFiles.length > 0) enrichmentParts.push(`+${autoFiles.length} files extracted`);
      if (autoConcepts.length > 0) enrichmentParts.push(`+${autoConcepts.length} concepts enriched`);
      if (autoRelCount > 0) enrichmentParts.push(`+${autoRelCount} relations auto-created`);
      if (obs.hasCausalLanguage) enrichmentParts.push('causal language detected');
      if (upserted) enrichmentParts.push(`topic upserted (rev ${obs.revisionCount ?? 1})`);
      const enrichment = enrichmentParts.length > 0 ? `\nAuto-enriched: ${enrichmentParts.join(', ')}` : '';

      const action = upserted ? '🔄 Updated' : '✅ Stored';

      // ── Formation Pipeline (shadow/fallback mode: observe only) ─────
      // Fire-and-forget: runs after storage to collect metrics.
      // Never blocks the MCP response — purely for A/B comparison data.
      if (!useFormation && !topicKey && !progress) {
        const shadowFormation = async () => {
          let oldCompactDecision: { action: string, targetId?: number, reason?: string, durationMs?: number } | null = null;
          try {
            const compactStart = Date.now();
            const searchResult = await compactSearch({
              query: `${title} ${narrative.substring(0, 200)}`,
              limit: 5,
              projectId: project.id,
              status: 'active',
            });
            const similarEntries = searchResult.entries.map(e => e);
            if (similarEntries.length > 0) {
              const similarIds = similarEntries.map(e => e.id);
              const details = await compactDetail(similarIds);
              const existingMemories: ExistingMemory[] = details.documents.map((d, i) => ({
                id: d.observationId,
                title: d.title,
                narrative: d.narrative,
                facts: d.facts,
                score: similarEntries[i]?.score ?? 0,
              }));
              const decision = await compactOnWrite(
                { title, narrative, facts: safeFacts ?? [] },
                existingMemories,
              );
              oldCompactDecision = {
                action: decision.action,
                targetId: decision.targetId,
                reason: decision.reason,
                durationMs: Date.now() - compactStart,
              };
            }
          } catch { /* best-effort */ }

          const formationConfig: FormationConfig = {
            mode: formationMode,
            useLLM: isLLMEnabled(),
            minValueScore: 0.3,
            searchMemories: async (q: string, limit: number, pid: string): Promise<SearchHit[]> => {
              const result = await compactSearch({ query: q, limit, projectId: pid, status: 'active' });
              if (result.entries.length === 0) return [];
              const details = await compactDetail(result.entries.map(e => e.id));
              return details.documents.map((d, i) => ({
                id: Number(d.id.replace('obs-', '')),
                observationId: d.observationId,
                title: d.title,
                narrative: d.narrative,
                facts: d.facts,
                entityName: d.entityName,
                type: d.type,
                score: result.entries[i]?.score ?? 0,
              }));
            },
            getObservation: (id: number) => {
              const o = getObservation(id);
              if (!o) return null;
              return { id: o.id, entityName: o.entityName, type: o.type, title: o.title, narrative: o.narrative, facts: o.facts, topicKey: o.topicKey };
            },
            getEntityNames: () => graphManager.getEntityNames(),
          };

          const formed = await withTimeout(
            runFormation({ entityName, type: type as ObservationType, title, narrative, facts: safeFacts, projectId: project.id, source: 'explicit', topicKey }, formationConfig),
            FORMATION_TIMEOUT_MS,
            'Shadow formation',
          );

          const { recordBeforeAfterMetrics } = await import('./memory/formation/index.js');
          if (oldCompactDecision) {
            recordBeforeAfterMetrics({
              formationAction: formed.resolution.action,
              formationTargetId: formed.resolution.targetId,
              oldCompactAction: oldCompactDecision.action as 'ADD' | 'UPDATE' | 'NONE' | 'DELETE',
              oldCompactTargetId: oldCompactDecision.targetId,
              oldCompactReason: oldCompactDecision.reason,
              formationValueScore: formed.evaluation.score,
              formationValueCategory: formed.evaluation.category,
              formationDurationMs: formed.pipeline.durationMs,
              compactDurationMs: oldCompactDecision.durationMs,
            });
          }
        };
        // Fire-and-forget — do not await
        shadowFormation().catch(() => {});
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: `${action} observation #${obs.id} "${title}" (~${obs.tokens} tokens)\nEntity: ${entityName} | Type: ${type} | Project: ${project.id}${obs.topicKey ? ` | Topic: ${obs.topicKey}` : ''}${compactAction}${compressionNote}${enrichment}${formationNote}${attributionWarning}`,
          },
        ],
      };
      }); // withFreshIndex
    },
  );

  /**
   * memorix_suggest_topic_key — Suggest a stable topic key for upserts
   *
   * Use before memorix_store when you want evolving topics to upsert
   * into a single observation instead of creating duplicates.
   */
  server.registerTool(
    'memorix_suggest_topic_key',
    {
      title: 'Suggest Topic Key',
      description:
        'Suggest a stable topic_key for memory upserts. Use this before memorix_store when you want evolving topics ' +
        '(like architecture decisions, config docs) to update a single observation over time instead of creating duplicates. ' +
        'Returns a key like "architecture/auth-model" or "bug/timeout-in-api-gateway".',
      inputSchema: {
        type: z.string().describe('Observation type (e.g., decision, architecture, bugfix, discovery)'),
        title: z.string().describe('Observation title — used to generate the stable key'),
      },
    },
    async ({ type: obsType, title }) => {
      const { suggestTopicKey } = await import('./memory/observations.js');
      const key = suggestTopicKey(obsType, title);

      if (!key) {
        return {
          content: [{ type: 'text' as const, text: 'Could not suggest topic_key from the given input. Provide a more descriptive title.' }],
          isError: true,
        };
      }

      return {
        content: [{ type: 'text' as const, text: `Suggested topic_key: \`${key}\`\n\nUse this as the \`topicKey\` parameter in \`memorix_store\` to enable upsert behavior.` }],
      };
    },
  );

  /**
   * memorix_search — Layer 1: Compact index search
   *
   * Returns a lightweight table of matching observations.
   * ~50-100 tokens per result. Agent scans this to decide what to fetch.
   */
  server.registerTool(
    'memorix_search',
    {
      title: 'Search Memory',
      description:
        'Search project memory. Returns a compact index (~50-100 tokens/result). ' +
        'Use memorix_detail to fetch full content for specific IDs. ' +
        'Use memorix_timeline to see chronological context. ' +
        'Searches across all observations stored from any IDE session — enabling cross-session and cross-agent context retrieval.',
      inputSchema: {
        query: z.string().describe('Search query (natural language or keywords)'),
        limit: z.number().optional().describe('Max results (default: 20)'),
        type: z.enum(OBSERVATION_TYPES).optional().describe('Filter by observation type'),
        maxTokens: z.number().optional().describe('Token budget — trim results to fit (0 = unlimited)'),
        scope: z.enum(['project', 'global']).optional().default('project').describe(
          'Search scope: "project" (default) only searches current project, "global" searches all projects',
        ),
        since: z.string().optional().describe('Only return observations created after this date (ISO 8601 or natural like "2025-01-15")'),
        until: z.string().optional().describe('Only return observations created before this date (ISO 8601 or natural like "2025-02-01")'),
        status: z.enum(['active', 'resolved', 'archived', 'all']).optional().default('active').describe(
          'Filter by memory status. "active" (default) shows current memories, "all" includes resolved/archived.',
        ),
        source: z.enum(['agent', 'git', 'manual']).optional().describe(
          'Filter by memory source. "git" returns only commit-derived ground truth memories. Omit for all sources.',
        ),
      },
    },
    async ({ query, limit, type, maxTokens, scope, since, until, status, source }) => {
      if (scope !== 'global') {
        const unresolved = requireResolvedProject('search the current project');
        if (unresolved) return unresolved;
      }
      return withFreshIndex(async () => {

      const safeLimit = limit != null ? coerceNumber(limit, 20) : undefined;
      const safeMaxTokens = maxTokens != null ? coerceNumber(maxTokens, 0) : undefined;

      // Tool-level timeout: abort if search takes longer than 30 seconds
      const TIMEOUT_MS = 30000;
      const searchPromise = compactSearch({
        query,
        limit: safeLimit,
        type: type as ObservationType | undefined,
        maxTokens: safeMaxTokens,
        since,
        until,
        // Default to project-scoped search to prevent cross-project pollution.
        // Use scope: 'global' to explicitly search all projects.
        projectId: scope === 'global' ? undefined : project.id,
        status: (status as 'active' | 'resolved' | 'archived' | 'all') ?? 'active',
        source: source as 'agent' | 'git' | 'manual' | undefined,
      });

      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Search timeout after ${TIMEOUT_MS}ms`)), TIMEOUT_MS)
      );

      let result;
      try {
        result = await Promise.race([searchPromise, timeoutPromise]);
      } catch (error) {
        if (error instanceof Error && error.message.includes('timeout')) {
          // Timeout: return empty result with error message
          return {
            content: [
              {
                type: 'text' as const,
                text: `Error: Search timeout after ${TIMEOUT_MS}ms. Try a simpler query or check if the service is responsive.`,
              },
            ],
            isError: true,
          };
        }
        throw error;
      }

      // Append search mode and sync advisory
      let text = result.formatted;
      try {
        const { getLastSearchMode } = await import('./store/orama-store.js');
        text += `\n\n_Search mode: ${getLastSearchMode(project.id)}_`;
      } catch { /* best-effort */ }
      if (!syncAdvisoryShown && syncAdvisory) {
        text += syncAdvisory;
        syncAdvisoryShown = true;
      }

      return {
        content: [
          {
            type: 'text' as const,
            text,
          },
        ],
      };
      }); // withFreshIndex
    },
  );

  /**
   * memorix_resolve — Mark memories as resolved/completed
   *
   * Prevents resolved memories from polluting future searches.
   * Default search only returns 'active' memories.
   */
  server.registerTool(
    'memorix_resolve',
    {
      title: 'Resolve Memories',
      description:
        'Mark observations as resolved (completed/no longer active). ' +
        'Resolved memories are hidden from default search but can still be found with status="all". ' +
        'Use this to mark completed tasks, fixed bugs, or outdated information so they don\'t pollute future context.',
      inputSchema: {
        ids: z.array(z.number()).describe('Observation IDs to mark as resolved'),
        status: z.enum(['resolved', 'archived']).optional().default('resolved').describe(
          'Target status: "resolved" (default, completed/done) or "archived" (permanently hidden)',
        ),
      },
    },
    async ({ ids, status }) => {
      const { resolveObservations } = await import('./memory/observations.js');
      const safeIds = (Array.isArray(ids) ? ids : [ids]).map(id => coerceNumber(id, 0)).filter(id => id > 0);
      const result = await resolveObservations(safeIds, (status as 'resolved' | 'archived') ?? 'resolved');

      const parts: string[] = [];
      if (result.resolved.length > 0) {
        parts.push(`✅ Resolved ${result.resolved.length} observation(s): #${result.resolved.join(', #')}`);
      }
      if (result.notFound.length > 0) {
        parts.push(`⚠️ Not found: #${result.notFound.join(', #')}`);
      }
      parts.push('\nResolved memories are hidden from default search. Use status="all" to include them.');
      parts.push('📊 Run `memorix_retention` with `action: "report"` to check remaining cleanup status.');

      return {
        content: [{ type: 'text' as const, text: parts.join('\n') }],
      };
    },
  );

  /**
   * memorix_store_reasoning — System 2 Reasoning Memory
   *
   * Store WHY a decision was made, what alternatives were considered,
   * and what the expected outcome is. This is the "reasoning trace" —
   * not just what changed, but the thought process behind it.
   *
   * Inspired by Cipher's dual-memory (Knowledge + Reflection).
   */
  server.registerTool(
    'memorix_store_reasoning',
    {
      title: 'Store Reasoning Trace',
      description:
        'Store a reasoning trace — WHY you chose this approach, what alternatives you considered, ' +
        'and what outcome you expect. This creates a searchable record of your decision-making process. ' +
        'Use this when making non-trivial technical decisions, choosing between approaches, or ' +
        'solving complex problems. Unlike regular memories that record WHAT happened, reasoning ' +
        'memories record HOW you thought about it.',
      inputSchema: {
        entityName: z.string().describe('The entity this reasoning applies to (e.g., "auth-module", "database-schema")'),
        decision: z.string().describe('What was decided or chosen'),
        alternatives: z.array(z.string()).optional().describe('Other options that were considered'),
        rationale: z.string().describe('Why this approach was chosen over alternatives'),
        constraints: z.array(z.string()).optional().describe('Constraints that influenced the decision (time, perf, compat, etc.)'),
        expectedOutcome: z.string().optional().describe('What outcome is expected from this decision'),
        risks: z.array(z.string()).optional().describe('Known risks or potential downsides'),
        concepts: z.array(z.string()).optional().describe('Related technical concepts'),
        filesModified: z.array(z.string()).optional().describe('Files related to this reasoning'),
        relatedCommits: z.array(z.string()).optional().describe('Git commit hashes this reasoning explains (links ground truth ↔ reasoning)'),
        relatedEntities: z.array(z.string()).optional().describe('Other entity names this reasoning relates to (cross-references)'),
      },
    },
    async ({ entityName, decision, alternatives, rationale, constraints, expectedOutcome, risks, concepts, filesModified, relatedCommits, relatedEntities }) => {
      const unresolved = requireResolvedProject('store reasoning in the current project');
      if (unresolved) return unresolved;
      return withFreshIndex(async () => {

      // Build structured narrative from reasoning fields
      const narrativeParts: string[] = [rationale];
      if (alternatives && alternatives.length > 0) {
        narrativeParts.push(`Alternatives considered: ${alternatives.join('; ')}`);
      }
      if (constraints && constraints.length > 0) {
        narrativeParts.push(`Constraints: ${constraints.join('; ')}`);
      }
      if (expectedOutcome) {
        narrativeParts.push(`Expected outcome: ${expectedOutcome}`);
      }
      const narrative = narrativeParts.join('. ');

      // Build facts from structured fields
      const facts: string[] = [`Decision: ${decision}`];
      if (alternatives) alternatives.forEach(a => facts.push(`Alternative considered: ${a}`));
      if (constraints) constraints.forEach(c => facts.push(`Constraint: ${c}`));
      if (risks) risks.forEach(r => facts.push(`Risk: ${r}`));
      if (expectedOutcome) facts.push(`Expected outcome: ${expectedOutcome}`);

      await graphManager.createEntities([
        { name: entityName, entityType: 'auto', observations: [] },
      ]);

      // ── Attribution guard (passive, non-blocking) ─────────────────
      let reasoningAttributionWarning = '';
      try {
        const attrCheck = await checkProjectAttribution(entityName, project.id, getAllObservations());
        if (attrCheck.suspicious) {
          reasoningAttributionWarning = `\n⚠️ Attribution notice: entity "${entityName}" has 0 observations in ` +
            `"${project.id}" but ${attrCheck.count} in "${attrCheck.knownIn}" ` +
            `(confidence: ${attrCheck.confidence}). Verify the correct project is bound before storing.`;
        }
      } catch { /* guard is best-effort — never blocks the write */ }

      markInternalWrite();
      const { observation: obs } = await storeObservation({
        entityName,
        type: 'reasoning' as ObservationType,
        title: decision.length > 80 ? decision.substring(0, 77) + '...' : decision,
        narrative,
        facts,
        concepts: concepts ?? [],
        filesModified: filesModified ?? [],
        projectId: project.id,
        source: 'agent',
        relatedCommits,
        relatedEntities,
        sourceDetail: 'explicit',
        createdByAgentId: currentAgentId,
      });

      await graphManager.addObservations([
        { entityName, contents: [`[#${obs.id}] 🧠 ${decision}`] },
      ]);

      return {
        content: [{
          type: 'text' as const,
          text: `🧠 Reasoning trace stored #${obs.id}: "${decision}"\nEntity: ${entityName} | ${facts.length} facts | ${obs.tokens} tokens${reasoningAttributionWarning}`,
        }],
      };
      }); // withFreshIndex
    },
  );

  /**
   * memorix_audit_project — Scan for misattributed observations
   *
   * Read-only audit: identifies observations in the current project whose
   * entityName is well-known in a different project but absent here.
   * Use the results to decide which observations to archive with memorix_resolve.
   */
  server.registerTool(
    'memorix_audit_project',
    {
      title: 'Audit Project Attribution',
      description:
        'Scan the current project for observations that may have been written to the wrong project bucket. ' +
        'Identifies observations whose entityName appears exclusively in a different project. ' +
        'Read-only — no data is changed. Use memorix_resolve to archive confirmed mis-attributed observations.',
      inputSchema: {
        threshold: z.number().int().min(1).optional().describe(
          'Minimum occurrences of an entityName in another project to flag it as suspicious (default: 2)',
        ),
      },
    },
    async ({ threshold }) => {
      const unresolved = requireResolvedProject('audit project attribution');
      if (unresolved) return unresolved;
      const minCount = threshold ?? 2;
      let entries: import('./memory/attribution-guard.js').AuditEntry[];
      try {
        entries = await auditProjectObservations(project.id, await withFreshIndex(() => getAllObservations()), minCount);
      } catch (err) {
        return {
          content: [{
            type: 'text' as const,
            text: `Audit failed: ${err instanceof Error ? err.message : String(err)}`,
          }],
        };
      }

      if (entries.length === 0) {
        return {
          content: [{
            type: 'text' as const,
            text: `✅ No suspicious observations found in project "${project.id}" (threshold: ${minCount}).`,
          }],
        };
      }

      const lines: string[] = [
        `## Attribution Audit — ${project.id}`,
        `Found **${entries.length}** potentially mis-attributed observation(s) (threshold: ≥${minCount} occurrences in another project).\n`,
        '| ID | Entity | Title | Source | Detail | Likely Belongs To | Count | Confidence |',
        '|----|--------|-------|--------|--------|-------------------|-------|------------|',
      ];

      for (const e of entries) {
        const titleTrunc = e.title.length > 50 ? e.title.slice(0, 47) + '...' : e.title;
        lines.push(
          `| #${e.id} | ${e.entityName} | ${titleTrunc} | ${e.source} | ${e.sourceDetail ?? '-'} | ${e.likelyBelongsTo} | ${e.count} | ${e.confidence} |`,
        );
      }

      // Actionable IDs block (cap display to avoid very long outputs)
      const auditIds = entries.map(e => e.id);
      const auditPreview = auditIds.slice(0, 20);
      const auditSummary = `[${auditPreview.join(', ')}]${auditIds.length > 20 ? ` … (${auditIds.length} total)` : ''}`;
      lines.push('');
      lines.push('### Suggested Actions');
      lines.push(`Suggested IDs: ${auditSummary}`);
      lines.push('- Archive confirmed mis-attributed observations: use `memorix_resolve` with the specific IDs above and `status: "archived"`.');
      lines.push('- Review first with `memorix_detail` if unsure.');

      return {
        content: [{ type: 'text' as const, text: lines.join('\n') }],
      };
    },
  );

  /**
   * memorix_search_reasoning — Search reasoning patterns
   *
   * Find past reasoning traces to understand WHY decisions were made.
   * Useful when revisiting code and needing to understand the thought
   * process behind the current implementation.
   */
  server.registerTool(
    'memorix_search_reasoning',
    {
      title: 'Search Reasoning Patterns',
      description:
        'Search past reasoning traces to understand WHY decisions were made. ' +
        'Returns reasoning memories that explain the thought process behind technical choices. ' +
        'Use this when revisiting code, questioning a design decision, or looking for precedent ' +
        'on how similar problems were solved before.',
      inputSchema: {
        query: z.string().describe('Search query — describe what reasoning you want to find (e.g., "why did we choose PostgreSQL", "auth approach rationale")'),
        limit: z.number().optional().describe('Max results (default: 10)'),
        scope: z.enum(['project', 'global']).optional().default('project').describe('Search scope'),
      },
    },
    async ({ query, limit, scope }) => {
      if (scope !== 'global') {
        const unresolved = requireResolvedProject('search reasoning in the current project');
        if (unresolved) return unresolved;
      }
      const safeLimit = limit != null ? coerceNumber(limit, 10) : 10;
      const result = await withFreshIndex(() => compactSearch({
        query,
        limit: safeLimit,
        type: 'reasoning' as ObservationType,
        projectId: scope === 'global' ? undefined : project.id,
        status: 'active',
      }));

      if (result.entries.length === 0) {
        return {
          content: [{ type: 'text' as const, text: 'No reasoning traces found. Use memorix_store_reasoning to record decision rationale.' }],
        };
      }

      return {
        content: [{ type: 'text' as const, text: `🧠 Reasoning Traces:\n${result.formatted}` }],
      };
    },
  );

  /**
   * memorix_deduplicate — LLM-powered batch deduplication
   *
   * Scans active memories for duplicates/contradictions and auto-resolves them.
   * Requires LLM to be configured (MEMORIX_LLM_API_KEY or OPENAI_API_KEY).
   */
  server.registerTool(
    'memorix_deduplicate',
    {
      title: 'Deduplicate Memories',
      description:
        'Scan active memories for duplicates, contradictions, and outdated information using LLM analysis. ' +
        'Automatically resolves redundant memories. Requires LLM to be configured ' +
        '(set MEMORIX_LLM_API_KEY or OPENAI_API_KEY environment variable). ' +
        'Without LLM, falls back to basic similarity-based consolidation.',
      inputSchema: {
        query: z.string().optional().describe('Optional query to scope dedup to a topic (default: scan all)'),
        dryRun: z.boolean().optional().default(false).describe('Preview only — show what would be resolved without making changes'),
      },
    },
    async ({ query, dryRun }) => {
      const { getAllObservations, resolveObservations } = await import('./memory/observations.js');
      const allObs = await withFreshIndex(() => getAllObservations().filter(o => (o.status ?? 'active') === 'active' && o.projectId === project.id));

      if (allObs.length < 2) {
        return { content: [{ type: 'text' as const, text: 'Not enough active memories to deduplicate.' }] };
      }

      if (!isLLMEnabled()) {
        return {
          content: [{
            type: 'text' as const,
            text: '⚠️ LLM not configured. Set MEMORIX_LLM_API_KEY or OPENAI_API_KEY to enable intelligent dedup.\n\n' +
              'Tip: Use memorix_consolidate for basic similarity-based merging without LLM.',
          }],
        };
      }

      // If query provided, search for relevant memories; otherwise take latest 20
      let candidates: typeof allObs;
      if (query) {
        const searchResult = await compactSearch({ query, limit: 20, projectId: project.id, status: 'active' });
        const idSet = new Set(searchResult.entries.map(e => e.id));
        candidates = allObs.filter(o => idSet.has(o.id));
      } else {
        candidates = allObs.slice(-20);
      }

      if (candidates.length < 2) {
        return { content: [{ type: 'text' as const, text: 'Not enough memories in scope to deduplicate.' }] };
      }

      // Group by entity for focused dedup
      const byEntity = new Map<string, typeof candidates>();
      for (const obs of candidates) {
        const list = byEntity.get(obs.entityName) ?? [];
        list.push(obs);
        byEntity.set(obs.entityName, list);
      }

      const actions: string[] = [];
      const toResolve: number[] = [];

      for (const [entity, group] of byEntity) {
        if (group.length < 2) continue;

        // Compare each pair within entity group
        for (let i = 0; i < group.length; i++) {
          for (let j = i + 1; j < group.length; j++) {
            const newer = group[j];
            const older = group[i];
            try {
              const decision = await deduplicateMemory(
                { title: newer.title, narrative: newer.narrative, facts: newer.facts },
                [{ id: older.id, title: older.title, narrative: older.narrative, facts: older.facts.join('\n') }],
              );
              if (decision && decision.action === 'UPDATE' && decision.targetId) {
                actions.push(`🔄 #${older.id} "${older.title}" → superseded by #${newer.id} (${decision.reason})${decision.usedLLM ? ' [LLM]' : ' [heuristic]'}`);
                toResolve.push(older.id);
              } else if (decision && decision.action === 'NONE') {
                actions.push(`🗑️ #${newer.id} "${newer.title}" → redundant (${decision.reason})${decision.usedLLM ? ' [LLM]' : ' [heuristic]'}`);
                toResolve.push(newer.id);
              } else if (decision && decision.action === 'DELETE') {
                actions.push(`❌ #${decision.targetId ?? older.id} → outdated (${decision.reason})${decision.usedLLM ? ' [LLM]' : ' [heuristic]'}`);
                toResolve.push(decision.targetId ?? older.id);
              }
            } catch (dedupErr) { actions.push(`⚠️ comparison failed: ${(dedupErr as Error)?.message ?? dedupErr}`); }
          }
        }
      }

      if (actions.length === 0) {
        return { content: [{ type: 'text' as const, text: `✅ Scanned ${candidates.length} memories across ${byEntity.size} entities — no duplicates found.` }] };
      }

      if (dryRun) {
        return {
          content: [{
            type: 'text' as const,
            text: `🔍 DRY RUN — ${actions.length} action(s) found:\n\n${actions.join('\n')}\n\nRun with dryRun=false to apply.`,
          }],
        };
      }

      // Apply resolutions
      const unique = [...new Set(toResolve)];
      await resolveObservations(unique, 'resolved');

      return {
        content: [{
          type: 'text' as const,
          text: `🧹 Deduplicated: resolved ${unique.length} memory(ies)\n\n${actions.join('\n')}`,
        }],
      };
    },
  );

  /**
   * memorix_timeline — Deep retrieval: provenance-aware chronological expansion
   *
   * Natural follow-up after session L1 routing hints (hook traces) or L3
   * evidence pointers (git memory). Distinguishes explicit memory evolution,
   * hook activity traces, and git-backed facts via Src column when available.
   */
  server.registerTool(
    'memorix_timeline',
    {
      title: 'Memory Timeline',
      description:
        'Deep retrieval: expand chronological context around a specific observation — ' +
        'distinguishes explicit memory evolution, hook activity traces, and git-backed facts. ' +
        'Natural follow-up after session L1 routing hints (hook traces) or L3 evidence pointers (git memory).',
      inputSchema: {
        anchorId: z.number().describe('Observation ID to center the timeline on'),
        depthBefore: z.number().optional().describe('Number of observations before (default: 3)'),
        depthAfter: z.number().optional().describe('Number of observations after (default: 3)'),
      },
    },
    async ({ anchorId, depthBefore, depthAfter }) => {
      const safeAnchor = coerceNumber(anchorId, 0);
      const safeBefore = depthBefore != null ? coerceNumber(depthBefore, 3) : undefined;
      const safeAfter = depthAfter != null ? coerceNumber(depthAfter, 3) : undefined;
      const result = await compactTimeline(
        safeAnchor,
        project.id,
        safeBefore,
        safeAfter,
      );

      return {
        content: [
          {
            type: 'text' as const,
            text: result.formatted,
          },
        ],
      };
    },
  );

  /**
   * memorix_detail — Layer 3: Provenance-aware full observation details
   *
   * Opens explicit memories, hook traces, or git evidence depending on source.
   * Output includes a provenance header identifying the evidence kind, value
   * category (core / ephemeral), and cross-references to related items.
   */
  server.registerTool(
    'memorix_detail',
    {
      title: 'Memory Details',
      description:
        'Fetch full observation or mini-skill details — includes source kind (explicit memory / hook trace / git evidence), ' +
        'value category, and cross-references (~500-1000 tokens each). ' +
        'Always use memorix_search first to find relevant IDs, then fetch only what you need. ' +
        'Accepts typed refs from search results (e.g. "obs:42", "skill:3") via the typedRefs field, ' +
        'or legacy numeric ids / object refs for backward compatibility.',
      inputSchema: {
        ids: z.array(z.number()).optional().describe('Observation IDs to fetch (legacy, from memorix_search results)'),
        refs: z.array(
          z.object({
            id: z.number().describe('Observation ID'),
            projectId: z.string().optional().describe('Project ID for global-search disambiguation'),
          }),
        ).optional().describe('Explicit observation refs. Prefer this for global search results.'),
        typedRefs: z.array(z.string()).optional().describe('Typed memory refs from search results, e.g. "obs:42", "skill:3", "obs:42@org/proj"'),
      },
    },
    async ({ ids, refs, typedRefs }) => {
      // Defensive coercion: Claude Code CLI + GLM may send "[16]" instead of [16]
      const safeIds = coerceNumberArray(ids);
      const safeRefs = coerceObservationRefs(refs);
      const safeTypedRefs = coerceStringArray(typedRefs);

      // Priority: typedRefs > refs > ids (each is a complete, homogeneous input path)
      let result;
      try {
        if (safeTypedRefs.length > 0) {
          // Pass typed ref strings directly — compactDetail handles parsing
          result = await compactDetail(safeTypedRefs);
        } else if (safeRefs.length > 0) {
          result = await compactDetail(safeRefs);
        } else {
          // Bare numeric IDs are scoped to the current project
          result = await compactDetail(safeIds.map(id => ({ id, projectId: project.id })));
        }
      } catch (err) {
        return { content: [{ type: 'text' as const, text: err instanceof Error ? err.message : String(err) }], isError: true };
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: result.documents.length > 0
              ? result.formatted
              : safeTypedRefs.length > 0
                ? `No memories found for refs: ${safeTypedRefs.join(', ')}`
                : safeRefs.length > 0
                  ? `No memories found for refs: ${safeRefs.map((ref) => `${ref.projectId ?? 'current'}#${ref.id}`).join(', ')}`
                  : `No memories found for IDs: ${safeIds.join(', ')}`,
          },
        ],
      };
    },
  );

  // ================================================================
  // Memorix Retention & Decay Tools (inspired by mcp-memory-service + MemCP)
  // ================================================================

  /**
   * memorix_retention — Memory retention status
   *
   * Shows which observations are active, stale, or candidates for archiving.
   * Uses exponential decay scoring from mcp-memory-service.
   */
  server.registerTool(
    'memorix_retention',
    {
      title: 'Memory Retention Status & Archive',
      description:
        'Show memory retention status or archive expired memories. ' +
        'action="report" (default): show active/stale/archive-candidate counts. ' +
        'action="archive": move expired observations to archive file (reversible). ' +
        'action="stale": list stale observations with full retention explanation. ' +
        'Uses exponential decay scoring based on importance, age, and access patterns.',
      inputSchema: {
        action: z.enum(['report', 'archive', 'stale']).optional().describe('Action: "report" (show status, default) or "archive" (move expired to archive) or "stale" (list stale observations with explanation)'),
      },
    },
    async (args: { action?: string }) => {
      const action = args.action ?? 'report';
      const { getRetentionSummary, getArchiveCandidates, rankByRelevance, archiveExpired, getRetentionZone, explainRetention } = await import('./memory/retention.js');
      const { getDb } = await import('./store/orama-store.js');
      const { search } = await import('@orama/orama');

      // Shared: build MemorixDocument[] from in-memory observations
      const { getAllObservations } = await import('./memory/observations.js');
      const allObs = await withFreshIndex(() => getAllObservations());

      // Pull current access metadata from the live Orama index so access-based
      // immunity (e.g. accessCount >= 3) still works in retention/report/archive
      // paths even though observations.json itself does not persist those fields.
      const accessMap = new Map<number, { accessCount: number; lastAccessedAt: string }>();
      try {
        const database = await getDb();
        const accessResults = await search(database, {
          term: '',
          limit: Math.max(1, allObs.length),
        });
        for (const hit of accessResults.hits) {
          const doc = hit.document as unknown as import('./types.js').MemorixDocument;
          accessMap.set(doc.observationId, {
            accessCount: doc.accessCount ?? 0,
            lastAccessedAt: doc.lastAccessedAt ?? '',
          });
        }
      } catch {
        // Best-effort: retention still works without access metadata, just with
        // less precise immunity/reporting.
      }

      // Handle archive action
      if (action === 'archive') {
        const result = await archiveExpired(projectDir, undefined, accessMap);
        if (result.archived === 0) {
          return {
            content: [{ type: 'text' as const, text: '✅ No expired observations to archive. All memories are within their retention period.' }],
          };
        }
        return {
          content: [{ type: 'text' as const, text: `🗄️ Archived ${result.archived} expired observations (status set to 'archived' in-place)\n${result.remaining} active observations remaining.\n\nArchived memories are hidden from default search but can be found with status: "all".` }],
        };
      }

      const docs: import('./types.js').MemorixDocument[] = allObs.map(obs => ({
        id: `obs-${obs.id}`,
        observationId: obs.id,
        entityName: obs.entityName,
        type: obs.type,
        title: obs.title,
        narrative: obs.narrative,
        facts: obs.facts.join('\n'),
        filesModified: obs.filesModified.join('\n'),
        concepts: obs.concepts.join(', '),
        tokens: obs.tokens,
        createdAt: obs.createdAt,
        projectId: obs.projectId,
        accessCount: accessMap.get(obs.id)?.accessCount ?? 0,
        lastAccessedAt: accessMap.get(obs.id)?.lastAccessedAt ?? '',
        status: obs.status ?? 'active',
        source: obs.source ?? 'agent',
        sourceDetail: obs.sourceDetail ?? '',
        valueCategory: obs.valueCategory ?? '',
      }));

      if (docs.length === 0) {
        return {
          content: [{ type: 'text' as const, text: 'No observations found for this project.' }],
        };
      }

      // ── action="stale": full table of stale observations with explanation ──
      if (action === 'stale') {
        const staleDocs = docs.filter(d => getRetentionZone(d) === 'stale');
        if (staleDocs.length === 0) {
          return {
            content: [{ type: 'text' as const, text: '✅ No stale observations. All active memories are within 50% of their retention period.' }],
          };
        }
        const staleLines: string[] = [
          `## Stale Observations (${staleDocs.length})`,
          '',
          '| ID | Entity | Title | Age | Source | Retention | Why |',
          '|----|--------|-------|-----|--------|-----------|-----|',
        ];
        for (const d of staleDocs) {
          const exp = explainRetention(d);
          const src = d.sourceDetail || '—';
          const vc = d.valueCategory || '—';
          staleLines.push(
            `| ${d.observationId} | ${d.entityName} | ${d.title} | ${exp.ageDays}d | ${src} (${vc}) | ${exp.effectiveRetentionDays}d | ${exp.summary} |`,
          );
        }
        staleLines.push('');
        staleLines.push('> 💡 Stale = past 50% of effective retention. Review or access to keep; otherwise will become archive candidates.');

        // Actionable IDs block
        const staleIds = staleDocs.map(d => d.observationId);
        staleLines.push('');
        staleLines.push('### Suggested Actions');
        staleLines.push(`Suggested IDs: [${staleIds.join(', ')}]`);
        staleLines.push(`- Archive stale observations: \`memorix_resolve\` with \`ids: [${staleIds.join(', ')}]\` and \`status: "archived"\``);
        staleLines.push('- Or review individually with `memorix_detail` before deciding.');

        return {
          content: [{ type: 'text' as const, text: staleLines.join('\n') }],
        };
      }

      // ── action="report" (default): concise summary ──
      const summary = getRetentionSummary(docs);
      const candidates = getArchiveCandidates(docs);
      const ranked = rankByRelevance(docs);

      // Source breakdown
      const srcCounts = new Map<string, number>();
      for (const d of docs) {
        const key = d.sourceDetail || '(undefined)';
        srcCounts.set(key, (srcCounts.get(key) ?? 0) + 1);
      }

      const lines: string[] = [
        `## Memory Retention Status`,
        ``,
        `| Zone | Count |`,
        `|------|-------|`,
        `| Active | ${summary.active} |`,
        `| Stale | ${summary.stale} |`,
        `| Archive Candidates | ${summary.archiveCandidates} |`,
        `| Immune | ${summary.immune} |`,
        `| **Total** | **${docs.length}** |`,
        ``,
        `### Source Breakdown`,
        `| Source | Count |`,
        `|--------|-------|`,
      ];
      for (const [src, count] of [...srcCounts.entries()].sort((a, b) => b[1] - a[1])) {
        lines.push(`| ${src} | ${count} |`);
      }
      lines.push('');

      if (candidates.length > 0) {
        lines.push(`### Archive Candidates (${candidates.length})`);
        lines.push(`| ID | Title | Age | Retention | Why |`);
        lines.push(`|----|-------|-----|-----------|-----|`);
        for (const c of candidates.slice(0, 10)) {
          const exp = explainRetention(c);
          lines.push(`| ${c.observationId} | ${c.title} | ${exp.ageDays}d | ${exp.effectiveRetentionDays}d | ${exp.summary} |`);
        }
        if (candidates.length > 10) {
          lines.push(`| … | *(${candidates.length - 10} more)* | | | |`);
        }
        const candidateIds = candidates.map(c => c.observationId);
        lines.push('');
        lines.push(`Candidate IDs: [${candidateIds.slice(0, 20).join(', ')}]${candidateIds.length > 20 ? ` … (${candidateIds.length} total)` : ''}`);
        lines.push(`> 💡 Use \`memorix_retention\` with \`action: "archive"\` to move all, or \`memorix_resolve\` with specific IDs.`);
        lines.push('');
      }

      if (summary.stale > 0) {
        lines.push(`> 📋 ${summary.stale} stale observation(s) — use \`memorix_retention\` with \`action: "stale"\` for full details.`);
        lines.push('');
      }

      // Top 5 most relevant
      lines.push(`### Top 5 Most Relevant`);
      lines.push(`| ID | Title | Score | Decay | Access Boost |`);
      lines.push(`|----|-------|-------|-------|-------------|`);
      for (const r of ranked.slice(0, 5)) {
        const doc = docs.find((d) => d.observationId === r.observationId);
        lines.push(
          `| ${r.observationId} | ${doc?.title ?? '?'} | ${r.totalScore.toFixed(3)} | ${r.decayFactor.toFixed(3)} | ${r.accessBoost.toFixed(1)}× |`,
        );
      }

      return {
        content: [{ type: 'text' as const, text: lines.join('\n') }],
      };
    },
  );

  /**
   * memorix_formation_metrics — Formation Pipeline shadow mode metrics
   *
   * Shows aggregated metrics from the Memory Formation Pipeline running
   * in shadow mode. Useful for evaluating pipeline quality before
   * switching from shadow to active mode.
   */
  server.registerTool(
    'memorix_formation_metrics',
    {
      title: 'Formation Pipeline Metrics',
      description:
        'Show aggregated metrics from recent Memory Formation Pipeline runs. ' +
        'Reports value scores, resolution actions, fact extraction rates, and processing times.',
      inputSchema: {},
    },
    async () => {
      const summary = getMetricsSummary();
      const beforeAfter = getBeforeAfterMetrics();

      if (summary.total === 0) {
        return {
          content: [{
            type: 'text' as const,
            text: '📊 Formation Pipeline: No metrics collected yet.\nStore some observations to start collecting runtime data.',
          }],
        };
      }

      const lines: string[] = [
        '📊 **Formation Pipeline Metrics**',
        '',
        `**Total observations processed:** ${summary.total}`,
        `**Average value score:** ${summary.avgValueScore.toFixed(3)}`,
        `**Average processing time:** ${summary.avgDurationMs.toFixed(1)}ms`,
        '',
        '### Quality Indicators',
        `- **Avg system-extracted facts:** ${summary.avgExtractedFacts.toFixed(1)} per observation`,
        `- **Title improved rate:** ${(summary.titleImprovedRate * 100).toFixed(1)}%`,
        `- **Entity resolved rate:** ${(summary.entityResolvedRate * 100).toFixed(1)}%`,
        `- **Type corrected rate:** ${(summary.typeCorectedRate * 100).toFixed(1)}%`,
        '',
        '### Value Categories',
      ];

      for (const [cat, count] of Object.entries(summary.categoryBreakdown)) {
        const pct = ((count / summary.total) * 100).toFixed(1);
        const icon = cat === 'core' ? '🟢' : cat === 'contextual' ? '🟡' : '🔴';
        lines.push(`- ${icon} **${cat}:** ${count} (${pct}%)`);
      }

      lines.push('', '### Resolution Actions');
      for (const [action, count] of Object.entries(summary.resolutionBreakdown)) {
        const pct = ((count / summary.total) * 100).toFixed(1);
        lines.push(`- **${action}:** ${count} (${pct}%)`);
      }

      // ── Before/After Comparison Metrics ─────────────────────────
      if (beforeAfter.totalProcessed > 0) {
        lines.push(
          '',
          '### Before/After Comparison (Formation vs Old Compact)',
          `**Total comparisons:** ${beforeAfter.totalProcessed}`,
          `**Agreements:** ${beforeAfter.agreements} (${((beforeAfter.agreements / beforeAfter.totalProcessed) * 100).toFixed(1)}%)`,
          `**Disagreements:** ${beforeAfter.disagreements} (${((beforeAfter.disagreements / beforeAfter.totalProcessed) * 100).toFixed(1)}%)`,
          '',
          '### Disagreement Breakdown',
          `- Formation discarded, Compact added: ${beforeAfter.disagreementBreakdown.formationDiscardedCompactAdded}`,
          `- Formation merged, Compact added: ${beforeAfter.disagreementBreakdown.formationMergedCompactAdded}`,
          `- Formation added, Compact discarded: ${beforeAfter.disagreementBreakdown.formationAddedCompactDiscarded}`,
          '- Formation added, Compact merged: ' + beforeAfter.disagreementBreakdown.formationAddedCompactMerged,
          '- Formation evolved, Compact added: ' + beforeAfter.disagreementBreakdown.formationEvolvedCompactAdded,
          '- Other: ' + beforeAfter.disagreementBreakdown.other,
          '',
          '### Quality Improvements',
          `- Formation discarded low-value: ${beforeAfter.quality.formationDiscardedLowValue}`,
          `- Formation merged duplicates: ${beforeAfter.quality.formationMergedDuplicates}`,
          `- Formation evolved outdated: ${beforeAfter.quality.formationEvolvedOutdated}`,
          `- Compact missed duplicates: ${beforeAfter.quality.compactMissedDuplicates}`,
          `- Compact kept low-value: ${beforeAfter.quality.compactKeptLowValue}`,
          '',
          `### Duration Comparison`,
          `- Formation avg: ${beforeAfter.duration.formationAvgMs.toFixed(1)}ms`,
          `- Compact avg: ${beforeAfter.duration.compactAvgMs.toFixed(1)}ms`,
          `- Diff: ${beforeAfter.duration.diffMs.toFixed(1)}ms`,
        );
      }

      return {
        content: [{ type: 'text' as const, text: lines.join('\n') }],
      };
    },
  );

  // ================================================================
  // MCP Official Memory Server Compatible Tools (optional — 9 tools)
  // Enable via ~/.memorix/settings.json { "knowledgeGraph": true }
  // ================================================================

  let enableKG = false;
  try {
    const { homedir } = await import('node:os');
    const { join } = await import('node:path');
    const { readFile } = await import('node:fs/promises');
    const raw = await readFile(join(homedir(), '.memorix', 'settings.json'), 'utf-8');
    const s = JSON.parse(raw);
    if (s.knowledgeGraph === true) enableKG = true;
  } catch { /* no settings or parse error — default off */ }

  if (enableKG) {

  /** create_entities — MCP Official compatible */
  server.registerTool(
    'create_entities',
    {
      title: 'Create Entities',
      description: 'Create multiple new entities in the knowledge graph',
      inputSchema: {
        entities: z.array(z.object({
          name: z.string().describe('The name of the entity'),
          entityType: z.string().describe('The type of the entity'),
          observations: z.array(z.string()).describe('Initial observations'),
        })),
      },
    },
    async ({ entities }) => {
      const unresolved = requireResolvedProject('create entities in the knowledge graph');
      if (unresolved) return unresolved;
      const safeEntities = coerceObjectArray<{ name: string; entityType: string; observations: string[] }>(entities);
      const result = await graphManager.createEntities(safeEntities);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  /** create_relations — MCP Official compatible, enhanced with typed relation suggestions */
  server.registerTool(
    'create_relations',
    {
      title: 'Create Relations',
      description:
        'Create multiple new relations between entities in the knowledge graph. Relations should be in active voice. ' +
        'Recommended relation types (from mcp-memory-service): causes, fixes, supports, opposes, contradicts, ' +
        'depends_on, implements, extends, replaces, documents',
      inputSchema: {
        relations: z.array(z.object({
          from: z.string().describe('Source entity name'),
          to: z.string().describe('Target entity name'),
          relationType: z.string().describe('Type of relation (e.g., causes, fixes, supports, depends_on, implements)'),
        })),
      },
    },
    async ({ relations }) => {
      const unresolved = requireResolvedProject('create relations in the knowledge graph');
      if (unresolved) return unresolved;
      const safeRelations = coerceObjectArray<{ from: string; to: string; relationType: string }>(relations);
      const result = await graphManager.createRelations(safeRelations);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  /** add_observations — MCP Official compatible */
  server.registerTool(
    'add_observations',
    {
      title: 'Add Observations',
      description: 'Add new observations to existing entities in the knowledge graph',
      inputSchema: {
        observations: z.array(z.object({
          entityName: z.string().describe('Entity name to add observations to'),
          contents: z.array(z.string()).describe('Observation contents to add'),
        })),
      },
    },
    async ({ observations }) => {
      const unresolved = requireResolvedProject('add observations to the knowledge graph');
      if (unresolved) return unresolved;
      const safeObs = coerceObjectArray<{ entityName: string; contents: string[] }>(observations);
      const result = await graphManager.addObservations(safeObs);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  /** delete_entities — MCP Official compatible */
  server.registerTool(
    'delete_entities',
    {
      title: 'Delete Entities',
      description: 'Delete multiple entities and their associated relations from the knowledge graph',
      inputSchema: {
        entityNames: z.array(z.string()).describe('Entity names to delete'),
      },
    },
    async ({ entityNames }) => {
      const unresolved = requireResolvedProject('delete entities from the knowledge graph');
      if (unresolved) return unresolved;
      const safeNames = coerceStringArray(entityNames);
      await graphManager.deleteEntities(safeNames);
      return {
        content: [{ type: 'text' as const, text: 'Entities deleted successfully' }],
      };
    },
  );

  /** delete_observations — MCP Official compatible */
  server.registerTool(
    'delete_observations',
    {
      title: 'Delete Observations',
      description: 'Delete specific observations from entities in the knowledge graph',
      inputSchema: {
        deletions: z.array(z.object({
          entityName: z.string().describe('Entity containing the observations'),
          observations: z.array(z.string()).describe('Observations to delete'),
        })),
      },
    },
    async ({ deletions }) => {
      const unresolved = requireResolvedProject('delete observations from the knowledge graph');
      if (unresolved) return unresolved;
      const safeDeletions = coerceObjectArray<{ entityName: string; observations: string[] }>(deletions);
      await graphManager.deleteObservations(safeDeletions);
      return {
        content: [{ type: 'text' as const, text: 'Observations deleted successfully' }],
      };
    },
  );

  /** delete_relations — MCP Official compatible */
  server.registerTool(
    'delete_relations',
    {
      title: 'Delete Relations',
      description: 'Delete multiple relations from the knowledge graph',
      inputSchema: {
        relations: z.array(z.object({
          from: z.string(),
          to: z.string(),
          relationType: z.string(),
        })),
      },
    },
    async ({ relations }) => {
      const unresolved = requireResolvedProject('delete relations from the knowledge graph');
      if (unresolved) return unresolved;
      const safeRelations = coerceObjectArray<{ from: string; to: string; relationType: string }>(relations);
      await graphManager.deleteRelations(safeRelations);
      return {
        content: [{ type: 'text' as const, text: 'Relations deleted successfully' }],
      };
    },
  );

  /** Filter a KnowledgeGraph to only entities referenced by the current project's observations */
  async function scopeGraphToProject(graph: { entities: any[]; relations: any[] }) {
    const { getAllObservations } = await import('./memory/observations.js');
    const allObs = await withFreshIndex(() => getAllObservations());
    const projectEntityNames = new Set(
      allObs
        .filter(o => o.projectId === project.id && (o.status ?? 'active') === 'active' && o.entityName)
        .map(o => o.entityName),
    );
    const entities = graph.entities.filter((e: any) => projectEntityNames.has(e.name));
    const entityNameSet = new Set(entities.map((e: any) => e.name));
    const relations = graph.relations.filter((r: any) => entityNameSet.has(r.from) && entityNameSet.has(r.to));
    return { entities, relations };
  }

  /** read_graph — MCP Official compatible */
  server.registerTool(
    'read_graph',
    {
      title: 'Read Graph',
      description: 'Read the entire knowledge graph',
      inputSchema: {},
    },
    async () => {
      const unresolved = requireResolvedProject('read the knowledge graph');
      if (unresolved) return unresolved;
      const graph = await graphManager.readGraph();
      const scoped = await scopeGraphToProject(graph);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(scoped, null, 2) }],
      };
    },
  );

  /** search_nodes — MCP Official compatible (basic string search) */
  server.registerTool(
    'search_nodes',
    {
      title: 'Search Nodes',
      description: 'Search for nodes in the knowledge graph based on a query',
      inputSchema: {
        query: z.string().describe('Search query to match against entity names, types, and observations'),
      },
    },
    async ({ query }) => {
      const unresolved = requireResolvedProject('search nodes in the knowledge graph');
      if (unresolved) return unresolved;
      const graph = await graphManager.searchNodes(query);
      const scoped = await scopeGraphToProject(graph);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(scoped, null, 2) }],
      };
    },
  );

  /** open_nodes — MCP Official compatible */
  server.registerTool(
    'open_nodes',
    {
      title: 'Open Nodes',
      description: 'Open specific nodes in the knowledge graph by their names',
      inputSchema: {
        names: z.array(z.string()).describe('Entity names to retrieve'),
      },
    },
    async ({ names }) => {
      const unresolved = requireResolvedProject('open nodes in the knowledge graph');
      if (unresolved) return unresolved;
      const safeNames = coerceStringArray(names);
      const graph = await graphManager.openNodes(safeNames);
      const scoped = await scopeGraphToProject(graph);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(scoped, null, 2) }],
      };
    },
  );

  } // end if (enableKG)

  // ============================================================
  // Rules Sync Tool (P2 — Memorix differentiator)
  // ============================================================

  const RULE_SOURCES: [string, ...string[]] = ['cursor', 'claude-code', 'codex', 'windsurf', 'antigravity', 'copilot', 'kiro', 'opencode', 'trae'];

  /** memorix_rules_sync — scan, dedup, and generate rules across agents */
  server.registerTool(
    'memorix_rules_sync',
    {
      title: 'Rules Sync',
      description:
        'Scan project for agent rule files (Cursor, Claude Code, Codex, Windsurf, Antigravity, Copilot, Kiro, OpenCode, Trae), ' +
        'deduplicate, detect conflicts, and optionally generate rules for a target agent format. ' +
        'Without target: returns sync status report. With target: generates converted rule files.',
      inputSchema: {
        action: z.enum(['status', 'generate']).describe('Action: "status" for report, "generate" to produce target files'),
        target: z.enum(RULE_SOURCES).optional().describe('Target agent format for generation (required when action=generate)'),
      },
    },
    async ({ action, target }) => {
      const syncer = new RulesSyncer(project.rootPath);

      if (action === 'status') {
        const status = await syncer.syncStatus();
        const lines = [
          `## Rules Sync Status`,
          ``,
          `**Sources found:** ${status.sources.join(', ') || 'none'}`,
          `**Total rules:** ${status.totalRules}`,
          `**Unique rules:** ${status.uniqueRules}`,
          `**Conflicts:** ${status.conflicts.length}`,
        ];

        if (status.conflicts.length > 0) {
          lines.push('', '### Conflicts');
          for (const c of status.conflicts) {
            lines.push(`- **${c.ruleA.source}** \`${c.ruleA.id}\` vs **${c.ruleB.source}** \`${c.ruleB.id}\`: ${c.reason}`);
          }
        }

        return {
          content: [{ type: 'text' as const, text: lines.join('\n') }],
        };
      }

      // action === 'generate'
      if (!target) {
        return {
          content: [{ type: 'text' as const, text: 'Error: target is required for generate action' }],
          isError: true,
        };
      }

      const rules = await syncer.scanRules();
      const deduped = syncer.deduplicateRules(rules);
      const effectiveTarget = target === 'opencode' ? 'codex' : target;
      const files = syncer.generateForTarget(deduped, effectiveTarget as RuleSource);

      const lines = [
        `## Generated ${files.length} file(s) for ${target}`,
        '',
      ];
      for (const f of files) {
        lines.push(`### \`${f.filePath}\``, '```', f.content, '```', '');
      }
      lines.push('> Use these contents to create the rule files in your project.');

      return {
        content: [{ type: 'text' as const, text: lines.join('\n') }],
      };
    },
  );

  // ============================================================
  // Workspace Sync Tool (P3 — Cross-Agent Workspace Bridge)
  // ============================================================

  const AGENT_TARGETS: [string, ...string[]] = ['windsurf', 'cursor', 'claude-code', 'codex', 'copilot', 'antigravity', 'kiro', 'opencode', 'trae'];

  /** memorix_workspace_sync — migrate entire workspace config across agents */
  server.registerTool(
    'memorix_workspace_sync',
    {
      title: 'Workspace Sync',
      description:
        'Migrate your entire workspace environment between AI coding agents (Cursor, Windsurf, Claude Code, Codex, Copilot, Kiro, Antigravity, OpenCode, Trae). ' +
        'Syncs MCP server configs, workflows, rules, and skills across IDEs. ' +
        'Action "scan": detect all workspace configs. ' +
        'Action "migrate": generate configs for target agent (preview only). ' +
        'Action "apply": migrate AND write configs to disk with backup/rollback.',
      inputSchema: {
        action: z.enum(['scan', 'migrate', 'apply']).describe('Action: "scan" to detect configs, "migrate" to preview, "apply" to write to disk'),
        target: z.enum(AGENT_TARGETS).optional().describe('Target agent for migration (required for migrate)'),
        items: z.array(z.string()).optional().describe('Selective sync: list specific MCP server or skill names to sync (e.g. ["figma-remote-mcp-server", "create-subagent"]). Omit to sync all.'),
      },
    },
    async ({ action, target, items }) => {
      const engine = new WorkspaceSyncEngine(project.rootPath);

      if (action === 'scan') {
        const scan = await engine.scan();
        const lines = [
          `## Workspace Scan Report`,
          '',
          `### MCP Server Configs`,
        ];

        for (const [agent, servers] of Object.entries(scan.mcpConfigs)) {
          if ((servers as MCPServerEntry[]).length > 0) {
            lines.push(`- **${agent}**: ${(servers as MCPServerEntry[]).length} server(s) — ${(servers as MCPServerEntry[]).map((s: MCPServerEntry) => s.name).join(', ')}`);
          }
        }

        lines.push('', `### Workflows`);
        if (scan.workflows.length > 0) {
          for (const wf of scan.workflows) {
            lines.push(`- **${wf.name}** (${wf.source}): ${wf.description || '(no description)'}`);
          }
        } else {
          lines.push('- No workflows found');
        }

        lines.push('', `### Rules`);
        lines.push(`- ${scan.rulesCount} rule(s) detected across all agents`);

        lines.push('', `### Skills`);
        if (scan.skills.length > 0) {
          for (const sk of scan.skills) {
            lines.push(`- **${sk.name}** (${sk.sourceAgent}): ${sk.description || '(no description)'}`);
          }
        } else {
          lines.push('- No skills found');
        }

        if (scan.skillConflicts.length > 0) {
          lines.push('', `### ⚠️ Skill Name Conflicts`);
          for (const c of scan.skillConflicts) {
            lines.push(`- **${c.name}**: kept from ${c.kept.sourceAgent}, duplicate in ${c.skipped.sourceAgent}`);
          }
        }

        return {
          content: [{ type: 'text' as const, text: lines.join('\n') }],
        };
      }

      // action === 'migrate' or 'apply' — both need target
      if (!target) {
        return {
          content: [{ type: 'text' as const, text: 'Error: target is required for migrate/apply action' }],
          isError: true,
        };
      }

      if (action === 'apply') {
        const applyResult = await engine.apply(target as AgentTarget, items);
        return {
          content: [{ type: 'text' as const, text: applyResult.migrationSummary }],
          ...(applyResult.success ? {} : { isError: true }),
        };
      }

      // action === 'migrate' (preview only)
      const result = await engine.migrate(target as AgentTarget, items);
      const lines = [
        `## Workspace Migration → ${target}`,
        '',
      ];

      if (result.mcpServers.generated.length > 0) {
        lines.push('### MCP Config');
        for (const f of result.mcpServers.generated) {
          lines.push(`#### \`${f.filePath}\``, '```', f.content, '```', '');
        }
      }

      if (result.workflows.generated.length > 0) {
        lines.push('### Workflows');
        for (const f of result.workflows.generated) {
          lines.push(`#### \`${f.filePath}\``, '```', f.content, '```', '');
        }
      }

      if (result.rules.generated > 0) {
        lines.push(`### Rules`, `- ${result.rules.generated} rule file(s) generated`);
      }

      if (result.skills.scanned.length > 0) {
        lines.push('### Skills', `- ${result.skills.scanned.length} skill(s) found, ready to copy:`);
        for (const sk of result.skills.scanned) {
          lines.push(`  - **${sk.name}** (from ${sk.sourceAgent})`);
        }
      }

      lines.push('', '> Review the generated configs above. Use action "apply" to write them to disk.');

      return {
        content: [{ type: 'text' as const, text: lines.join('\n') }],
      };
    },
  );

  // ============================================================
  // memorix_skills — Memory-driven project skills
  // ============================================================

  server.registerTool(
    'memorix_skills',
    {
      title: 'Project Skills',
      description:
        'Memory-driven project skills. ' +
        'Action "list": show all available skills from all agents. ' +
        'Action "generate": auto-generate project-specific skills from observation patterns (gotchas, decisions, how-it-works). ' +
        'Action "inject": return a specific skill\'s full content for direct use. ' +
        'Generated skills follow the SKILL.md standard and can be synced across Cursor, Windsurf, Claude Code, Codex, Copilot, Kiro, Antigravity, OpenCode, and Trae.',
      inputSchema: {
        action: z.enum(['list', 'generate', 'inject']).describe('Action: "list" to discover skills, "generate" to create from memory, "inject" to get skill content'),
        name: z.string().optional().describe('Skill name (required for "inject")'),
        target: z.enum(AGENT_TARGETS).optional().describe('Target agent to write generated skills to (optional for "generate")'),
        write: z.boolean().optional().describe('Whether to write generated skills to disk (default: false, preview only)'),
      },
    },
    async ({ action, name, target, write }) => {
      const { SkillsEngine } = await import('./skills/engine.js');
      const engine = new SkillsEngine(project.rootPath);

      if (action === 'list') {
        const skills = engine.listSkills();
        if (skills.length === 0) {
          return {
            content: [{ type: 'text' as const, text: 'No skills found in any agent directory.\n\nSkills are discovered from:\n- `.cursor/skills/*/SKILL.md`\n- `.agents/skills/*/SKILL.md`\n- `.agent/skills/*/SKILL.md`\n- `.windsurf/skills/*/SKILL.md`\n- etc.\n\nUse action "generate" to auto-create skills from your project observations.' }],
          };
        }

        const lines = [
          `## Available Skills (${skills.length})`,
          '',
        ];
        for (const sk of skills) {
          lines.push(`- **${sk.name}** (${sk.sourceAgent}): ${sk.description || '(no description)'}`);
        }
        lines.push('', '> Use `action: "inject", name: "<skill-name>"` to get full skill content.');

        return {
          content: [{ type: 'text' as const, text: lines.join('\n') }],
        };
      }

      if (action === 'inject') {
        if (!name) {
          return {
            content: [{ type: 'text' as const, text: 'Error: `name` is required for inject action. Use `action: "list"` first to see available skills.' }],
            isError: true,
          };
        }

        const skill = engine.injectSkill(name);
        if (!skill) {
          return {
            content: [{ type: 'text' as const, text: `Skill "${name}" not found. Use \`action: "list"\` to see available skills.` }],
            isError: true,
          };
        }

        return {
          content: [{ type: 'text' as const, text: `## Skill: ${skill.name}\n**Source**: ${skill.sourceAgent}\n**Path**: ${skill.sourcePath}\n\n---\n\n${skill.content}` }],
        };
      }

      // action === 'generate'
      const { getObservationStore: getStore } = await import('./store/obs-store.js');
      const allObs = await getStore().loadAll() as Array<{
        id?: number; entityName?: string; type?: string; title?: string;
        narrative?: string; facts?: string[]; concepts?: string[];
        filesModified?: string[]; createdAt?: string;
        status?: string; source?: 'agent' | 'git' | 'manual';
      }>;

      const obsData = allObs.map(o => ({
        id: o.id || 0,
        entityName: o.entityName || 'unknown',
        type: o.type || 'discovery',
        title: o.title || '',
        narrative: o.narrative || '',
        facts: o.facts,
        concepts: o.concepts,
        filesModified: o.filesModified,
        createdAt: o.createdAt,
        status: o.status,
        source: o.source,
      }));

      const generated = engine.generateFromObservations(obsData);

      if (generated.length === 0) {
        return {
          content: [{ type: 'text' as const, text: 'No skill-worthy patterns found yet.\n\nSkills are auto-generated when entities accumulate enough observations (3+), especially gotchas, decisions, and how-it-works notes.\n\nKeep using memorix_store to build up project knowledge!' }],
        };
      }

      const lines = [
        `## Generated Skills (${generated.length})`,
        '',
        'Based on observation patterns in your project memory:',
        '',
      ];

      for (const sk of generated) {
        lines.push(`### ${sk.name}`);
        lines.push(`- **Description**: ${sk.description}`);
        lines.push(`- **Observations**: ${sk.content.split('\n').length} lines of knowledge`);

        if (write && target) {
          const path = engine.writeSkill(sk, target as AgentTarget);
          if (path) {
            lines.push(`- ✅ **Written**: \`${path}\``);
          } else {
            lines.push(`- ❌ Failed to write`);
          }
        }
        lines.push('');
      }

      if (!write) {
        lines.push('> Preview only. Add `write: true, target: "<agent>"` to save skills to disk.');
      }

      // Show first generated skill as preview
      if (generated.length > 0) {
        lines.push('', '---', '### Preview: ' + generated[0].name, '', '```markdown', generated[0].content, '```');
      }

      return {
        content: [{ type: 'text' as const, text: lines.join('\n') }],
      };
    },
  );

  // ============================================================
  // Mini-Skills — Promote memories to permanent skills
  // ============================================================

  /**
   * memorix_promote — Promote observations to permanent mini-skills
   *
   * Converts important memories into permanent, never-decaying mini-skills
   * that are automatically injected into agent context at session_start.
   */
  server.registerTool(
    'memorix_promote',
    {
      title: 'Promote to Mini-Skill',
      description:
        'Promote observations to permanent mini-skills that never decay and are auto-injected at session start. ' +
        'Action "promote": convert observation(s) to a mini-skill. ' +
        'Action "list": show all active mini-skills. ' +
        'Action "delete": remove a mini-skill by ID.\n\n' +
        'Mini-skills are project-specific specialized knowledge derived from your actual memories — ' +
        'gotchas, decisions, fixes that generic online skills cannot provide.',
      inputSchema: {
        action: z.enum(['promote', 'list', 'delete']).describe('Action to perform'),
        observationIds: z.array(z.number()).optional().describe('Observation IDs to promote (required for "promote")'),
        skillId: z.number().optional().describe('Mini-skill ID to delete (required for "delete")'),
        trigger: z.string().optional().describe('Override: when this skill should be applied'),
        instruction: z.string().optional().describe('Override: what the agent should do'),
        tags: z.array(z.string()).optional().describe('Extra classification tags'),
      },
    },
    async ({ action, observationIds, skillId, trigger, instruction, tags }) => {
      const { promoteToMiniSkill, loadAllMiniSkills, deleteMiniSkill, formatMiniSkillsForInjection } = await import('./skills/mini-skills.js');

      if (action === 'list') {
        const skills = await loadAllMiniSkills(projectDir);
        if (skills.length === 0) {
          return {
            content: [{ type: 'text' as const, text: 'No mini-skills found.\n\nUse `action: "promote", observationIds: [<id>]` to convert important memories into permanent mini-skills.\nThese will be auto-injected at every session start.' }],
          };
        }
        const formatted = formatMiniSkillsForInjection(skills);
        const lines = [
          formatted,
          '---',
          `Total: ${skills.length} mini-skill(s)`,
          '',
          '> Use `action: "delete", skillId: <id>` to remove a mini-skill.',
        ];
        return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
      }

      if (action === 'delete') {
        if (skillId == null) {
          return { content: [{ type: 'text' as const, text: 'Error: `skillId` is required for delete action.' }], isError: true };
        }
        const deleted = await deleteMiniSkill(projectDir, skillId);
        if (!deleted) {
          return { content: [{ type: 'text' as const, text: `Mini-skill #${skillId} not found.` }], isError: true };
        }
        return { content: [{ type: 'text' as const, text: `✅ Deleted mini-skill #${skillId}.` }] };
      }

      // action === 'promote'
      if (!observationIds || observationIds.length === 0) {
        return { content: [{ type: 'text' as const, text: 'Error: `observationIds` is required for promote action. Use `memorix_search` to find observation IDs.' }], isError: true };
      }

      // Load observations by ID — only active observations can be promoted
      const { getAllObservations } = await import('./memory/observations.js');
      const allObs = await withFreshIndex(() => getAllObservations());
      const matched = allObs.filter(o => observationIds.includes(o.id));

      if (matched.length === 0) {
        return { content: [{ type: 'text' as const, text: `No observations found for IDs: [${observationIds.join(', ')}]. Use \`memorix_search\` to find valid IDs.` }], isError: true };
      }

      // Fail-fast: ALL matched observations must be active — no silent drop
      const nonActive = matched.filter(o => (o.status ?? 'active') !== 'active');
      if (nonActive.length > 0) {
        return { content: [{ type: 'text' as const, text: `Cannot promote: ${nonActive.length} observation(s) are not active: ${nonActive.map(o => `#${o.id} (${o.status})`).join(', ')}. Only active observations can be promoted to permanent knowledge.` }], isError: true };
      }

      const skill = await promoteToMiniSkill(projectDir, project.id, matched, { trigger, instruction, tags });

      const lines = [
        `✅ Created mini-skill #${skill.id}`,
        '',
        `**${skill.title}**`,
        `**Do**: ${skill.instruction}`,
        `**When**: ${skill.trigger}`,
      ];
      if (skill.facts.length > 0) {
        lines.push('**Facts**:');
        for (const f of skill.facts) lines.push(`- ${f}`);
      }
      lines.push('', `Source: ${matched.length} observation(s) [${matched.map((o: any) => o.id).join(', ')}]`);
      lines.push('', '> This mini-skill will be auto-injected at every `memorix_session_start`.');

      return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
    },
  );

  // ============================================================
  // Memory Consolidation
  // ============================================================

  /**
   * memorix_consolidate — Merge similar observations to reduce bloat
   */
  server.registerTool(
    'memorix_consolidate',
    {
      title: 'Consolidate Memories',
      description:
        'Find and merge similar observations to reduce memory bloat. ' +
        'Uses text similarity to cluster related observations by entity+type, then merges them into single consolidated records. ' +
        'Use action="preview" to see candidates without changing data, action="execute" to merge.\n\n' +
        'Example: 10 similar gotchas about Windows paths → 1 consolidated gotcha with all facts preserved.',
      inputSchema: {
        action: z.enum(['preview', 'execute']).describe('preview = dry run showing candidates, execute = actually merge'),
        threshold: z.number().optional().describe('Similarity threshold 0.0-1.0 (default: 0.45). Lower = more aggressive merging'),
      },
    },
    async ({ action, threshold }) => {
      const safeThreshold = threshold != null ? coerceNumber(threshold, 0.45) : undefined;
      const { findConsolidationCandidates, executeConsolidation } = await import('./memory/consolidation.js');

      if (action === 'preview') {
        const clusters = await findConsolidationCandidates(projectDir, project.id, { threshold: safeThreshold });

        if (clusters.length === 0) {
          return { content: [{ type: 'text' as const, text: '✅ No consolidation candidates found. Your memories are already clean!' }] };
        }

        const lines = [`## Consolidation Preview`, `Found **${clusters.length}** clusters to merge:`, ''];
        for (let i = 0; i < clusters.length; i++) {
          const c = clusters[i];
          lines.push(`### Cluster ${i + 1} (${c.ids.length} observations, ~${(c.similarity * 100).toFixed(0)}% similar)`);
          lines.push(`Entity: \`${c.entityName}\` | Type: ${c.type}`);
          for (const title of c.titles) lines.push(`- ${title}`);
          lines.push('');
        }
        const totalMergeable = clusters.reduce((sum, c) => sum + c.ids.length - 1, 0);
        lines.push(`> Run with \`action: "execute"\` to merge. This will remove **${totalMergeable}** duplicate observations.`);

        return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
      }

      // Execute
      const result = await executeConsolidation(projectDir, project.id, { threshold: safeThreshold });

      if (result.clustersFound === 0) {
        return { content: [{ type: 'text' as const, text: '✅ No consolidation needed. Memories are already clean!' }] };
      }

      const lines = [
        `## Consolidation Complete`,
        `- Clusters merged: **${result.clustersFound}**`,
        `- Observations removed: **${result.observationsMerged}**`,
        `- Observations remaining: **${result.observationsAfter}**`,
        '',
      ];
      for (const m of result.merges) {
        lines.push(`- Merged [${m.mergedIds.join(', ')}] → "${m.resultTitle}" (${m.factCount} facts)`);
      }

      return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
    },
  );

  // ============================================================
  // Session Lifecycle Tools (inspired by Engram)
  // ============================================================

  /**
   * memorix_session_start — Start a new coding session
   *
   * Creates a session record and returns context from previous sessions.
   * This is the entry point for session-aware memory management.
   */
  server.registerTool(
    'memorix_session_start',
    {
      title: 'Start Session',
      description:
        'Start a new coding session. Returns context from previous sessions so you can resume work seamlessly. ' +
        'Call this at the beginning of a session to track activity and get injected context. ' +
        'Any previous active session for this project will be auto-closed.\n\n' +
        'IMPORTANT for HTTP/control-plane mode: pass `projectRoot` with the absolute path to your ' +
        'workspace root (e.g., the directory open in your IDE). Memorix uses this to detect the git ' +
        'project and bind this session to the correct project context. Without it, project-scoped ' +
        'tools will be disabled.',
      inputSchema: {
        sessionId: z.string().optional().describe('Custom session ID (auto-generated if omitted)'),
        agent: z.string().optional().describe('Agent/IDE name (e.g., "cursor", "windsurf", "claude-code")'),
        agentType: z.string().optional().describe('Agent type for durable identity (e.g., "windsurf", "cursor"). Defaults to agent if omitted.'),
        instanceId: z.string().optional().describe('Stable instance ID for durable identity across restarts. Auto-generated if omitted.'),
        projectRoot: z.string().optional().describe(
          'Absolute path to the workspace/project root directory (e.g., the folder open in your IDE). ' +
          'Memorix will detect the git project from this path and bind this session to it. ' +
          'Required for HTTP transport when multiple projects are open simultaneously.',
        ),
      },
    },
    async ({ sessionId, agent, agentType, instanceId, projectRoot: explicitRoot }) => {
      // Phase 4a: clear agent identity — must not bleed from prior session_start
      currentAgentId = undefined;

      // ── Explicit project binding via projectRoot ──────────────────────
      // If the caller provides projectRoot, attempt to switch/bind to that project
      // BEFORE checking whether the project is resolved. This is the primary
      // mechanism for HTTP/control-plane multi-project support.
      if (explicitRoot && typeof explicitRoot === 'string') {
        let bound = await switchProject(explicitRoot);
        // Fallback: workspace root may contain a git project in a subdirectory
        if (!bound) {
          const { findGitInSubdirs } = await import('./project/detector.js');
          const subGit = findGitInSubdirs(explicitRoot);
          if (subGit) {
            bound = await switchProject(subGit);
          }
        }
        // switchProject returns false for "same project, no-op" — that's still success,
        // but ONLY when the canonical projectId matches the currently bound project.
        // We must NOT treat "different valid repo at a different path" as a no-op success.
        if (!bound && projectResolved) {
          const { detectProjectWithDiagnostics: diagnose } = await import('./project/detector.js');
          const diag = diagnose(explicitRoot);
          if (diag.project) {
            const { registerAlias: regAlias } = await import('./project/aliases.js');
            const resolvedCanonical = await regAlias(diag.project);
            if (resolvedCanonical === project.id) {
              // Same canonical project — switchProject returned false because it's a no-op.
              bound = true;
            }
            // else: different canonical project — fall through to fail-closed path below
          }
        }
        if (!bound) {
          // Explicit projectRoot was provided but no git repo found.
          // ALWAYS fail closed — never silently fall back to a previously bound project.
          const { detectProjectWithDiagnostics: diagnose } = await import('./project/detector.js');
          const diag = diagnose(explicitRoot);
          const failureDetail = diag.failure
            ? `\nDiagnostic: [${diag.failure.reason}] ${diag.failure.detail}`
            : '';
          const hint = projectResolved
            ? `The session was previously bound to "${project.name}" (${project.id}), but the explicitly requested path has no git repo. Refusing to silently reuse the old binding.`
            : 'No project is currently bound to this session.';
          return {
            content: [{
              type: 'text' as const,
              text:
                `Cannot bind session to project.\n` +
                `No git repository found at "${explicitRoot}".${failureDetail}\n` +
                `${hint}\n\n` +
                'Ensure the path points to a directory containing a .git folder (or a subdirectory of one). ' +
                'Run "git init" in your project root if needed.',
            }],
            isError: true as const,
          };
        }
        // Bound successfully — mark as explicitly bound so roots won't override
        explicitProjectBound = true;
      }

      const unresolved = requireResolvedProject('start a project session');
      if (unresolved) return unresolved;

      const { startSession } = await import('./memory/session.js');
      const result = await startSession(projectDir, project.id, { sessionId, agent });

      const llmStatus = isLLMEnabled()
        ? `LLM enhanced mode: ${getLLMConfig()?.provider}/${getLLMConfig()?.model} (fact extraction + auto-dedup active)`
        : 'LLM mode: off (set MEMORIX_LLM_API_KEY to enable enhanced memory quality)';

      // Phase 4a: Auto-register agent in TeamStore for durable identity
      let registeredAgent: import('./team/team-store.js').TeamAgentRow | null = null;
      let watermarkInfo = '';
      let rescueInfo = '';
      try {
        if (typeof teamStore !== 'undefined' && (agent || agentType)) {
          registeredAgent = teamStore.registerAgent({
            projectId: project.id,
            agentType: agentType || agent || 'unknown',
            instanceId: instanceId || undefined,
            name: agent || agentType || undefined,
          });

          // Set session-level agent identity for observation attribution
          currentAgentId = registeredAgent.agent_id;

          // Watermark: project-scoped count of new observations since last seen
          // Uses computeWatermark (extracted to team/poll.ts for reuse by memorix_poll)
          // withFreshIndex ensures cross-process writes are visible before counting
          const { computeWatermark } = await import('./team/poll.js');
          const lastSeen = registeredAgent.last_seen_obs_generation;
          const store = getObservationStore();
          const currentGen = store.getGeneration();
          const projectObs = await withFreshIndex(() => getAllObservations().filter(
            o => o.projectId === project.id && (o.writeGeneration ?? 0) > lastSeen,
          ));
          const wm = computeWatermark(lastSeen, currentGen, projectObs.length);
          if (wm.newObservationCount > 0) {
            watermarkInfo = `📊 ${wm.newObservationCount} new observation(s) in this project since your last session.`;
          }

          // Update watermark to current global generation (high-water mark for next session)
          teamStore.updateWatermark(registeredAgent.agent_id, currentGen);

          // Phase 4b: Rescue detection — detect stale agents and surface rescued tasks
          // detectAndMarkStale releases tasks from agents with stale heartbeats
          const STALE_TTL_MS = 5 * 60 * 1000; // 5 minutes without heartbeat = stale
          const rescuedAgentIds = teamStore.detectAndMarkStale(project.id, STALE_TTL_MS);
          if (rescuedAgentIds.length > 0) {
            rescueInfo = `🚑 ${rescuedAgentIds.length} stale agent(s) detected and rescued.`;
          }

          // Check for available tasks (including any just-rescued ones)
          const availableTasks = teamStore.listTasks(project.id, { available: true });
          if (availableTasks.length > 0) {
            rescueInfo += rescueInfo ? '\n' : '';
            rescueInfo += `📋 ${availableTasks.length} task(s) available to claim. Use memorix_poll for details.`;
          }
        }
      } catch { /* team auto-registration is best-effort */ }

      const lines = [
        `✅ Session started: ${result.session.id}`,
        `Project: ${project.name} (${project.id})`,
        result.session.agent ? `Agent: ${result.session.agent}` : '',
        registeredAgent ? `Agent ID: ${registeredAgent.agent_id} (instance: ${registeredAgent.instance_id})` : '',
        llmStatus,
        watermarkInfo,
        rescueInfo,
        '',
        '💡 Tips: Use `memorix_resolve` to mark completed tasks. Use `progress` param in `memorix_store` for task tracking. Use `topicKey` to prevent duplicate memories.',
        '',
      ];

      // Inject mini-skills (permanent, never-decaying project knowledge)
      // Filter out demo/test/system-self skills so they don't pollute unrelated projects.
      try {
        const { loadMiniSkills, formatMiniSkillsForInjection, recordMiniSkillUsage } = await import('./skills/mini-skills.js');
        const SKILL_NOISE = [
          /\bdemo\b/i, /展示/i, /全能力/i, /\[test\]/i, /\[测试\]/i, /测试/i,
          /验证/i, /兼容/i, /compat/i, /memmcp/i, /memorix-demo/i, /sandbox/i,
          /playground/i, /benchmark/i, /handoff/i, /交接/i, /for_memmcp/i,
        ];
        const allSkills = await loadMiniSkills(projectDir, project.id);
        const miniSkills = allSkills.filter(s => {
          const text = `${s.title}\n${s.sourceEntity}\n${s.instruction}`.toLowerCase();
          return !SKILL_NOISE.some(p => p.test(text));
        });
        if (miniSkills.length > 0) {
          const formatted = formatMiniSkillsForInjection(miniSkills);
          lines.push('---', '', formatted);
          // Record usage asynchronously (don't block response)
          recordMiniSkillUsage(projectDir, miniSkills.map(s => s.id)).catch(() => {});
        }
      } catch { /* mini-skills not available yet — skip */ }

      if (result.previousContext) {
        lines.push('---', '📋 **Context from previous sessions:**', '', result.previousContext);
      } else {
        lines.push('No previous session context found. This appears to be a fresh project.');
      }

      // Inject team context if any agents are active (Phase 4a: SQLite-backed)
      try {
        if (typeof teamStore !== 'undefined') {
          const activeAgents = teamStore.listAgents(project.id, { status: 'active' });
          if (activeAgents.length > 0) {
            lines.push('', '---', '👥 **Team Status:**');
            for (const a of activeAgents) {
              lines.push(`- 🟢 ${a.name}${a.role ? ` (${a.role})` : ''}`);
            }

            // Show locked files
            const locks = teamStore.listLocks(project.id);
            if (locks.length > 0) {
              lines.push('', '🔒 **Locked files:**');
              for (const l of locks) {
                const owner = teamStore.getAgent(l.locked_by);
                lines.push(`- ${l.file} — ${owner?.name ?? l.locked_by.slice(0, 8)}`);
              }
            }

            lines.push('', '💡 Use `team_manage` to register, `team_message` to check inbox, `team_task` to see tasks.');
          }
        }
      } catch { /* team context injection is optional */ }

      return {
        content: [{ type: 'text' as const, text: lines.filter(Boolean).join('\n') }],
      };
    },
  );

  /**
   * memorix_session_end — End the current coding session
   *
   * Marks the session as completed with a structured summary.
   */
  server.registerTool(
    'memorix_session_end',
    {
      title: 'End Session',
      description:
        'End a coding session with a structured summary. This summary will be injected into the next session ' +
        'so the next agent can resume work seamlessly.\n\n' +
        'Recommended summary format:\n' +
        '## Goal\n[What we were working on]\n\n' +
        '## Discoveries\n- [Technical findings, gotchas, learnings]\n\n' +
        '## Accomplished\n- ✅ [Completed tasks]\n- 🔲 [Pending for next session]\n\n' +
        '## Relevant Files\n- path/to/file — [what changed]',
      inputSchema: {
        sessionId: z.string().describe('Session ID to close (from memorix_session_start)'),
        summary: z.string().optional().describe('Structured session summary (Goal/Discoveries/Accomplished/Files format)'),
      },
    },
    async ({ sessionId, summary }) => {
      const { endSession } = await import('./memory/session.js');
      const session = await endSession(projectDir, sessionId, summary);

      if (!session) {
        return {
          content: [{ type: 'text' as const, text: `Session "${sessionId}" not found.` }],
          isError: true,
        };
      }

      return {
        content: [{
          type: 'text' as const,
          text: `✅ Session "${sessionId}" completed.\nDuration: ${session.startedAt} → ${session.endedAt}\n${summary ? 'Summary saved for next session context injection.' : 'No summary provided — consider adding one for better cross-session context.'}`,
        }],
      };
    },
  );

  /**
   * memorix_session_context — Get context from previous sessions
   *
   * Use this for compaction recovery or to manually retrieve session history.
   */
  server.registerTool(
    'memorix_session_context',
    {
      title: 'Session Context',
      description:
        'Get context from previous coding sessions. Use this after compaction to recover lost context, ' +
        'or to manually review session history. Returns previous session summaries and key observations.',
      inputSchema: {
        limit: z.number().optional().describe('Number of recent sessions to include (default: 3)'),
      },
    },
    async ({ limit }) => {
      const safeLimit = limit != null ? coerceNumber(limit, 3) : 3;
      const { getSessionContext, listSessions } = await import('./memory/session.js');
      const context = await getSessionContext(projectDir, project.id, safeLimit);
      const sessions = await listSessions(projectDir, project.id);

      const activeSessions = sessions.filter(s => s.status === 'active');
      const completedSessions = sessions.filter(s => s.status === 'completed');

      const header = [
        `## Session Stats`,
        `- Active: ${activeSessions.length}`,
        `- Completed: ${completedSessions.length}`,
        `- Total: ${sessions.length}`,
        '',
      ];

      if (!context) {
        return {
          content: [{ type: 'text' as const, text: header.join('\n') + '\nNo previous session context available.' }],
        };
      }

      return {
        content: [{ type: 'text' as const, text: header.join('\n') + context }],
      };
    },
  );

  // ============================================================
  // Export / Import
  // ============================================================

  /**
   * memorix_transfer — Export or import project memories
   */
  server.registerTool(
    'memorix_transfer',
    {
      title: 'Transfer Memories',
      description:
        'Export or import project memories. ' +
        'Action "export": export observations and sessions (JSON or Markdown). ' +
        'Action "import": import from a JSON export (re-assigns IDs, skips duplicate topicKeys).',
      inputSchema: {
        action: z.enum(['export', 'import']).describe('Operation: export or import'),
        format: z.enum(['json', 'markdown']).optional().describe('Export format (for export, default: json)'),
        data: z.string().optional().describe('JSON string from a previous export (for import)'),
      },
    },
    async ({ action, format, data: jsonStr }) => {
      if (action === 'export') {
        const { exportAsJson, exportAsMarkdown } = await import('./memory/export-import.js');
        if (format === 'markdown') {
          const md = await exportAsMarkdown(projectDir, project.id);
          return { content: [{ type: 'text' as const, text: md }] };
        }
        const data = await exportAsJson(projectDir, project.id);
        const json = JSON.stringify(data, null, 2);
        return {
          content: [{
            type: 'text' as const,
            text: `Export complete — ${data.stats.observationCount} observations, ${data.stats.sessionCount} sessions\n\n\`\`\`json\n${json}\n\`\`\`\n\n> Use action "import" on another machine to restore.`,
          }],
        };
      }
      // import
      if (!jsonStr) return { content: [{ type: 'text' as const, text: '❌ data is required for import' }], isError: true };
      const { importFromJson } = await import('./memory/export-import.js');
      let parsed;
      try { parsed = JSON.parse(jsonStr); } catch {
        return { content: [{ type: 'text' as const, text: 'Invalid JSON. Provide the exact output from export.' }], isError: true };
      }
      const result = await importFromJson(projectDir, parsed);
      return {
        content: [{
          type: 'text' as const,
          text: `Import complete — ${result.observationsImported} observations, ${result.sessionsImported} sessions imported, ${result.skipped} skipped`,
        }],
      };
    },
  );

  // ============================================================
  // memorix_dashboard — Launch the web dashboard
  // ============================================================

  let dashboardRunning = false;

  server.registerTool(
    'memorix_dashboard',
    {
      title: 'Launch Dashboard',
      description:
        'Launch the Memorix Web Dashboard in the browser. ' +
        'Shows knowledge graph, observations, retention scores, and project stats in a visual interface.',
      inputSchema: {
        port: z.number().optional().describe('Port to run the dashboard on (default: 3210)'),
      },
    },
    async ({ port: dashboardPort }) => {
      const portNum = dashboardPort != null ? coerceNumber(dashboardPort, 3210) : 3210;
      const url = `http://localhost:${portNum}`;

      if (dashboardRunning) {
        // Verify the dashboard is actually still listening (process may have been killed externally)
        const { createConnection } = await import('node:net');
        const isAlive = await new Promise<boolean>(resolve => {
          const sock = createConnection(portNum, '127.0.0.1');
          sock.once('connect', () => { sock.destroy(); resolve(true); });
          sock.once('error', () => { sock.destroy(); resolve(false); });
          setTimeout(() => { sock.destroy(); resolve(false); }, 1000);
        });

        if (isAlive) {
          // Update the dashboard server's current project via API
          const http = await import('node:http');
          const postData = JSON.stringify({ projectId: project.id, projectName: project.name });
          await new Promise<void>(resolve => {
            const req = http.request({
              hostname: '127.0.0.1', port: portNum,
              path: '/api/set-current-project', method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) },
            }, () => resolve());
            req.on('error', () => resolve()); // ignore errors
            req.write(postData);
            req.end();
          });

          // Open browser — the dashboard now serves this project as current
          const projectUrl = `${url}?project=${encodeURIComponent(project.id)}`;
          const { exec } = await import('node:child_process');
          const cmd =
            process.platform === 'win32' ? `start "" "${projectUrl}"` :
              process.platform === 'darwin' ? `open "${projectUrl}"` :
                `xdg-open "${projectUrl}"`;
          exec(cmd, () => { });
          return {
            content: [{ type: 'text' as const, text: `Dashboard is already running at ${url}. Switched to project: ${project.name} (${project.id}).` }],
          };
        }

        // Dashboard process was killed externally — reset flag and fall through to restart
        console.error('[memorix] Dashboard process no longer running, restarting...');
        dashboardRunning = false;
      }

      try {
        const pathMod = await import('node:path');
        const fsMod = await import('node:fs');
        const { fileURLToPath } = await import('node:url');
        const { startDashboard } = await import('./dashboard/server.js');

        // Try multiple strategies to find the static files directory
        // When running from CLI (dist/cli/index.js), __dirname = dist/cli/, need to go up
        const candidates = [
          pathMod.default.join(__dirname, '..', 'dashboard', 'static'),
          pathMod.default.join(__dirname, 'dashboard', 'static'),
          pathMod.default.join(pathMod.default.dirname(fileURLToPath(import.meta.url)), '..', 'dashboard', 'static'),
          pathMod.default.join(pathMod.default.dirname(fileURLToPath(import.meta.url)), 'dashboard', 'static'),
        ];

        // Log all candidates for debugging
        for (const [i, c] of candidates.entries()) {
          const hasIndex = fsMod.existsSync(pathMod.default.join(c, 'index.html'));
          console.error(`[memorix] candidate[${i}]: ${c} (has index.html: ${hasIndex})`);
        }

        let staticDir = candidates[0];
        for (const c of candidates) {
          if (fsMod.existsSync(pathMod.default.join(c, 'index.html'))) {
            staticDir = c;
            break;
          }
        }
        console.error(`[memorix] Dashboard staticDir: ${staticDir}`);

        // Start in background (non-blocking), disable auto-open (we'll open it ourselves)
        startDashboard(projectDir, portNum, staticDir, project.id, project.name, false, {
            teamStore,
          } as any)
          .then(() => { dashboardRunning = true; })
          .catch((err) => { console.error('[memorix] Dashboard error:', err); dashboardRunning = false; });

        // Poll until the server is actually listening (up to 5s)
        const { createConnection } = await import('node:net');
        await new Promise<void>(resolve => {
          const deadline = Date.now() + 5000;
          const tryConnect = () => {
            const sock = createConnection(portNum, '127.0.0.1');
            sock.once('connect', () => { sock.destroy(); resolve(); });
            sock.once('error', () => {
              sock.destroy();
              if (Date.now() < deadline) setTimeout(tryConnect, 100);
              else resolve(); // give up, return anyway
            });
          };
          tryConnect();
        });
        dashboardRunning = true;

        // Open browser from MCP side
        const { exec: execCmd } = await import('node:child_process');
        const openCmd =
          process.platform === 'win32' ? `start "" "${url}"` :
            process.platform === 'darwin' ? `open "${url}"` :
              `xdg-open "${url}"`;
        execCmd(openCmd, () => { });

        return {
          content: [{
            type: 'text' as const,
            text: [
              `Memorix Dashboard started!`,
              ``,
              `URL: ${url}`,
              `Project: ${project.name} (${project.id})`,
              `Static: ${staticDir}`,
              ``,
              `The dashboard has been opened in your default browser.`,
              `It shows your knowledge graph, observations, retention scores, and project stats.`,
            ].join('\n'),
          }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Failed to start dashboard: ${err instanceof Error ? err.message : String(err)}` }],
        };
      }
    },
  );

  // ================================================================
  // Team Collaboration Tools (Multi-Agent) — Phase 4a: SQLite-backed
  // ================================================================

  const { initTeamStore } = await import('./team/team-store.js');

  // Use shared TeamStore (from HTTP server) or create new one (stdio mode).
  // All team state is canonical in SQLite — no JSON persistence, no sync/flush.
  let teamStore: Awaited<ReturnType<typeof initTeamStore>>;
  if (sharedTeam?.teamStore) {
    teamStore = sharedTeam.teamStore;
  } else {
    teamStore = await initTeamStore(projectDir);
  }

  // Phase 4b: Wire EventBus for same-process lifecycle notifications.
  // EventBus is process-local only — NOT a cross-process mechanism.
  if (!teamStore.getEventBus()) {
    const { TeamEventBus } = await import('./team/event-bus.js');
    teamStore.setEventBus(new TeamEventBus());
  }

  // ── team_manage (join / leave / status) ─────────────────────────
  server.registerTool(
    'team_manage',
    {
      title: 'Team Management',
      description:
        'Register, unregister, or list agents in the team. ' +
        'Action "join": register this agent (returns agent ID and instance ID for reactivation). ' +
        'Action "leave": mark agent inactive, release locks. ' +
        'Action "status": list all agents with roles and capabilities.',
      inputSchema: {
        action: z.enum(['join', 'leave', 'status']).describe('Operation to perform'),
        name: z.string().optional().describe('Agent display name for join (e.g., "cursor-frontend")'),
        agentType: z.string().optional().describe('Agent type for join (e.g., "windsurf", "cursor", "claude-code")'),
        instanceId: z.string().optional().describe('Stable instance ID for join (preserves identity across restarts)'),
        role: z.string().optional().describe('Agent role for join'),
        capabilities: z.array(z.string()).optional().describe('Agent capabilities for join'),
        agentId: z.string().optional().describe('Agent ID for leave'),
      },
    },
    async ({ action, name, agentType, instanceId, role, capabilities, agentId }) => {
      if (action === 'join') {
        const agent = teamStore.registerAgent({
          projectId: project.id,
          agentType: agentType || 'unknown',
          instanceId: instanceId || undefined,
          name: (name || '').trim() || undefined,
          role,
          capabilities: capabilities ? coerceStringArray(capabilities) : undefined,
        });
        const caps = agent.capabilities ? JSON.parse(agent.capabilities) : [];
        return {
          content: [{
            type: 'text' as const,
            text: `✅ Joined team as "${agent.name}" (ID: ${agent.agent_id})\nInstance ID: ${agent.instance_id}\nRole: ${agent.role ?? 'unspecified'}\nActive agents: ${teamStore.getActiveCount(project.id)}`,
          }],
        };
      }
      if (action === 'leave') {
        if (!agentId) return { content: [{ type: 'text' as const, text: '❌ agentId is required for leave' }], isError: true };
        const left = teamStore.leaveAgent(agentId);
        if (!left) return { content: [{ type: 'text' as const, text: '⚠️ Agent not found' }] };
        const releasedLocks = teamStore.releaseAllLocks(agentId);
        const releasedTasks = teamStore.releaseTasksByAgent(agentId);
        const parts: string[] = [];
        if (releasedLocks > 0) parts.push(`released ${releasedLocks} lock(s)`);
        if (releasedTasks > 0) parts.push(`released ${releasedTasks} task(s)`);
        return {
          content: [{
            type: 'text' as const,
            text: `Left team.${parts.length > 0 ? ' ' + parts.join(', ') + '.' : ''}\nActive agents: ${teamStore.getActiveCount(project.id)}`,
          }],
        };
      }
      // status
      const agents = teamStore.listAgents(project.id);
      if (agents.length === 0) {
        return { content: [{ type: 'text' as const, text: 'No agents registered. Use action "join" to register.' }] };
      }
      const lines = agents.map((a: import('./team/team-store.js').TeamAgentRow) => {
        const caps = a.capabilities ? JSON.parse(a.capabilities) : [];
        return `${a.status === 'active' ? '●' : '○'} ${a.name} (${a.agent_id.slice(0, 8)}…) — ${a.role ?? 'no role'} [${caps.join(', ') || '-'}]`;
      });
      return {
        content: [{
          type: 'text' as const,
          text: `Team: ${teamStore.getActiveCount(project.id)} active / ${agents.length} total\n\n${lines.join('\n')}`,
        }],
      };
    },
  );

  // ── team_file_lock (lock / unlock / status) ───────────────────
  server.registerTool(
    'team_file_lock',
    {
      title: 'File Lock Management',
      description:
        'Advisory file locks to prevent conflicting edits. Auto-releases after 10 min TTL. ' +
        'Action "lock": acquire lock. Action "unlock": release lock. Action "status": check lock status.',
      inputSchema: {
        action: z.enum(['lock', 'unlock', 'status']).describe('Operation to perform'),
        file: z.string().optional().describe('File path (required for lock/unlock, optional for status — omit to list all)'),
        agentId: z.string().optional().describe('Agent ID (required for lock/unlock)'),
      },
    },
    async ({ action, file, agentId }) => {
      if (action === 'lock') {
        if (!file || !agentId) return { content: [{ type: 'text' as const, text: '❌ file and agentId are required for lock' }], isError: true };
        const agent = teamStore.getAgent(agentId);
        if (!agent || agent.status !== 'active') {
          return { content: [{ type: 'text' as const, text: `❌ Unknown or inactive agent: ${agentId.slice(0, 8)}…` }], isError: true };
        }
        const result = teamStore.acquireLock(project.id, file, agentId);
        if (result.success) return { content: [{ type: 'text' as const, text: `Locked: ${file}` }] };
        const owner = teamStore.getAgent(result.lockedBy);
        return { content: [{ type: 'text' as const, text: `Denied — locked by ${owner?.name ?? result.lockedBy.slice(0, 8)}` }], isError: true };
      }
      if (action === 'unlock') {
        if (!file || !agentId) return { content: [{ type: 'text' as const, text: '❌ file and agentId are required for unlock' }], isError: true };
        const released = teamStore.releaseLock(project.id, file, agentId);
        return { content: [{ type: 'text' as const, text: released ? `Unlocked: ${file}` : `Cannot unlock: not owner or not locked` }] };
      }
      // status
      if (file) {
        const lockStatus = teamStore.getLockStatus(project.id, file);
        if (!lockStatus) return { content: [{ type: 'text' as const, text: `${file} — unlocked` }] };
        const owner = teamStore.getAgent(lockStatus.locked_by);
        return { content: [{ type: 'text' as const, text: `${file} — locked by ${owner?.name ?? lockStatus.locked_by.slice(0, 8)} (expires ${new Date(lockStatus.expires_at).toISOString()})` }] };
      }
      const all = teamStore.listLocks(project.id);
      if (all.length === 0) return { content: [{ type: 'text' as const, text: 'No files locked' }] };
      const lines = all.map((l: import('./team/team-store.js').TeamLockRow) => {
        const owner = teamStore.getAgent(l.locked_by);
        return `${l.file} — ${owner?.name ?? l.locked_by.slice(0, 8)}`;
      });
      return { content: [{ type: 'text' as const, text: `Locked files (${all.length}):\n${lines.join('\n')}` }] };
    },
  );

  // ── team_task (create / claim / complete / list) ──────────────
  server.registerTool(
    'team_task',
    {
      title: 'Task Board',
      description:
        'Create, claim, complete, or list tasks in the team task board. Supports dependencies. ' +
        'Action "create": create a task. Action "claim": assign to yourself (atomic, race-safe). ' +
        'Action "complete": mark done with result. Action "list": show tasks.',
      inputSchema: {
        action: z.enum(['create', 'claim', 'complete', 'list']).describe('Operation to perform'),
        description: z.string().optional().describe('Task description (for create)'),
        deps: z.array(z.string()).optional().describe('Dependency task IDs (for create)'),
        taskId: z.string().optional().describe('Task ID (for claim/complete)'),
        agentId: z.string().optional().describe('Agent ID (for claim/complete)'),
        result: z.string().optional().describe('Result summary (for complete)'),
        status: z.enum(['pending', 'in_progress', 'completed', 'failed']).optional().describe('Filter by status (for list)'),
        available: z.boolean().optional().describe('Show only claimable tasks (for list)'),
      },
    },
    async ({ action, description: desc, deps, taskId, agentId, result, status, available }) => {
      try {
        if (action === 'create') {
          if (!desc) return { content: [{ type: 'text' as const, text: '❌ description is required for create' }], isError: true };
          const task = teamStore.createTask({
            projectId: project.id,
            description: desc,
            deps: deps ? coerceStringArray(deps) : undefined,
            createdBy: agentId || undefined,
          });
          const taskDeps = teamStore.getTaskDeps(task.task_id);
          return { content: [{ type: 'text' as const, text: `Task created: ${task.task_id.slice(0, 8)}… "${desc}"${taskDeps.length > 0 ? ` (depends on ${taskDeps.length})` : ''}` }] };
        }
        if (action === 'claim') {
          if (!taskId || !agentId) return { content: [{ type: 'text' as const, text: '❌ taskId and agentId required for claim' }], isError: true };
          const agent = teamStore.getAgent(agentId);
          if (!agent || agent.status !== 'active') return { content: [{ type: 'text' as const, text: `❌ Unknown or inactive agent` }], isError: true };
          const claimResult = teamStore.claimTask(taskId, agentId);
          if (!claimResult.success) return { content: [{ type: 'text' as const, text: `❌ ${claimResult.reason}` }], isError: true };
          return { content: [{ type: 'text' as const, text: `Task claimed by ${agent.name}: "${claimResult.task!.description}"` }] };
        }
        if (action === 'complete') {
          if (!taskId || !agentId || !result) return { content: [{ type: 'text' as const, text: '❌ taskId, agentId, and result required for complete' }], isError: true };
          const completeResult = teamStore.completeTask(taskId, agentId, result);
          if (!completeResult.success) return { content: [{ type: 'text' as const, text: `❌ ${completeResult.reason}` }], isError: true };
          const completedTask = teamStore.getTask(taskId);
          return { content: [{ type: 'text' as const, text: `Task completed: "${completedTask?.description ?? taskId}"\nResult: ${result}` }] };
        }
        // list
        const list = teamStore.listTasks(project.id, available ? { available: true } : (status ? { status } : undefined));
        if (list.length === 0) return { content: [{ type: 'text' as const, text: available ? 'No tasks available to claim' : 'No tasks found' }] };
        const statusIcon: Record<string, string> = { pending: '[ ]', in_progress: '[~]', completed: '[x]', failed: '[!]' };
        const lines = list.map((t: import('./team/team-store.js').TeamTaskRow) => {
          const assignee = t.assignee_agent_id ? teamStore.getAgent(t.assignee_agent_id)?.name ?? t.assignee_agent_id.slice(0, 8) : 'unassigned';
          const taskDeps = teamStore.getTaskDeps(t.task_id);
          return `${statusIcon[t.status] ?? '[ ]'} ${t.task_id.slice(0, 8)}… "${t.description}" — ${assignee}${taskDeps.length > 0 ? ` [deps: ${taskDeps.length}]` : ''}`;
        });
        return { content: [{ type: 'text' as const, text: `Tasks (${list.length}):\n${lines.join('\n')}` }] };
      } catch (err) {
        return { content: [{ type: 'text' as const, text: `❌ ${(err as Error).message}` }], isError: true };
      }
    },
  );

  // ── team_message (send / broadcast / inbox) ───────────────────
  server.registerTool(
    'team_message',
    {
      title: 'Team Messaging',
      description:
        'Send, broadcast, or read messages between agents. Durable: messages survive restarts and reach inactive recipients. ' +
        'Action "send": direct message to one agent. Action "broadcast": message all agents. ' +
        'Action "inbox": read this agent\'s inbox.',
      inputSchema: {
        action: z.enum(['send', 'broadcast', 'inbox']).describe('Operation to perform'),
        from: z.string().optional().describe('Sender agent ID (for send/broadcast)'),
        to: z.string().optional().describe('Receiver agent ID (for send)'),
        type: z.enum(['request', 'response', 'info', 'announcement', 'contract', 'error', 'handoff']).optional().describe('Message type (for send/broadcast)'),
        content: z.string().optional().describe('Message content (for send/broadcast)'),
        agentId: z.string().optional().describe('Agent ID (for inbox)'),
        markRead: z.boolean().optional().default(false).describe('Mark messages as read (for inbox)'),
      },
    },
    async ({ action, from, to, type: msgType, content, agentId, markRead }) => {
      if (action === 'send') {
        if (!from || !to || !msgType || !content) return { content: [{ type: 'text' as const, text: '❌ from, to, type, and content required for send' }], isError: true };
        if (content.length > 10_000) return { content: [{ type: 'text' as const, text: '❌ Message too large (max 10KB)' }], isError: true };
        const msg = teamStore.sendMessage({
          projectId: project.id,
          senderAgentId: from,
          recipientAgentId: to,
          type: msgType,
          content,
        });
        return { content: [{ type: 'text' as const, text: `Message sent (${msgType}) to ${to.slice(0, 8)}… | ID: ${msg.id.slice(0, 8)}…` }] };
      }
      if (action === 'broadcast') {
        if (!from || !msgType || !content) return { content: [{ type: 'text' as const, text: '❌ from, type, and content required for broadcast' }], isError: true };
        if (content.length > 10_000) return { content: [{ type: 'text' as const, text: '❌ Message too large (max 10KB)' }], isError: true };
        const msg = teamStore.sendMessage({
          projectId: project.id,
          senderAgentId: from,
          recipientAgentId: null,
          type: msgType,
          content,
        });
        return { content: [{ type: 'text' as const, text: `Broadcast (${msgType}) | ID: ${msg.id.slice(0, 8)}…` }] };
      }
      // inbox
      const inboxId = agentId || from || '';
      if (!inboxId) return { content: [{ type: 'text' as const, text: '❌ agentId required for inbox' }], isError: true };
      const inbox = teamStore.getInbox(project.id, inboxId);
      const unread = teamStore.getUnreadCount(project.id, inboxId);
      if (inbox.length === 0) return { content: [{ type: 'text' as const, text: 'Inbox empty' }] };
      if (markRead) {
        teamStore.markAllRead(project.id, inboxId);
      }
      const lines = inbox.slice(-10).map((m: import('./team/team-store.js').TeamMessageRow) => {
        const sender = teamStore.getAgent(m.sender_agent_id);
        return `${m.read_at ? ' ' : '*'} [${m.type}] from ${sender?.name ?? m.sender_agent_id.slice(0, 8)}: ${m.content.slice(0, 100)}`;
      });
      return { content: [{ type: 'text' as const, text: `Inbox: ${unread} unread / ${inbox.length} total\n\n${lines.join('\n')}` }] };
    },
  );

  // ── memorix_poll (Phase 4b: situational awareness) ────────────────
  server.registerTool(
    'memorix_poll',
    {
      title: 'Team Poll — Situational Awareness',
      description:
        'Get a full snapshot of your team coordination state in one call. ' +
        'Returns: your agent info, watermark (new observations since last session), ' +
        'inbox (unread messages), tasks (your in-progress, available to claim, completed, failed), ' +
        'and team roster (active agents). Use this to decide what to work on next.',
      inputSchema: {
        agentId: z.string().optional().describe('Your agent ID (from team_manage join or session_start). If omitted, returns project-level overview only.'),
        markInboxRead: z.boolean().optional().describe('If true, mark all inbox messages as read after returning them.'),
      },
    },
    async ({ agentId, markInboxRead }) => {
      const { computeWatermark, computePoll } = await import('./team/poll.js');

      // Compute watermark — requires observation store access
      let watermark = computeWatermark(0, 0, 0);
      if (agentId) {
        const agent = teamStore.getAgent(agentId);
        if (agent) {
          const lastSeen = agent.last_seen_obs_generation;
          const store = getObservationStore();
          const currentGen = store.getGeneration();
          const projectObs = await withFreshIndex(() => getAllObservations().filter(
            o => o.projectId === project.id && (o.writeGeneration ?? 0) > lastSeen,
          ));
          watermark = computeWatermark(lastSeen, currentGen, projectObs.length);

          // Advance watermark so next poll sees only truly new observations
          teamStore.updateWatermark(agentId, currentGen);
          // Heartbeat — proves this agent is alive
          teamStore.heartbeat(agentId);
        }
      }

      const poll = computePoll(teamStore, project.id, agentId ?? null, watermark);

      // Optionally mark inbox as read
      if (markInboxRead && agentId) {
        teamStore.markAllRead(project.id, agentId);
      }

      // Format as readable text
      const lines: string[] = [];

      // Agent
      if (poll.agent) {
        lines.push(`🤖 You: ${poll.agent.agentId.slice(0, 8)}… (${poll.agent.status})`);
      }

      // Watermark
      if (poll.watermark.newObservationCount > 0) {
        lines.push(`📊 ${poll.watermark.newObservationCount} new observation(s) since your last session`);
      }

      // Inbox
      if (poll.inbox.unreadCount > 0) {
        lines.push(`📬 ${poll.inbox.unreadCount} unread message(s)`);
        for (const m of poll.inbox.messages.slice(-5)) {
          const sender = teamStore.getAgent(m.sender_agent_id);
          lines.push(`  ${m.read_at ? ' ' : '*'} [${m.type}] from ${sender?.name ?? m.sender_agent_id.slice(0, 8)}: ${m.content.slice(0, 80)}`);
        }
      }

      // Tasks
      if (poll.tasks.myInProgress.length > 0) {
        lines.push(`\n🔧 Your in-progress tasks (${poll.tasks.myInProgress.length}):`);
        for (const t of poll.tasks.myInProgress) {
          lines.push(`  [~] ${t.task_id.slice(0, 8)}… "${t.description}"`);
        }
      }
      if (poll.tasks.availableToClaim.length > 0) {
        lines.push(`\n📋 Available to claim (${poll.tasks.availableToClaim.length}):`);
        for (const t of poll.tasks.availableToClaim) {
          lines.push(`  [ ] ${t.task_id.slice(0, 8)}… "${t.description}"`);
        }
      }
      if (poll.tasks.recentlyCompleted.length > 0) {
        lines.push(`\n✅ Completed (${poll.tasks.recentlyCompleted.length}):`);
        for (const t of poll.tasks.recentlyCompleted.slice(-5)) {
          const who = t.assignee_agent_id ? teamStore.getAgent(t.assignee_agent_id)?.name ?? t.assignee_agent_id.slice(0, 8) : '?';
          lines.push(`  [x] ${t.task_id.slice(0, 8)}… "${t.description}" — by ${who}`);
        }
      }
      if (poll.tasks.recentlyFailed.length > 0) {
        lines.push(`\n❌ Failed (${poll.tasks.recentlyFailed.length}):`);
        for (const t of poll.tasks.recentlyFailed.slice(-3)) {
          lines.push(`  [!] ${t.task_id.slice(0, 8)}… "${t.description}" — ${t.result?.slice(0, 80) ?? 'no reason'}`);
        }
      }

      // Team
      lines.push(`\n👥 Team: ${poll.team.activeAgents.length} active / ${poll.team.totalAgents} total`);
      for (const a of poll.team.activeAgents) {
        lines.push(`  ● ${a.name} (${a.agent_type}) — ${a.role ?? 'no role'}`);
      }

      if (lines.length === 0) {
        lines.push('No team activity yet. Use team_manage action="join" to register, then team_task to create tasks.');
      }

      return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
    },
  );

  // ── memorix_handoff (Phase 4b: structured agent-to-agent context transfer) ──
  server.registerTool(
    'memorix_handoff',
    {
      title: 'Team Handoff — Agent Context Transfer',
      description:
        'Create a structured handoff artifact when passing work to another agent. ' +
        'The handoff is stored as a durable observation (searchable, immune to archival) ' +
        'and a notification message is sent to the recipient. ' +
        'Use this when completing a task and another agent should continue, ' +
        'or when you want to leave context for whoever works on this next.',
      inputSchema: {
        fromAgentId: z.string().describe('Your agent ID (from team_manage join or session_start)'),
        summary: z.string().describe('Human-readable summary of what you did and what needs to happen next'),
        context: z.string().describe('Detailed context for the next agent: what was done, current state, known issues, next steps'),
        toAgentId: z.string().optional().describe('Specific recipient agent ID. Omit to broadcast to all.'),
        taskId: z.string().optional().describe('Link to a specific team_task ID'),
        filesModified: z.array(z.string()).optional().describe('Files you modified during this work'),
        concepts: z.array(z.string()).optional().describe('Key concepts for search discoverability'),
      },
    },
    async ({ fromAgentId, summary, context, toAgentId, taskId, filesModified, concepts }) => {
      const { createHandoffArtifact } = await import('./team/handoff.js');

      const result = await createHandoffArtifact(
        {
          projectId: project.id,
          fromAgentId,
          toAgentId,
          taskId,
          summary,
          context,
          filesModified: filesModified ? coerceStringArray(filesModified) : undefined,
          concepts: concepts ? coerceStringArray(concepts) : undefined,
        },
        storeObservation,
        teamStore,
      );

      const lines = [
        `✅ Handoff created`,
        `Observation: #${result.observationId}`,
        `From: ${result.fromAgentId.slice(0, 8)}…`,
        result.toAgentId ? `To: ${result.toAgentId.slice(0, 8)}…` : 'To: broadcast (any agent)',
        result.taskId ? `Task: ${result.taskId.slice(0, 8)}…` : '',
        `Summary: ${result.summary}`,
        '',
        'The handoff context is now stored as a durable observation (searchable via memorix_search).',
        result.toAgentId
          ? 'A notification message has been sent to the recipient.'
          : 'A broadcast notification has been sent to all agents.',
      ];

      return { content: [{ type: 'text' as const, text: lines.filter(Boolean).join('\n') }] };
    },
  );
  server.registerTool(
    'memorix_ingest_image',
    {
      title: 'Ingest Image',
      description:
        'Analyze an image via Vision LLM and store the analysis as a memory observation. ' +
        'Returns description, tags, and entities extracted from the image.',
      inputSchema: {
        base64: z.string().describe('Base64-encoded image data'),
        mimeType: z.string().optional().describe('Image MIME type (e.g. image/png, image/jpeg)'),
        filename: z.string().optional().describe('Original filename'),
        prompt: z.string().optional().describe('Custom analysis prompt'),
      },
    },
    async (args) => {
      try {
        const { analyzeImage } = await import('./multimodal/image-loader.js');
        const analysis = await analyzeImage(args);
        const entityName = args.filename?.replace(/\.[^.]+$/, '') ?? `image-${Date.now()}`;
        markInternalWrite();
        const { observation } = await storeObservation({
          entityName,
          type: 'discovery',
          title: `Image analysis: ${entityName}`,
          narrative: analysis.description,
          concepts: analysis.tags,
          facts: analysis.entities,
          projectId: project.id,
        });
        return {
          content: [{
            type: 'text' as const,
            text: `\uD83D\uDDBC\uFE0F Image analyzed\n` +
              `Observation #${observation.id}\n` +
              `Tags: ${analysis.tags.join(', ') || 'none'}\n` +
              `Preview: ${analysis.description.slice(0, 300)}${analysis.description.length > 300 ? '\u2026' : ''}`,
          }],
        };
      } catch (err: unknown) {
        return {
          content: [{
            type: 'text' as const,
            text: `\u274C Image ingestion failed: ${err instanceof Error ? err.message : String(err)}`,
          }],
          isError: true,
        };
      }
    },
  );
  // Deferred initialization — runs AFTER transport connect so MCP handshake isn't blocked.
  // Sync advisory scan and file watcher are non-essential for tool functionality.
  const deferredInit = async () => {
    // Check hook installation status and guide user
    try {
      const { getHookStatus } = await import('./hooks/installers/index.js');
      const workDir = cwd ?? process.cwd();
      const statuses = await getHookStatus(workDir);
      const installedAgents = statuses.filter((s) => s.installed).map((s) => s.agent);

      if (installedAgents.length === 0) {
        console.error('[memorix] No hooks installed. Run "memorix hooks install" to set up auto-capture.');
      } else {
        console.error(`[memorix] Hooks active: ${installedAgents.join(', ')}`);
      }
    } catch { /* skip */ }

    // Git auto-hook: install post-commit hook if memorix.yml has git.autoHook: true
    // Uses worktree-safe hook path resolution (.git may be a file in worktree setups)
    try {
      const { getGitConfig } = await import('./config.js');
      const gitCfg = getGitConfig();
      if (gitCfg.autoHook && project.rootPath) {
        const { ensureHooksDir } = await import('./git/hooks-path.js');
        const resolved = ensureHooksDir(project.rootPath);
        if (resolved) {
          const { existsSync, readFileSync, writeFileSync, chmodSync } = await import('node:fs');
          const { hookPath } = resolved;
          const HOOK_MARKER = '# [memorix-git-hook]';
          const needsInstall = !existsSync(hookPath) || !readFileSync(hookPath, 'utf-8').includes(HOOK_MARKER);
          if (needsInstall) {
            const hookScript = `#!/bin/sh\n${HOOK_MARKER}\n# Memorix: Auto-ingest git commits as memories\nif command -v memorix >/dev/null 2>&1; then\n  memorix ingest commit --auto >/dev/null 2>&1 &\nfi\n`;
            if (existsSync(hookPath)) {
              const existing = readFileSync(hookPath, 'utf-8');
              writeFileSync(hookPath, existing.trimEnd() + '\n\n' + `${HOOK_MARKER}\nif command -v memorix >/dev/null 2>&1; then\n  memorix ingest commit --auto >/dev/null 2>&1 &\nfi\n`, 'utf-8');
            } else {
              writeFileSync(hookPath, hookScript, 'utf-8');
            }
            try { chmodSync(hookPath, 0o755); } catch { /* Windows */ }
            console.error('[memorix] Auto-installed git post-commit hook (git.autoHook: true)');
          }
        }
      }
    } catch { /* git auto-hook is best-effort */ }

    // Read behavior config
    let behaviorConfig: { syncAdvisory: boolean; autoCleanup: boolean } = { syncAdvisory: true, autoCleanup: true };
    try {
      const { getBehaviorConfig } = await import('./config/behavior.js');
      behaviorConfig = getBehaviorConfig();
    } catch { /* defaults */ }

    // Sync advisory: compute once, show on first memorix_search
    if (!behaviorConfig.syncAdvisory) {
      console.error('[memorix] Sync advisory disabled via config.');
    } else try {
      const engine = new WorkspaceSyncEngine(project.rootPath);
      const scan = await engine.scan();
      const lines: string[] = [];

      const totalMCP = Object.values(scan.mcpConfigs).reduce((sum, arr) => sum + arr.length, 0);
      const totalSkills = scan.skills.length;
      const totalRules = scan.rulesCount;
      const totalWorkflows = scan.workflows.length;

      if (totalMCP > 0 || totalSkills > 0 || totalRules > 0 || totalWorkflows > 0) {
        lines.push('', '---', '🔄 **Cross-Agent Sync Available**');
        for (const [agent, servers] of Object.entries(scan.mcpConfigs)) {
          const list = servers as MCPServerEntry[];
          if (list.length > 0) {
            lines.push(`- **${agent}** MCP: ${list.map(s => s.name).join(', ')}`);
          }
        }
        if (totalSkills > 0) {
          const byAgent = new Map<string, string[]>();
          for (const sk of scan.skills) {
            const arr = byAgent.get(sk.sourceAgent) || [];
            arr.push(sk.name);
            byAgent.set(sk.sourceAgent, arr);
          }
          for (const [agent, names] of byAgent) {
            lines.push(`- **${agent}** skills: ${names.join(', ')}`);
          }
        }
        if (scan.skillConflicts.length > 0) lines.push(`  ⚠️ ${scan.skillConflicts.length} name conflict(s)`);
        if (totalRules > 0) lines.push(`- **${totalRules} rule(s)** found`);
        if (totalWorkflows > 0) lines.push(`- **${totalWorkflows} workflow(s)** found`);
        lines.push('');
        lines.push('⚠️ IMPORTANT INSTRUCTIONS FOR AI AGENT:');
        lines.push('1. Tell the user what configs/skills are available from other agents (list them).');
        lines.push('2. Ask which ones they want to sync.');
        lines.push('3. DO NOT manually copy files or run shell commands to sync.');
        lines.push('4. ONLY use `memorix_workspace_sync action="apply" target="<agent>"` to sync all,');
        lines.push('   or add `items=["name1","name2"]` to sync specific items selectively.');
        syncAdvisory = lines.join('\n');
      }
      console.error(`[memorix] Sync advisory: ${syncAdvisory ? 'available' : 'nothing to sync'}`);
    } catch { /* sync scan is optional */ }

    // ── Background retention cleanup ────────────────────────────────
    // Archive expired memories automatically so users never need to run it manually.
    // Respects behavior.autoCleanup config (defaults to true).
    if (!behaviorConfig.autoCleanup) {
      console.error('[memorix] Auto-cleanup disabled via config.');
    } else {
    try {
      const { archiveExpired } = await import('./memory/retention.js');
      const archiveResult = await archiveExpired(projectDir);
      if (archiveResult.archived > 0) {
        console.error(`[memorix] Auto-archived ${archiveResult.archived} expired observation(s)`);
      }
    } catch { /* retention cleanup is optional */ }

    // ── Background consolidation ─────────────────────────────────────
    // With LLM: semantic dedup (higher quality). Without: Jaccard similarity.
    // Users who configure an API key want quality — each call is only ~500 tokens.
    try {
      if (isLLMEnabled()) {
        const { getAllObservations, resolveObservations } = await import('./memory/observations.js');
        const { deduplicateMemory } = await import('./llm/memory-manager.js');
        const allObs = await withFreshIndex(() => getAllObservations().filter(o => (o.status ?? 'active') === 'active' && o.projectId === project.id));
        if (allObs.length > 10) {
          const grouped = new Map<string, typeof allObs>();
          for (const obs of allObs) {
            const key = `${obs.entityName}::${obs.type}`;
            if (!grouped.has(key)) grouped.set(key, []);
            grouped.get(key)!.push(obs);
          }
          const toResolve: number[] = [];
          // Cap total LLM dedup calls per session to avoid runaway API usage
          const MAX_DEDUP_CALLS = 15;
          let dedupCalls = 0;
          for (const [, group] of grouped) {
            if (group.length < 2 || dedupCalls >= MAX_DEDUP_CALLS) continue;
            group.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
            for (let i = 0; i < group.length - 1 && i < 3 && dedupCalls < MAX_DEDUP_CALLS; i++) {
              try {
                dedupCalls++;
                const older = group[i], newer = group[i + 1];
                const decision = await withTimeout(
                  deduplicateMemory(
                    { title: newer.title, narrative: newer.narrative, facts: newer.facts },
                    [{ id: older.id, title: older.title, narrative: older.narrative, facts: older.facts.join('\n') }],
                  ),
                  DEDUP_PER_PAIR_TIMEOUT_MS,
                  `Dedup pair #${older.id}↔#${newer.id}`,
                );
                if (decision && (decision.action === 'UPDATE' || decision.action === 'NONE')) {
                  toResolve.push(decision.action === 'UPDATE' ? older.id : newer.id);
                } else if (decision?.action === 'DELETE' && decision.targetId) {
                  toResolve.push(decision.targetId);
                }
              } catch { /* skip individual comparison errors or timeouts */ }
            }
          }
          if (toResolve.length > 0) {
            await resolveObservations([...new Set(toResolve)], 'resolved');
            console.error(`[memorix] Auto-dedup (LLM): resolved ${toResolve.length} redundant observation(s)`);
          }
        }
      } else {
        const { executeConsolidation } = await import('./memory/consolidation.js');
        const result = await executeConsolidation(projectDir, project.id, { threshold: 0.55 });
        if (result.observationsMerged > 0) {
          console.error(`[memorix] Auto-consolidated: merged ${result.observationsMerged} duplicate(s) across ${result.clustersFound} cluster(s)`);
        }
      }
    } catch { /* consolidation is optional */ }
    } // end autoCleanup

    // ── Vector-missing observability & background backfill ──────────
    // Log how many observations are missing embeddings (search quality degradation).
    // If any are missing and embedding is available, attempt background backfill.
    // A periodic timer retries every 60s so provider recovery actually helps.
    try {
      const { getVectorStatus, backfillVectorEmbeddings } = await import('./memory/observations.js');
      const { isEmbeddingExplicitlyDisabled } = await import('./embedding/provider.js');

      const runBackfill = async (label: string) => {
        const vs = getVectorStatus();
        if (vs.missing === 0 || isEmbeddingExplicitlyDisabled()) return;
        if (label === 'init') {
          console.error(`[memorix] Vector status: ${vs.missing}/${vs.total} observations missing embeddings`);
        }
        try {
          const result = await backfillVectorEmbeddings();
          if (result.succeeded > 0) {
            console.error(`[memorix] Vector backfill (${label}): ${result.succeeded}/${result.attempted} embeddings recovered`);
          }
          if (result.failed > 0 && label === 'init') {
            console.error(`[memorix] Vector backfill: ${result.failed} failed (periodic retry active)`);
          }
        } catch { /* best-effort */ }
      };

      // Initial backfill attempt (non-blocking)
      runBackfill('init');

      // Periodic retry: every 60s, check if there are still missing vectors
      // Stops automatically when all vectors are backfilled or embedding is disabled
      const BACKFILL_INTERVAL_MS = 60_000;
      const backfillTimer = setInterval(async () => {
        const vs = getVectorStatus();
        if (vs.missing === 0 || isEmbeddingExplicitlyDisabled()) {
          clearInterval(backfillTimer);
          return;
        }
        await runBackfill('periodic');
      }, BACKFILL_INTERVAL_MS);
      // Don't keep the process alive just for backfill
      if (backfillTimer.unref) backfillTimer.unref();
    } catch { /* vector observability is optional */ }

    // Watch for external writes (e.g., from hook processes) and hot-reload.
    // Uses watchFile (polling) instead of watch because atomicWriteFile uses
    // rename(), which changes the file inode — fs.watch loses track on Windows.
    const observationsFile = projectDir + '/observations.json';
    let reloadDebounce: ReturnType<typeof setTimeout> | null = null;
    let reloading = false; // guard: skip if a reload is already in progress
    // lastInternalWriteMs + markInternalWrite are module-level (see top of file)
    try {
      watchFile(observationsFile, { interval: 5000 }, (curr, prev) => {
        if (curr.mtimeMs === prev.mtimeMs) return; // no actual change
        // Skip reload if a MCP tool wrote recently — data is already in memory
        if (Date.now() - lastInternalWriteMs < 10_000) return;
        if (reloading) return; // skip — previous reload still running
        if (reloadDebounce) clearTimeout(reloadDebounce);
        reloadDebounce = setTimeout(async () => {
          if (reloading) return;
          reloading = true;
          try {
            await resetDb();
            await initObservationStore(projectDir);
            await initObservations(projectDir);
            const count = await prepareSearchIndex();
            if (count > 0) {
              console.error(`[memorix] Hot-reloaded search index for ${count} observations (external write detected)`);
            }
          } catch { /* silent */ }
          reloading = false;
        }, 3000);
      });
      console.error(`[memorix] Watching for external writes (hooks hot-reload enabled)`);
    } catch {
      console.error(`[memorix] Warning: could not watch observations file for hot-reload`);
    }
  };

  // Runtime project switch — called when MCP roots change, projectRoot binding, or new workspace detected.
  // Updates all mutable state; tool closures automatically pick up new values.
  const switchProject = async (newCwd: string): Promise<boolean> => {
    const { detectProjectWithDiagnostics } = await import('./project/detector.js');
    const result = detectProjectWithDiagnostics(newCwd);
    if (!result.project) {
      if (result.failure) {
        console.error(`[memorix] Project detection failed for "${newCwd}": [${result.failure.reason}] ${result.failure.detail}`);
      }
      return false;
    }
    const newDetected = result.project;

    // Resolve data dir FIRST (was buggy: used before declaration)
    const newProjectDir = await getProjectDataDir(newDetected.id);
    initAliasRegistry(newProjectDir);
    const newCanonicalId = await registerAlias(newDetected);

    // Allow switch if: different project OR current project is unresolved (__unresolved__)
    if (newCanonicalId === project.id && projectResolved) return false; // same project, no-op

    console.error(`[memorix] Switching project: ${project.id} → ${newCanonicalId}`);

    // Phase 4a: clear agent identity — old project's agent is not valid in new project
    currentAgentId = undefined;

    // Re-resolve data dir with canonical ID (may differ from raw detected ID)
    const canonicalProjectDir = newCanonicalId !== newDetected.id
      ? await getProjectDataDir(newCanonicalId)
      : newProjectDir;

    // Update mutable state — all tool closures reference these by closure
    projectResolved = true;
    projectResolutionError = null;
    project = { ...newDetected, id: newCanonicalId };
    projectDir = canonicalProjectDir;

    // Update YAML config root and reload .env for the new project
    try {
      const { initProjectRoot } = await import('./config/yaml-loader.js');
      initProjectRoot(project.rootPath);
      const { resetDotenv, loadDotenv } = await import('./config/dotenv-loader.js');
      resetDotenv();
      loadDotenv(project.rootPath);
    } catch { /* best-effort */ }

    await initializeProjectRuntime('switch');
    return true;
  };

  return {
    server, graphManager, projectId: project.id, deferredInit, switchProject,
    isExplicitlyBound: () => explicitProjectBound,
  };
}
