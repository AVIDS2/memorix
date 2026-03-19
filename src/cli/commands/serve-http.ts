/**
 * memorix serve-http — Start MCP Server on Streamable HTTP transport
 *
 * Enables multiple agents (across different IDEs) to connect to ONE Memorix server.
 * Each agent gets its own MCP session. Sessions start from the same startup project
 * root, then supported clients can refine to their own git-backed workspace via MCP
 * roots, yielding per-session project context.
 *
 * Usage:
 *   memorix serve-http                    # default port 3211
 *   memorix serve-http --port 3211        # custom port
 *   memorix serve-http --cwd /path/to/project
 *
 * IDE config example (Claude Code):
 *   { "transport": "http", "url": "http://localhost:3211/mcp" }
 */

import { defineCommand } from 'citty';
import type { IncomingMessage, ServerResponse } from 'node:http';

export default defineCommand({
  meta: {
    name: 'serve-http',
    description: 'Start Memorix MCP Server on HTTP transport (multi-agent)',
  },
  args: {
    port: {
      type: 'string',
      description: 'HTTP port to listen on (default: 3211)',
      required: false,
    },
    cwd: {
      type: 'string',
      description: 'Project working directory (defaults to process.cwd())',
      required: false,
    },
  },
  run: async ({ args }) => {
    const { createServer } = await import('node:http');
    const { randomUUID } = await import('node:crypto');
    const { StreamableHTTPServerTransport } = await import(
      '@modelcontextprotocol/sdk/server/streamableHttp.js'
    );
    const { isInitializeRequest } = await import(
      '@modelcontextprotocol/sdk/types.js'
    );
    const { createMemorixServer } = await import('../../server.js');
    const { findGitInSubdirs } = await import('../../project/detector.js');

    const port = parseInt(args.port || '3211', 10);

    // Priority: explicit --cwd arg > MEMORIX_PROJECT_ROOT env > process.cwd()
    let safeCwd: string;
    try { safeCwd = process.cwd(); } catch { safeCwd = (await import('node:os')).homedir(); }
    const projectRoot = args.cwd || process.env.MEMORIX_PROJECT_ROOT || safeCwd;

    console.error(`[memorix] HTTP transport starting on port ${port}`);
    console.error(`[memorix] Project root: ${projectRoot}`);

    // Create shared team instances ONCE — all sessions share the same state
    const { AgentRegistry } = await import('../../team/registry.js');
    const { MessageBus } = await import('../../team/messages.js');
    const { FileLockRegistry } = await import('../../team/file-locks.js');
    const { TaskManager } = await import('../../team/tasks.js');
    const teamRegistry = new AgentRegistry();
    const sharedTeam = {
      registry: teamRegistry,
      messageBus: new MessageBus(teamRegistry),
      fileLocks: new FileLockRegistry(),
      taskManager: new TaskManager(),
    };

    type SessionState = {
      transport: InstanceType<typeof StreamableHTTPServerTransport>;
      server: Awaited<ReturnType<typeof createMemorixServer>>['server'];
      switchProject: Awaited<ReturnType<typeof createMemorixServer>>['switchProject'];
      isExplicitlyBound: Awaited<ReturnType<typeof createMemorixServer>>['isExplicitlyBound'];
    };

    // Session map: sessionId → transport + per-session server state
    const sessions = new Map<string, SessionState>();

    /**
     * Parse JSON body from IncomingMessage
     */
    function parseBody(req: IncomingMessage): Promise<unknown> {
      return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', () => {
          try {
            const body = Buffer.concat(chunks).toString('utf-8');
            resolve(body ? JSON.parse(body) : undefined);
          } catch (err) {
            reject(err);
          }
        });
        req.on('error', reject);
      });
    }

    /**
     * Send CORS headers (allow all origins for local dev)
     */
    function setCorsHeaders(res: ServerResponse) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Mcp-Session-Id, Last-Event-Id');
      res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');
    }

    /**
     * Handle POST /mcp — JSON-RPC requests from agents
     */
    async function handlePost(req: IncomingMessage, res: ServerResponse) {
      const sessionId = req.headers['mcp-session-id'] as string | undefined;
      const body = await parseBody(req);

      if (sessionId && sessions.has(sessionId)) {
        // Existing session — route to its transport
        sessionLastActivity.set(sessionId, Date.now());
        await sessions.get(sessionId)!.transport.handleRequest(req, res, body);
        return;
      }

      if (!sessionId && isInitializeRequest(body)) {
        // New session — create transport + server
        let createdState: SessionState | null = null;
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sid: string) => {
            console.error(`[memorix] HTTP session initialized: ${sid}`);
            if (createdState) sessions.set(sid, createdState);
            sessionLastActivity.set(sid, Date.now());
          },
        });

        transport.onclose = () => {
          const sid = transport.sessionId;
          if (sid && sessions.has(sid)) {
            console.error(`[memorix] HTTP session closed: ${sid}`);
            sessions.delete(sid);
            sessionLastActivity.delete(sid);
          }
        };

        // Create a fresh MCP server for this session (with shared team state)
        const { server, switchProject, isExplicitlyBound } = await createMemorixServer(
          projectRoot,
          undefined,
          sharedTeam,
          {
            allowUntrackedFallback: false,
            deferProjectInitUntilBound: true,
          },
        );
        createdState = { transport, server, switchProject, isExplicitlyBound };
        await server.connect(transport);

        const persistRoot = async (rootPath: string) => {
          try {
            const { writeFileSync, mkdirSync } = await import('node:fs');
            const pathMod = await import('node:path');
            const { homedir } = await import('node:os');
            const memorixDir = pathMod.join(homedir(), '.memorix');
            mkdirSync(memorixDir, { recursive: true });
            writeFileSync(pathMod.join(memorixDir, 'last-project-root'), rootPath, 'utf-8');
          } catch { /* non-critical */ }
        };

        const tryRootsSwitch = async () => {
          try {
            // If session was explicitly bound via projectRoot in memorix_session_start,
            // do NOT allow roots notifications to override the binding.
            if (isExplicitlyBound()) {
              console.error(`[memorix] Session ${transport.sessionId?.slice(0, 8) ?? 'pending'} roots switch skipped: session was explicitly bound via projectRoot`);
              return;
            }
            const { roots } = await server.server.listRoots();
            if (!roots || roots.length === 0) return;

            for (const root of roots) {
              if (!root.uri.startsWith('file://')) continue;
              let rootPath = decodeURIComponent(root.uri.replace('file://', ''));
              if (/^\/[A-Za-z]:/.test(rootPath)) rootPath = rootPath.slice(1);
              rootPath = rootPath.replace(/\//g, '\\');

              const switched = await switchProject(rootPath);
              if (switched) {
                console.error(`[memorix] Session ${transport.sessionId?.slice(0, 8) ?? 'pending'} roots switched to: ${rootPath}`);
                await persistRoot(rootPath);
                return;
              }

              const subGit = findGitInSubdirs(rootPath);
              if (subGit) {
                const subSwitched = await switchProject(subGit);
                if (subSwitched) {
                  console.error(`[memorix] Session ${transport.sessionId?.slice(0, 8) ?? 'pending'} roots switched via subdir: ${subGit}`);
                  await persistRoot(subGit);
                  return;
                }
              }
            }
          } catch {
            // Client doesn't support roots — keep startup project context.
          }
        };

        try {
          const { RootsListChangedNotificationSchema } = await import('@modelcontextprotocol/sdk/types.js');
          server.server.setNotificationHandler(RootsListChangedNotificationSchema, async () => {
            await tryRootsSwitch();
          });
        } catch { /* optional */ }

        await transport.handleRequest(req, res, body);
        queueMicrotask(() => {
          tryRootsSwitch().catch(() => {});
        });
        return;
      }

      // Invalid request
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Bad Request: No valid session ID provided' },
        id: null,
      }));
    }

    /**
     * Handle GET /mcp — SSE stream for server-initiated messages
     */
    async function handleGet(req: IncomingMessage, res: ServerResponse) {
      const sessionId = req.headers['mcp-session-id'] as string | undefined;
      if (!sessionId || !sessions.has(sessionId)) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('Invalid or missing session ID');
        return;
      }

      await sessions.get(sessionId)!.transport.handleRequest(req, res);
    }

    /**
     * Handle DELETE /mcp — Session termination
     */
    async function handleDelete(req: IncomingMessage, res: ServerResponse) {
      const sessionId = req.headers['mcp-session-id'] as string | undefined;
      if (!sessionId || !sessions.has(sessionId)) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('Invalid or missing session ID');
        return;
      }

      await sessions.get(sessionId)!.transport.handleRequest(req, res);
    }

    // Create HTTP server
    // ── Dashboard embedding ────────────────────────────────────────
    // Serve dashboard alongside MCP so Team panel has direct access to sharedTeam
    const { detectProject } = await import('../../project/detector.js');
    const { getProjectDataDir, getBaseDataDir } = await import('../../store/persistence.js');
    const { promises: fsPromises } = await import('node:fs');
    const pathModule = await import('node:path');
    const { fileURLToPath } = await import('node:url');

    const detectedDashboardProject = detectProject(projectRoot);
    const defaultProject = detectedDashboardProject ?? {
      id: '__unresolved__',
      name: pathModule.default.basename(projectRoot),
      rootPath: projectRoot,
    };
    const defaultDataDir = await getProjectDataDir(defaultProject.id);
    const baseDir = getBaseDataDir();

    // Cache resolved project data dirs to avoid repeated fs lookups
    const projectDataDirCache = new Map<string, string>();
    projectDataDirCache.set(defaultProject.id, defaultDataDir);

    /** Resolve ?project= query param to { projectId, projectName, dataDir } */
    async function resolveRequestProject(url: URL): Promise<{
      projectId: string;
      projectName: string;
      dataDir: string;
    }> {
      const requestedId = url.searchParams.get('project');
      if (!requestedId || requestedId === defaultProject.id) {
        return { projectId: defaultProject.id, projectName: defaultProject.name, dataDir: defaultDataDir };
      }
      // Resolve data dir for the requested project (cached)
      let dataDir = projectDataDirCache.get(requestedId);
      if (!dataDir) {
        dataDir = await getProjectDataDir(requestedId);
        projectDataDirCache.set(requestedId, dataDir);
      }
      const name = requestedId.split('/').pop() || requestedId;
      return { projectId: requestedId, projectName: name, dataDir };
    }

    // Resolve static directory (dist/dashboard/static)
    const cliDir = pathModule.default.dirname(fileURLToPath(import.meta.url));
    const dashStaticDir = pathModule.default.join(cliDir, '..', 'dashboard', 'static');

    const MIME_TYPES: Record<string, string> = {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
      '.ico': 'image/x-icon',
    };

    /** Serve dashboard static files */
    async function serveDashStatic(req: IncomingMessage, res: ServerResponse) {
      let urlPath = new URL(req.url || '/', `http://localhost:${port}`).pathname;
      if (urlPath === '/' || !urlPath.includes('.')) urlPath = '/index.html';
      const filePath = pathModule.default.join(dashStaticDir, urlPath);
      if (!filePath.startsWith(dashStaticDir)) {
        res.writeHead(403); res.end('Forbidden'); return;
      }
      try {
        const data = await fsPromises.readFile(filePath);
        const ext = pathModule.default.extname(filePath);
        res.writeHead(200, {
          'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
          'Cache-Control': 'no-cache',
        });
        res.end(data);
      } catch {
        try {
          const idx = await fsPromises.readFile(pathModule.default.join(dashStaticDir, 'index.html'));
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(idx);
        } catch {
          res.writeHead(404); res.end('Not found');
        }
      }
    }

    /** Handle dashboard API routes */
    async function handleDashApi(req: IncomingMessage, res: ServerResponse) {
      const url = new URL(req.url || '/', `http://localhost:${port}`);
      const apiPath = url.pathname.replace('/api', '');
      const sendJson = (data: unknown, status = 200) => {
        res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify(data));
      };

      try {
        if (apiPath === '/team') {
          // Read cross-IDE team state from shared file (stdio agents)
          const { dataDir: teamDataDir } = await resolveRequestProject(url);
          const teamStatePath = pathModule.default.join(teamDataDir, 'team-state.json');
          try {
            const raw = await fsPromises.readFile(teamStatePath, 'utf8');
            const snap = JSON.parse(raw);
            if (snap.version === 1) {
              const { AgentRegistry } = await import('../../team/registry.js');
              const { MessageBus } = await import('../../team/messages.js');
              const { FileLockRegistry } = await import('../../team/file-locks.js');
              const { TaskManager } = await import('../../team/tasks.js');
              const reg = new AgentRegistry();
              const mb = new MessageBus(reg);
              const fl = new FileLockRegistry();
              const tm = new TaskManager();
              reg.hydrate(snap.registry);
              mb.hydrate(snap.messages);
              fl.hydrate(snap.locks);
              tm.hydrate(snap.tasks);
              fl.cleanExpired();
              const agents = reg.listAgents();
              const locks = fl.listLocks();
              const tasks = tm.list();
              const available = tm.getAvailable();
              sendJson({
                agents: agents.map((a: any) => ({ ...a, unread: mb.getUnreadCount(a.id) })),
                activeCount: reg.getActiveCount(),
                locks,
                tasks,
                availableTasks: available.length,
                sessions: sessions.size,
              });
              return;
            }
          } catch { /* file doesn't exist or invalid — fall through to in-memory */ }

          // Fallback: use HTTP server's in-memory team state
          sharedTeam.fileLocks.cleanExpired();
          const agents = sharedTeam.registry.listAgents();
          const locks = sharedTeam.fileLocks.listLocks();
          const tasks = sharedTeam.taskManager.list();
          const available = sharedTeam.taskManager.getAvailable();
          sendJson({
            agents: agents.map((a: any) => ({
              ...a,
              unread: sharedTeam.messageBus.getUnreadCount(a.id),
            })),
            activeCount: sharedTeam.registry.getActiveCount(),
            locks,
            tasks,
            availableTasks: available.length,
            sessions: sessions.size,
          });
          return;
        }

        if (apiPath === '/project') {
          const { projectId: pid, projectName: pname } = await resolveRequestProject(url);
          sendJson({ id: pid, name: pname });
          return;
        }

        if (apiPath === '/stats') {
          const { projectId: statsProjectId, dataDir: statsDataDir } = await resolveRequestProject(url);
          const { loadObservationsJson, loadIdCounter, loadGraphJsonl } = await import('../../store/persistence.js');
          const graph = await loadGraphJsonl(statsDataDir);
          const allObs = await loadObservationsJson(statsDataDir) as Array<{
            projectId?: string;
            type?: string;
            id?: number;
            title?: string;
            entityName?: string;
            createdAt?: string;
            source?: string;
            commitHash?: string;
            filesModified?: string[];
            importance?: number;
            accessCount?: number;
            status?: string;
          }>;
          const observations = allObs.filter(o => o.projectId === statsProjectId && (o.status ?? 'active') === 'active');
          const nextId = await loadIdCounter(statsDataDir);
          const typeCounts: Record<string, number> = {};
          for (const obs of observations) {
            const t = obs.type || 'unknown';
            typeCounts[t] = (typeCounts[t] || 0) + 1;
          }

          const sourceCounts: Record<string, number> = { git: 0, agent: 0, manual: 0 };
          const gitMemories: typeof observations = [];
          const now = Date.now();
          const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
          let recentGitCount = 0;

          for (const obs of observations) {
            const src = obs.source || 'agent';
            sourceCounts[src] = (sourceCounts[src] || 0) + 1;
            if (src === 'git') {
              gitMemories.push(obs);
              if (obs.createdAt && new Date(obs.createdAt).getTime() > sevenDaysAgo) {
                recentGitCount++;
              }
            }
          }

          const gitSorted = [...gitMemories].sort((a, b) => (b.id || 0) - (a.id || 0));
          const recentGitMemories = gitSorted.slice(0, 8).map(o => ({
            id: o.id,
            title: o.title,
            type: o.type,
            commitHash: o.commitHash,
            entityName: o.entityName,
            createdAt: o.createdAt,
            filesModified: o.filesModified,
          }));

          let retentionSummary = { active: 0, stale: 0, archive: 0, immune: 0 };
          for (const obs of observations) {
            const age = now - new Date(obs.createdAt || now).getTime();
            const ageHours = age / (1000 * 60 * 60);
            const importance = obs.importance ?? 5;
            const accessCount = obs.accessCount ?? 0;
            const lambda = 0.01;
            const score = Math.min(importance * Math.exp(-lambda * ageHours) + Math.min(accessCount * 0.5, 3), 10);
            const isImmune = importance >= 8 || obs.type === 'gotcha' || obs.type === 'decision';
            if (isImmune) retentionSummary.immune++;
            if (score >= 3) retentionSummary.active++;
            else if (score >= 1) retentionSummary.stale++;
            else retentionSummary.archive++;
          }

          const sorted = [...observations].sort((a, b) => (b.id || 0) - (a.id || 0)).slice(0, 10);

          let embeddingStatus = { enabled: false, provider: '', dimensions: 0 };
          try {
            const { getEmbeddingProvider } = await import('../../embedding/provider.js');
            const embProvider = await getEmbeddingProvider();
            embeddingStatus = {
              enabled: embProvider !== null,
              provider: embProvider?.name || '',
              dimensions: embProvider?.dimensions || 0,
            };
          } catch { /* best effort */ }

          sendJson({
            entities: graph.entities.length,
            relations: graph.relations.length,
            observations: observations.length,
            nextId,
            typeCounts,
            sourceCounts,
            recentObservations: sorted,
            embedding: embeddingStatus,
            gitSummary: {
              total: gitMemories.length,
              recentWeek: recentGitCount,
              recentMemories: recentGitMemories,
            },
            retentionSummary,
          });
          return;
        }

        if (apiPath === '/observations') {
          const { projectId: obsProjectId, dataDir: obsDataDir } = await resolveRequestProject(url);
          const { loadObservationsJson } = await import('../../store/persistence.js');
          const allObs = await loadObservationsJson(obsDataDir) as Array<{ projectId?: string; status?: string }>;
          sendJson(allObs.filter(o => o.projectId === obsProjectId && (o.status ?? 'active') === 'active'));
          return;
        }

        if (apiPath === '/graph') {
          const { dataDir: graphDataDir } = await resolveRequestProject(url);
          const { loadGraphJsonl } = await import('../../store/persistence.js');
          const graph = await loadGraphJsonl(graphDataDir);
          sendJson(graph);
          return;
        }

        if (apiPath === '/sessions') {
          const { projectId: sessProjectId, dataDir: sessDataDir } = await resolveRequestProject(url);
          const { loadSessionsJson } = await import('../../store/persistence.js');
          const allSessions = await loadSessionsJson(sessDataDir) as Array<{ projectId?: string }>;
          sendJson(allSessions.filter(s => s.projectId === sessProjectId));
          return;
        }

        if (apiPath === '/retention') {
          const { projectId: retProjectId, dataDir: retDataDir } = await resolveRequestProject(url);
          const { loadObservationsJson } = await import('../../store/persistence.js');
          const allObs = await loadObservationsJson(retDataDir) as Array<{ projectId?: string; id?: number; title?: string; type?: string; importance?: number; accessCount?: number; lastAccessedAt?: string; createdAt?: string; entityName?: string; status?: string }>;
          const observations = allObs.filter(o => o.projectId === retProjectId && (o.status ?? 'active') === 'active');
          const now = Date.now();
          const scored = observations.map(obs => {
            const age = now - new Date(obs.createdAt || now).getTime();
            const ageHours = age / (1000 * 60 * 60);
            const importance = obs.importance ?? 5;
            const accessCount = obs.accessCount ?? 0;
            const lambda = 0.01;
            const decayScore = importance * Math.exp(-lambda * ageHours);
            const accessBonus = Math.min(accessCount * 0.5, 3);
            const score = Math.min(decayScore + accessBonus, 10);
            const isImmune = importance >= 8 || obs.type === 'gotcha' || obs.type === 'decision';
            return { id: obs.id, title: obs.title, type: obs.type, entityName: obs.entityName, score: Math.round(score * 100) / 100, isImmune, ageHours: Math.round(ageHours * 10) / 10, accessCount };
          });
          scored.sort((a, b) => b.score - a.score);
          const activeCount = scored.filter(s => s.score >= 3).length;
          const staleCount = scored.filter(s => s.score < 3 && s.score >= 1).length;
          const archiveCount = scored.filter(s => s.score < 1).length;
          const immuneCount = scored.filter(s => s.isImmune).length;
          sendJson({ summary: { active: activeCount, stale: staleCount, archive: archiveCount, immune: immuneCount }, items: scored });
          return;
        }

        if (apiPath === '/config') {
          const os = await import('node:os');
          const { existsSync } = await import('node:fs');
          const { join } = await import('node:path');
          const { loadYamlConfig } = await import('../../config/yaml-loader.js');
          const { loadFileConfig, loadDotenv, getLoadedEnvFiles } = await import('../../config.js');

          loadDotenv(projectRoot);
          const yml = loadYamlConfig(projectRoot);
          const legacy = loadFileConfig();

          const files: Record<string, { exists: boolean; path: string }> = {};
          const home = os.homedir();
          const paths: Record<string, string> = {
            'project memorix.yml': join(projectRoot, 'memorix.yml'),
            'user memorix.yml': join(home, '.memorix', 'memorix.yml'),
            'project .env': join(projectRoot, '.env'),
            'user .env': join(home, '.memorix', '.env'),
            'legacy config.json': join(home, '.memorix', 'config.json'),
          };
          for (const [key, fpath] of Object.entries(paths)) {
            files[key] = { exists: existsSync(fpath), path: fpath };
          }

          const values: Array<{ key: string; value: string; source: string; sensitive?: boolean }> = [];

          const llmProvider = process.env.MEMORIX_LLM_PROVIDER || yml.llm?.provider || legacy.llm?.provider;
          if (llmProvider) {
            values.push({
              key: 'llm.provider',
              value: llmProvider,
              source: process.env.MEMORIX_LLM_PROVIDER ? 'env' : yml.llm?.provider ? 'memorix.yml' : 'config.json',
            });
          }

          const llmModel = process.env.MEMORIX_LLM_MODEL || yml.llm?.model || legacy.llm?.model;
          if (llmModel) {
            values.push({
              key: 'llm.model',
              value: llmModel,
              source: process.env.MEMORIX_LLM_MODEL ? 'env' : yml.llm?.model ? 'memorix.yml' : 'config.json',
            });
          }

          const llmKey =
            process.env.MEMORIX_LLM_API_KEY ||
            process.env.MEMORIX_API_KEY ||
            yml.llm?.apiKey ||
            legacy.llm?.apiKey ||
            process.env.OPENAI_API_KEY;
          if (llmKey) {
            let src = 'unknown';
            if (process.env.MEMORIX_LLM_API_KEY) src = 'env:MEMORIX_LLM_API_KEY';
            else if (process.env.MEMORIX_API_KEY) src = 'env:MEMORIX_API_KEY';
            else if (yml.llm?.apiKey) src = 'memorix.yml (move to .env!)';
            else if (legacy.llm?.apiKey) src = 'config.json (legacy)';
            else if (process.env.OPENAI_API_KEY) src = 'env:OPENAI_API_KEY';
            values.push({ key: 'llm.apiKey', value: '****' + llmKey.slice(-4), source: src, sensitive: true });
          } else {
            values.push({ key: 'llm.apiKey', value: 'not set', source: 'none' });
          }

          const embProvider = process.env.MEMORIX_EMBEDDING || yml.embedding?.provider || legacy.embedding || 'off';
          values.push({
            key: 'embedding.provider',
            value: embProvider,
            source: process.env.MEMORIX_EMBEDDING ? 'env' : yml.embedding?.provider ? 'memorix.yml' : legacy.embedding ? 'config.json' : 'default',
          });

          values.push({
            key: 'git.autoHook',
            value: String(yml.git?.autoHook ?? false),
            source: yml.git?.autoHook !== undefined ? 'memorix.yml' : 'default',
          });
          values.push({
            key: 'git.skipMergeCommits',
            value: String(yml.git?.skipMergeCommits ?? true),
            source: yml.git?.skipMergeCommits !== undefined ? 'memorix.yml' : 'default',
          });

          if (yml.behavior?.formationMode) {
            values.push({ key: 'behavior.formationMode', value: yml.behavior.formationMode, source: 'memorix.yml' });
          }
          if (yml.behavior?.sessionInject) {
            values.push({ key: 'behavior.sessionInject', value: yml.behavior.sessionInject, source: 'memorix.yml' });
          }

          values.push({
            key: 'server.transport',
            value: yml.server?.transport || 'stdio',
            source: yml.server?.transport ? 'memorix.yml' : 'default',
          });
          values.push({
            key: 'server.dashboard',
            value: String(yml.server?.dashboard ?? true),
            source: yml.server?.dashboard !== undefined ? 'memorix.yml' : 'default',
          });

          sendJson({ files, values, loadedEnvFiles: [...getLoadedEnvFiles()] });
          return;
        }

        if (apiPath === '/identity') {
          const { projectId: idProjectId } = await resolveRequestProject(url);
          const { loadObservationsJson } = await import('../../store/persistence.js');
          const allObs = await loadObservationsJson(baseDir) as Array<{ projectId?: string }>;
          const allProjectIds = [...new Set(allObs.map(o => o.projectId).filter(Boolean))] as string[];

          const dirtyPatterns = [
            /^placeholder\//,
            /System32/i,
            /Microsoft VS Code/i,
            /node_modules/i,
            /\.vscode/i,
            /^local\/[A-Z]:\\/,
          ];
          const dirtyIds = allProjectIds.filter(id => dirtyPatterns.some(p => p.test(id)));

          let aliasGroups: any[] = [];
          let canonicalId = idProjectId;
          try {
            const aliasModule = await import('../../project/aliases.js');
            canonicalId = await aliasModule.getCanonicalId(idProjectId);
            const registryPath = pathModule.default.join(baseDir, '.project-aliases.json');
            const raw = await fsPromises.readFile(registryPath, 'utf-8');
            const registry = JSON.parse(raw);
            aliasGroups = registry.groups || [];
          } catch { /* best effort */ }

          const currentGroup = aliasGroups.find((g: any) => g.aliases?.includes(idProjectId) || g.canonical === idProjectId);
          const aliases = currentGroup?.aliases || [idProjectId];

          const hasDirtyIds = dirtyIds.length > 0;
          const hasMultipleUnmerged = allProjectIds.length > aliasGroups.length + 1;
          const isHealthy = !hasDirtyIds && !hasMultipleUnmerged;

          sendJson({
            currentProjectId: idProjectId,
            canonicalId,
            aliases,
            allProjectIds,
            dirtyIds,
            aliasGroups: aliasGroups.length,
            isHealthy,
            healthIssues: [
              ...(hasDirtyIds ? [`${dirtyIds.length} dirty project ID(s) detected`] : []),
              ...(hasMultipleUnmerged ? ['Potential unmerged project identity fragments detected'] : []),
            ],
          });
          return;
        }

        if (apiPath === '/projects') {
          const { loadObservationsJson } = await import('../../store/persistence.js');
          const allObs = await loadObservationsJson(baseDir) as Array<{ projectId?: string; status?: string }>;
          const projectSet = new Map<string, number>();
          for (const obs of allObs) { if (obs.projectId && (obs.status ?? 'active') === 'active') projectSet.set(obs.projectId, (projectSet.get(obs.projectId) || 0) + 1); }
          const projects = Array.from(projectSet.entries()).sort((a, b) => b[1] - a[1]).map(([id, count]) => ({ id, name: id.split('/').pop() || id, count, isCurrent: id === defaultProject.id }));
          sendJson(projects);
          return;
        }

        sendJson({ error: 'Not found' }, 404);
      } catch (err) {
        sendJson({ error: err instanceof Error ? err.message : 'Unknown error' }, 500);
      }
    }

    const httpServer = createServer(async (req, res) => {
      setCorsHeaders(res);

      // Handle CORS preflight
      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      const url = new URL(req.url || '/', `http://localhost:${port}`);

      // MCP endpoint
      if (url.pathname === '/mcp') {
        try {
          switch (req.method) {
            case 'POST':
              await handlePost(req, res);
              break;
            case 'GET':
              await handleGet(req, res);
              break;
            case 'DELETE':
              await handleDelete(req, res);
              break;
            default:
              res.writeHead(405, { 'Content-Type': 'text/plain' });
              res.end('Method not allowed');
          }
        } catch (err) {
          console.error('[memorix] HTTP handler error:', err);
          if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              jsonrpc: '2.0',
              error: { code: -32603, message: 'Internal server error' },
              id: null,
            }));
          }
        }
        return;
      }

      // Dashboard API
      if (url.pathname.startsWith('/api/')) {
        await handleDashApi(req, res);
        return;
      }

      // Dashboard static files (catch-all)
      await serveDashStatic(req, res);
    });

    httpServer.listen(port, '127.0.0.1', () => {
      console.error(`[memorix] MCP Streamable HTTP Server listening on http://127.0.0.1:${port}/mcp`);
      console.error(`[memorix] Dashboard:  http://127.0.0.1:${port}/`);
      console.error(`[memorix] Team API:   http://127.0.0.1:${port}/api/team`);
      console.error(`[memorix] Sessions at startup: ${sessions.size} (live count available at /api/team)`);
      console.error(`[memorix] Agents can connect via: { "transport": "http", "url": "http://localhost:${port}/mcp" }`);
    });

    // Session timeout GC — close sessions idle for 30 minutes
    const SESSION_TIMEOUT_MS = 30 * 60 * 1000;
    const sessionLastActivity = new Map<string, number>();
    const gcInterval = setInterval(() => {
      const now = Date.now();
      for (const [sid, state] of sessions) {
        const lastActive = sessionLastActivity.get(sid) ?? 0;
        if (now - lastActive > SESSION_TIMEOUT_MS) {
          console.error(`[memorix] Session ${sid.slice(0, 8)}… timed out (idle ${Math.round((now - lastActive) / 60000)}min), closing`);
          state.transport.close().catch(() => {});
          sessions.delete(sid);
          sessionLastActivity.delete(sid);
        }
      }
    }, 60_000); // Check every minute
    gcInterval.unref(); // Don't prevent process exit

    // Graceful shutdown
    const shutdown = async () => {
      console.error('[memorix] Shutting down HTTP server...');
      for (const [sid, state] of sessions) {
        try {
          await state.transport.close();
          sessions.delete(sid);
        } catch (err) {
          console.error(`[memorix] Error closing session ${sid}:`, err);
        }
      }
      httpServer.close();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  },
});
