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

import { watch } from 'node:fs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { KnowledgeGraphManager } from './memory/graph.js';
import { storeObservation, initObservations, reindexObservations } from './memory/observations.js';
import { resetDb } from './store/orama-store.js';
import { createAutoRelations } from './memory/auto-relations.js';
import { extractEntities } from './memory/entity-extractor.js';
import { compactSearch, compactTimeline, compactDetail } from './compact/engine.js';
import { detectProject } from './project/detector.js';
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
 * Create and configure the Memorix MCP Server.
 */
export async function createMemorixServer(cwd?: string): Promise<{
  server: McpServer;
  graphManager: KnowledgeGraphManager;
  projectId: string;
}> {
  // Detect current project
  const project = detectProject(cwd);
  const projectDir = await getProjectDataDir(project.id);

  // Initialize components
  const graphManager = new KnowledgeGraphManager(projectDir);
  await graphManager.init();
  await initObservations(projectDir);

  // Reindex existing observations into Orama
  const reindexed = await reindexObservations();
  if (reindexed > 0) {
    console.error(`[memorix] Reindexed ${reindexed} observations for project: ${project.id}`);
  }

  console.error(`[memorix] Project: ${project.id} (${project.name})`);
  console.error(`[memorix] Data dir: ${projectDir}`);

  // Auto-install hooks on first run (silent, non-blocking)
  try {
    const { getHookStatus, installHooks, detectInstalledAgents } = await import('./hooks/installers/index.js');
    const workDir = cwd ?? process.cwd();
    const statuses = await getHookStatus(workDir);
    const anyInstalled = statuses.some((s) => s.installed);
    if (!anyInstalled) {
      const agents = await detectInstalledAgents();
      for (const agent of agents) {
        try {
          const config = await installHooks(agent, workDir);
          console.error(`[memorix] Auto-installed hooks for ${agent} → ${config.configPath}`);
        } catch { /* skip */ }
      }
    }
  } catch { /* hooks install is optional */ }

  // Sync advisory: compute once per session, show on first memorix_search
  let syncAdvisoryShown = false;
  let syncAdvisory: string | null = null;
  try {
    const engine = new WorkspaceSyncEngine(project.rootPath);
    const scan = await engine.scan();
    const lines: string[] = [];

    // Count what's available from other agents
    const totalMCP = Object.values(scan.mcpConfigs).reduce((sum, arr) => sum + arr.length, 0);
    const totalSkills = scan.skills.length;
    const totalRules = scan.rulesCount;
    const totalWorkflows = scan.workflows.length;

    if (totalMCP > 0 || totalSkills > 0 || totalRules > 0 || totalWorkflows > 0) {
      lines.push('', '---', '🔄 **Cross-Agent Sync Available**');

      // Detail MCP servers per agent
      for (const [agent, servers] of Object.entries(scan.mcpConfigs)) {
        const list = servers as MCPServerEntry[];
        if (list.length > 0) {
          lines.push(`- **${agent}** MCP: ${list.map(s => s.name).join(', ')}`);
        }
      }

      // Detail skills per agent
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
  } catch {
    // Sync scan is optional, don't block startup
  }

  // Watch for external writes (e.g., from hook processes) and hot-reload
  const observationsFile = projectDir + '/observations.json';
  let reloadDebounce: ReturnType<typeof setTimeout> | null = null;
  try {
    watch(observationsFile, () => {
      // Debounce: wait 500ms after last change before reloading
      if (reloadDebounce) clearTimeout(reloadDebounce);
      reloadDebounce = setTimeout(async () => {
        try {
          await resetDb(); // Clear Orama before re-inserting
          await initObservations(projectDir);
          const count = await reindexObservations();
          if (count > 0) {
            console.error(`[memorix] Hot-reloaded ${count} observations (external write detected)`);
          }
        } catch {
          // Silent — don't crash the server
        }
      }, 500);
    });
    console.error(`[memorix] Watching for external writes (hooks hot-reload enabled)`);
  } catch {
    console.error(`[memorix] Warning: could not watch observations file for hot-reload`);
  }

  // Create MCP server
  const server = new McpServer({
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
        'session-request (🎯 original goal).',
      inputSchema: {
        entityName: z.string().describe('The entity this observation belongs to (e.g., "auth-module", "port-config")'),
        type: z.enum(OBSERVATION_TYPES).describe('Observation type for classification'),
        title: z.string().describe('Short descriptive title (~5-10 words)'),
        narrative: z.string().describe('Full description of the observation'),
        facts: z.array(z.string()).optional().describe('Structured facts (e.g., "Default timeout: 60s")'),
        filesModified: z.array(z.string()).optional().describe('Files involved'),
        concepts: z.array(z.string()).optional().describe('Related concepts/keywords'),
      },
    },
    async ({ entityName, type, title, narrative, facts, filesModified, concepts }) => {
      // Ensure entity exists in knowledge graph
      await graphManager.createEntities([
        { name: entityName, entityType: 'auto', observations: [] },
      ]);

      // Store the observation
      const obs = await storeObservation({
        entityName,
        type: type as ObservationType,
        title,
        narrative,
        facts,
        filesModified,
        concepts,
        projectId: project.id,
      });

      // Add a reference to the entity's observations
      await graphManager.addObservations([
        { entityName, contents: [`[#${obs.id}] ${title}`] },
      ]);

      // Implicit memory: auto-create relations from entity extraction
      const extracted = extractEntities([title, narrative, ...(facts ?? [])].join(' '));
      const autoRelCount = await createAutoRelations(obs, extracted, graphManager);

      // Build enrichment summary
      const enrichmentParts: string[] = [];
      const autoFiles = obs.filesModified.filter((f) => !(filesModified ?? []).includes(f));
      const autoConcepts = obs.concepts.filter((c) => !(concepts ?? []).includes(c));
      if (autoFiles.length > 0) enrichmentParts.push(`+${autoFiles.length} files extracted`);
      if (autoConcepts.length > 0) enrichmentParts.push(`+${autoConcepts.length} concepts enriched`);
      if (autoRelCount > 0) enrichmentParts.push(`+${autoRelCount} relations auto-created`);
      if (obs.hasCausalLanguage) enrichmentParts.push('causal language detected');
      const enrichment = enrichmentParts.length > 0 ? `\nAuto-enriched: ${enrichmentParts.join(', ')}` : '';

      return {
        content: [
          {
            type: 'text' as const,
            text: `✅ Stored observation #${obs.id} "${title}" (~${obs.tokens} tokens)\nEntity: ${entityName} | Type: ${type} | Project: ${project.id}${enrichment}`,
          },
        ],
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
        'Use memorix_timeline to see chronological context.',
      inputSchema: {
        query: z.string().describe('Search query (natural language or keywords)'),
        limit: z.number().optional().describe('Max results (default: 20)'),
        type: z.enum(OBSERVATION_TYPES).optional().describe('Filter by observation type'),
        maxTokens: z.number().optional().describe('Token budget — trim results to fit (0 = unlimited)'),
      },
    },
    async ({ query, limit, type, maxTokens }) => {
      const result = await compactSearch({
        query,
        limit,
        type: type as ObservationType | undefined,
        maxTokens,
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
      const result = await compactTimeline(
        anchorId,
        undefined,
        depthBefore,
        depthAfter,
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
      const result = await compactDetail(ids);

      return {
        content: [
          {
            type: 'text' as const,
            text: result.documents.length > 0
              ? result.formatted
              : `No observations found for IDs: ${ids.join(', ')}`,
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
      title: 'Memory Retention Status',
      description:
        'Show memory retention status: active/stale/archive-candidate counts, ' +
        'immune observations, and top stale candidates. ' +
        'Uses exponential decay scoring based on importance, age, and access patterns.',
      inputSchema: {},
    },
    async () => {
      const { getRetentionSummary, getArchiveCandidates, rankByRelevance } = await import('./memory/retention.js');
      const { search } = await import('@orama/orama');

      // Get all observations for this project
      const database = await (await import('./store/orama-store.js')).getDb();
      const allResults = await search(database, {
        term: '',
        where: {},
        limit: 10000,
      });
      const docs = allResults.hits.map((h) => h.document as unknown as import('./types.js').MemorixDocument);

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
      const result = await graphManager.createEntities(entities);
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
      const result = await graphManager.createRelations(relations);
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
      const result = await graphManager.addObservations(observations);
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
      await graphManager.deleteEntities(entityNames);
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
      await graphManager.deleteObservations(deletions);
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
      await graphManager.deleteRelations(relations);
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
      const graph = await graphManager.openNodes(names);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(graph, null, 2) }],
      };
    },
  );

  // ============================================================
  // Rules Sync Tool (P2 — Memorix differentiator)
  // ============================================================

  const RULE_SOURCES: [string, ...string[]] = ['cursor', 'claude-code', 'codex', 'windsurf'];

  /** memorix_rules_sync — scan, dedup, and generate rules across agents */
  server.registerTool(
    'memorix_rules_sync',
    {
      title: 'Rules Sync',
      description:
        'Scan project for agent rule files (Cursor, Claude Code, Codex, Windsurf), ' +
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

  const AGENT_TARGETS: [string, ...string[]] = ['windsurf', 'cursor', 'claude-code', 'codex'];

  /** memorix_workspace_sync — migrate entire workspace config across agents */
  server.registerTool(
    'memorix_workspace_sync',
    {
      title: 'Workspace Sync',
      description:
        'Migrate your entire workspace environment between AI agents. ' +
        'Syncs MCP server configs, workflows, rules, and skills. ' +
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

  return { server, graphManager, projectId: project.id };
}
