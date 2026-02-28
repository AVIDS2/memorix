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
import { storeObservation, initObservations, reindexObservations, migrateProjectIds } from './memory/observations.js';
import { resetDb } from './store/orama-store.js';
import { createAutoRelations } from './memory/auto-relations.js';
import { extractEntities } from './memory/entity-extractor.js';
import { compactSearch, compactTimeline, compactDetail } from './compact/engine.js';
import { detectProject } from './project/detector.js';
import { registerAlias, initAliasRegistry, resolveAliases, autoMergeByBaseName } from './project/aliases.js';
import { getProjectDataDir } from './store/persistence.js';
import type { ObservationType, RuleSource, AgentTarget, MCPServerEntry } from './types.js';
import { RulesSyncer } from './rules/syncer.js';
import { WorkspaceSyncEngine } from './workspace/engine.js';

/** Valid observation types for input validation */
const OBSERVATION_TYPES: [string, ...string[]] = [
  'session-request',
  'gotcha',
  'problem-solution',
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
export async function createMemorixServer(cwd?: string, existingServer?: McpServer): Promise<{
  server: McpServer;
  graphManager: KnowledgeGraphManager;
  projectId: string;
  deferredInit: () => Promise<void>;
}> {
  // Detect current project (never returns __invalid__ — degraded mode uses placeholder/)
  const rawProject = detectProject(cwd);

  // Migrate legacy per-project subdirectories into flat base directory (one-time, silent)
  try {
    const { migrateSubdirsToFlat } = await import('./store/persistence.js');
    const migrated = await migrateSubdirsToFlat();
    if (migrated) {
      console.error(`[memorix] Migrated per-project subdirectories into flat storage`);
    }
  } catch { /* migration is optional */ }

  const projectDir = await getProjectDataDir(rawProject.id);

  // Register alias and resolve to canonical project ID.
  // This ensures the same physical project always uses the same ID
  // regardless of which IDE or detection method discovered it.
  initAliasRegistry(projectDir);
  const canonicalId = await registerAlias(rawProject);
  const project = { ...rawProject, id: canonicalId };
  if (canonicalId !== rawProject.id) {
    console.error(`[memorix] Alias resolved: ${rawProject.id} → ${canonicalId}`);
  }

  // Initialize components
  const graphManager = new KnowledgeGraphManager(projectDir);
  await graphManager.init();
  await initObservations(projectDir);

  // Auto-merge obvious alias groups by scanning observed projectIds in data.
  // This detects splits like placeholder/foo + local/foo + user/foo
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
  // This normalizes split projectIds like placeholder/foo + local/foo → canonical.
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

  // Reindex existing observations into Orama
  const reindexed = await reindexObservations();
  if (reindexed > 0) {
    console.error(`[memorix] Reindexed ${reindexed} observations for project: ${project.id}`);
  }

  console.error(`[memorix] Project: ${project.id} (${project.name})`);
  console.error(`[memorix] Data dir: ${projectDir}`);

  // Sync advisory variables — populated by deferredInit(), used by memorix_search
  let syncAdvisoryShown = false;
  let syncAdvisory: string | null = null;

  // Create MCP server (or use existing one from roots-aware flow)
  const server = existingServer ?? new McpServer({
    name: 'memorix',
    version: '0.1.0',
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
        'Stored memories persist across sessions and are shared with other IDEs (Cursor, Windsurf, Claude Code, Codex, Copilot, Kiro, Antigravity) via the same local data directory.',
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
      },
    },
    async ({ entityName, type, title, narrative, facts, filesModified, concepts, topicKey }) => {
      // Defensive coercion: Claude Code CLI + GLM may send string-encoded arrays
      const safeFacts = facts ? coerceStringArray(facts) : undefined;
      const safeFiles = filesModified ? coerceStringArray(filesModified) : undefined;
      const safeConcepts = concepts ? coerceStringArray(concepts) : undefined;

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

      // Store the observation (may upsert if topicKey matches existing)
      const { observation: obs, upserted } = await storeObservation({
        entityName,
        type: type as ObservationType,
        title,
        narrative,
        facts: safeFacts,
        filesModified: safeFiles,
        concepts: safeConcepts,
        projectId: project.id,
        topicKey,
        sessionId,
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

      return {
        content: [
          {
            type: 'text' as const,
            text: `${action} observation #${obs.id} "${title}" (~${obs.tokens} tokens)\nEntity: ${entityName} | Type: ${type} | Project: ${project.id}${obs.topicKey ? ` | Topic: ${obs.topicKey}` : ''}${enrichment}`,
          },
        ],
      };
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
        scope: z.enum(['project', 'global']).optional().describe(
          'Search scope: "project" (default) only searches current project, "global" searches all projects',
        ),
        since: z.string().optional().describe('Only return observations created after this date (ISO 8601 or natural like "2025-01-15")'),
        until: z.string().optional().describe('Only return observations created before this date (ISO 8601 or natural like "2025-02-01")'),
      },
    },
    async ({ query, limit, type, maxTokens, scope, since, until }) => {
      const safeLimit = limit != null ? coerceNumber(limit, 20) : undefined;
      const safeMaxTokens = maxTokens != null ? coerceNumber(maxTokens, 0) : undefined;
      const result = await compactSearch({
        query,
        limit: safeLimit,
        type: type as ObservationType | undefined,
        maxTokens: safeMaxTokens,
        since,
        until,
        // All data is in a single flat directory. projectId is metadata only.
        // scope: 'project' → filter by current projectId in Orama
        // scope: 'global' or omitted → search all observations (default)
        projectId: scope === 'project' ? project.id : undefined,
      });

      // Append sync advisory on first search of the session
      let text = result.formatted;
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
    },
  );

  /**
   * memorix_timeline — Layer 2: Chronological context
   *
   * Shows observations before and after a specific anchor.
   * Helps agents understand the temporal context of an observation.
   */
  server.registerTool(
    'memorix_timeline',
    {
      title: 'Memory Timeline',
      description:
        'Get chronological context around a specific observation. ' +
        'Shows what happened before and after the anchor observation.',
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
        undefined,
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
   * memorix_detail — Layer 3: Full observation details
   *
   * Fetch complete observation content by IDs.
   * Only call after filtering via memorix_search / memorix_timeline.
   * ~500-1000 tokens per observation.
   */
  server.registerTool(
    'memorix_detail',
    {
      title: 'Memory Details',
      description:
        'Fetch full observation details by IDs (~500-1000 tokens each). ' +
        'Always use memorix_search first to find relevant IDs, then fetch only what you need.',
      inputSchema: {
        ids: z.array(z.number()).describe('Observation IDs to fetch (from memorix_search results)'),
      },
    },
    async ({ ids }) => {
      // Defensive coercion: Claude Code CLI + GLM may send "[16]" instead of [16]
      const safeIds = coerceNumberArray(ids);
      const result = await compactDetail(safeIds);

      return {
        content: [
          {
            type: 'text' as const,
            text: result.documents.length > 0
              ? result.formatted
              : `No observations found for IDs: ${safeIds.join(', ')}`,
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
        'Uses exponential decay scoring based on importance, age, and access patterns.',
      inputSchema: {
        action: z.enum(['report', 'archive']).optional().describe('Action: "report" (show status, default) or "archive" (move expired to archive)'),
      },
    },
    async (args: { action?: string }) => {
      const action = args.action ?? 'report';
      const { getRetentionSummary, getArchiveCandidates, rankByRelevance, archiveExpired } = await import('./memory/retention.js');
      const { search } = await import('@orama/orama');

      // Handle archive action
      if (action === 'archive') {
        const result = await archiveExpired(projectDir);
        if (result.archived === 0) {
          return {
            content: [{ type: 'text' as const, text: '✅ No expired observations to archive. All memories are within their retention period.' }],
          };
        }
        return {
          content: [{ type: 'text' as const, text: `🗄️ Archived ${result.archived} expired observations → observations.archived.json\n${result.remaining} active observations remaining.\n\nArchived memories can be restored manually if needed.` }],
        };
      }

      // Report action (default) — use in-memory observations for reliable lookup
      // (Orama search with empty term is unreliable)
      const { getAllObservations } = await import('./memory/observations.js');
      const allObs = getAllObservations();
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
        accessCount: 0,
        lastAccessedAt: '',
      }));

      if (docs.length === 0) {
        return {
          content: [{ type: 'text' as const, text: 'No observations found for this project.' }],
        };
      }

      const summary = getRetentionSummary(docs);
      const candidates = getArchiveCandidates(docs);
      const ranked = rankByRelevance(docs);

      // Format output
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
      ];

      if (candidates.length > 0) {
        lines.push(`### Archive Candidates (${candidates.length})`);
        lines.push(`| ID | Title | Age (days) | Access |`);
        lines.push(`|----|-------|-----------|--------|`);
        for (const c of candidates.slice(0, 10)) {
          const ageDays = Math.round(
            (Date.now() - new Date(c.createdAt).getTime()) / (1000 * 60 * 60 * 24),
          );
          lines.push(`| ${c.observationId} | ${c.title} | ${ageDays}d | ${c.accessCount ?? 0}× |`);
        }
        lines.push('');
        lines.push(`> 💡 Use \`memorix_retention\` with \`action: "archive"\` to move these to archive.`);
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

  // ================================================================
  // MCP Official Memory Server Compatible Tools
  // ================================================================

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
      const safeRelations = coerceObjectArray<{ from: string; to: string; relationType: string }>(relations);
      await graphManager.deleteRelations(safeRelations);
      return {
        content: [{ type: 'text' as const, text: 'Relations deleted successfully' }],
      };
    },
  );

  /** read_graph — MCP Official compatible */
  server.registerTool(
    'read_graph',
    {
      title: 'Read Graph',
      description: 'Read the entire knowledge graph',
      inputSchema: {},
    },
    async () => {
      const graph = await graphManager.readGraph();
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(graph, null, 2) }],
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
      const graph = await graphManager.searchNodes(query);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(graph, null, 2) }],
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
      const safeNames = coerceStringArray(names);
      const graph = await graphManager.openNodes(safeNames);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(graph, null, 2) }],
      };
    },
  );

  // ============================================================
  // Rules Sync Tool (P2 — Memorix differentiator)
  // ============================================================

  const RULE_SOURCES: [string, ...string[]] = ['cursor', 'claude-code', 'codex', 'windsurf', 'antigravity', 'copilot', 'kiro'];

  /** memorix_rules_sync — scan, dedup, and generate rules across agents */
  server.registerTool(
    'memorix_rules_sync',
    {
      title: 'Rules Sync',
      description:
        'Scan project for agent rule files (Cursor, Claude Code, Codex, Windsurf, Antigravity, Copilot, Kiro), ' +
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
      const files = syncer.generateForTarget(deduped, target as RuleSource);

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

  const AGENT_TARGETS: [string, ...string[]] = ['windsurf', 'cursor', 'claude-code', 'codex', 'copilot', 'antigravity', 'kiro'];

  /** memorix_workspace_sync — migrate entire workspace config across agents */
  server.registerTool(
    'memorix_workspace_sync',
    {
      title: 'Workspace Sync',
      description:
        'Migrate your entire workspace environment between AI coding agents (Cursor, Windsurf, Claude Code, Codex, Copilot, Kiro, Antigravity). ' +
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
        'Generated skills follow the SKILL.md standard and can be synced across Cursor, Windsurf, Claude Code, Codex, Copilot, Kiro, and Antigravity.',
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
      const { loadObservationsJson } = await import('./store/persistence.js');
      const allObs = await loadObservationsJson(projectDir) as Array<{
        id?: number; entityName?: string; type?: string; title?: string;
        narrative?: string; facts?: string[]; concepts?: string[];
        filesModified?: string[]; createdAt?: string;
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
        'Any previous active session for this project will be auto-closed.',
      inputSchema: {
        sessionId: z.string().optional().describe('Custom session ID (auto-generated if omitted)'),
        agent: z.string().optional().describe('Agent/IDE name (e.g., "cursor", "windsurf", "claude-code")'),
      },
    },
    async ({ sessionId, agent }) => {
      const { startSession } = await import('./memory/session.js');
      const result = await startSession(projectDir, project.id, { sessionId, agent });

      const lines = [
        `✅ Session started: ${result.session.id}`,
        `Project: ${project.name} (${project.id})`,
        result.session.agent ? `Agent: ${result.session.agent}` : '',
        '',
      ];

      if (result.previousContext) {
        lines.push('---', '📋 **Context from previous sessions:**', '', result.previousContext);
      } else {
        lines.push('No previous session context found. This appears to be a fresh project.');
      }

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
   * memorix_export — Export project memories for sharing
   */
  server.registerTool(
    'memorix_export',
    {
      title: 'Export Memories',
      description:
        'Export project observations and sessions for sharing with teammates or backup. ' +
        'Supports JSON (full fidelity, importable) and Markdown (human-readable, for docs/PRs).',
      inputSchema: {
        format: z.enum(['json', 'markdown']).describe('Export format: json (importable) or markdown (human-readable)'),
      },
    },
    async ({ format }) => {
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
          text: `## Export Complete\n- Observations: ${data.stats.observationCount}\n- Sessions: ${data.stats.sessionCount}\n\n\`\`\`json\n${json}\n\`\`\`\n\n> Save this JSON and use \`memorix_import\` on another machine to restore.`,
        }],
      };
    },
  );

  /**
   * memorix_import — Import memories from a JSON export
   */
  server.registerTool(
    'memorix_import',
    {
      title: 'Import Memories',
      description:
        'Import observations and sessions from a JSON export (produced by memorix_export). ' +
        'Re-assigns IDs to avoid conflicts. Skips observations with duplicate topicKeys.',
      inputSchema: {
        data: z.string().describe('JSON string from memorix_export output'),
      },
    },
    async ({ data: jsonStr }) => {
      const { importFromJson } = await import('./memory/export-import.js');

      let parsed;
      try {
        parsed = JSON.parse(jsonStr);
      } catch {
        return {
          content: [{ type: 'text' as const, text: 'Invalid JSON. Please provide the exact output from memorix_export.' }],
          isError: true,
        };
      }

      const result = await importFromJson(projectDir, parsed);

      return {
        content: [{
          type: 'text' as const,
          text: `## Import Complete\n- Observations imported: **${result.observationsImported}**\n- Sessions imported: **${result.sessionsImported}**\n- Skipped (duplicate topicKey): **${result.skipped}**`,
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
        startDashboard(projectDir, portNum, staticDir, project.id, project.name, false)
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

  // Deferred initialization — runs AFTER transport connect so MCP handshake isn't blocked.
  // Hooks auto-install, sync advisory scan, and file watcher are non-essential for tool
  // functionality and can take 30-60s on machines with many IDEs/projects.
  const deferredInit = async () => {
    // Auto-install hooks for newly detected agents
    // Respects ~/.memorix/settings.json { "autoInstallHooks": false } to skip
    try {
      let autoInstall = true;
      try {
        const { homedir } = await import('node:os');
        const { join } = await import('node:path');
        const { readFile } = await import('node:fs/promises');
        const settingsPath = join(homedir(), '.memorix', 'settings.json');
        const raw = await readFile(settingsPath, 'utf-8');
        const settings = JSON.parse(raw);
        if (settings.autoInstallHooks === false) {
          autoInstall = false;
          console.error('[memorix] autoInstallHooks disabled in ~/.memorix/settings.json — skipping hook auto-install');
        }
      } catch { /* no settings file or parse error — default to auto-install */ }

      if (autoInstall) {
        const { getHookStatus, installHooks, detectInstalledAgents } = await import('./hooks/installers/index.js');
        const workDir = cwd ?? process.cwd();
        const statuses = await getHookStatus(workDir);
        const installedAgents = new Set(statuses.filter((s) => s.installed).map((s) => s.agent));
        const detectedAgents = await detectInstalledAgents();

        for (const agent of detectedAgents) {
          if (installedAgents.has(agent)) continue;
          try {
            const config = await installHooks(agent, workDir);
            console.error(`[memorix] Auto-installed hooks for ${agent} → ${config.configPath}`);
          } catch { /* skip */ }
        }
      }
    } catch { /* hooks install is optional */ }

    // Sync advisory: compute once, show on first memorix_search
    try {
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

    // Watch for external writes (e.g., from hook processes) and hot-reload.
    // Uses watchFile (polling) instead of watch because atomicWriteFile uses
    // rename(), which changes the file inode — fs.watch loses track on Windows.
    const observationsFile = projectDir + '/observations.json';
    let reloadDebounce: ReturnType<typeof setTimeout> | null = null;
    let reloading = false; // guard: skip if a reload is already in progress
    try {
      watchFile(observationsFile, { interval: 5000 }, (curr, prev) => {
        if (curr.mtimeMs === prev.mtimeMs) return; // no actual change
        if (reloading) return; // skip — previous reload still running
        if (reloadDebounce) clearTimeout(reloadDebounce);
        reloadDebounce = setTimeout(async () => {
          if (reloading) return;
          reloading = true;
          try {
            await resetDb();
            await initObservations(projectDir);
            const count = await reindexObservations();
            if (count > 0) {
              console.error(`[memorix] Hot-reloaded ${count} observations (external write detected)`);
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

  return { server, graphManager, projectId: project.id, deferredInit };
}
