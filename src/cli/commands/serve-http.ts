/**
 * memorix serve-http — Start MCP Server on Streamable HTTP transport
 *
 * Enables multiple agents (across different IDEs) to connect to ONE Memorix server.
 * Each agent gets its own MCP session but shares the same project data.
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

    // Session map: sessionId → transport
    const transports = new Map<string, InstanceType<typeof StreamableHTTPServerTransport>>();

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

      if (sessionId && transports.has(sessionId)) {
        // Existing session — route to its transport
        sessionLastActivity.set(sessionId, Date.now());
        const transport = transports.get(sessionId)!;
        await transport.handleRequest(req, res, body);
        return;
      }

      if (!sessionId && isInitializeRequest(body)) {
        // New session — create transport + server
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sid: string) => {
            console.error(`[memorix] HTTP session initialized: ${sid}`);
            transports.set(sid, transport);
            sessionLastActivity.set(sid, Date.now());
          },
        });

        transport.onclose = () => {
          const sid = transport.sessionId;
          if (sid && transports.has(sid)) {
            console.error(`[memorix] HTTP session closed: ${sid}`);
            transports.delete(sid);
            sessionLastActivity.delete(sid);
          }
        };

        // Create a fresh MCP server for this session (with shared team state)
        const { server } = await createMemorixServer(projectRoot, undefined, sharedTeam);
        await server.connect(transport);
        await transport.handleRequest(req, res, body);
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
      if (!sessionId || !transports.has(sessionId)) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('Invalid or missing session ID');
        return;
      }

      const transport = transports.get(sessionId)!;
      await transport.handleRequest(req, res);
    }

    /**
     * Handle DELETE /mcp — Session termination
     */
    async function handleDelete(req: IncomingMessage, res: ServerResponse) {
      const sessionId = req.headers['mcp-session-id'] as string | undefined;
      if (!sessionId || !transports.has(sessionId)) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('Invalid or missing session ID');
        return;
      }

      const transport = transports.get(sessionId)!;
      await transport.handleRequest(req, res);
    }

    // Create HTTP server
    // ── Dashboard embedding ────────────────────────────────────────
    // Serve dashboard alongside MCP so Team panel has direct access to sharedTeam
    const { detectProject } = await import('../../project/detector.js');
    const { getProjectDataDir, getBaseDataDir } = await import('../../store/persistence.js');
    const { promises: fsPromises } = await import('node:fs');
    const pathModule = await import('node:path');
    const { fileURLToPath } = await import('node:url');

    const project = detectProject() ?? { id: `untracked/${pathModule.default.basename(projectRoot)}`, name: pathModule.default.basename(projectRoot), rootPath: projectRoot };
    const dashDataDir = await getProjectDataDir(project.id);
    const baseDir = getBaseDataDir();

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
          const teamStatePath = pathModule.default.join(dashDataDir, 'team-state.json');
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
                sessions: transports.size,
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
            sessions: transports.size,
          });
          return;
        }

        if (apiPath === '/project') {
          sendJson({ id: project.id, name: project.name });
          return;
        }

        if (apiPath === '/stats') {
          const { loadObservationsJson, loadIdCounter } = await import('../../store/persistence.js');
          const { loadGraphJsonl } = await import('../../store/persistence.js');
          const graph = await loadGraphJsonl(dashDataDir);
          const allObs = await loadObservationsJson(dashDataDir) as Array<{ projectId?: string; type?: string; id?: number; title?: string; entityName?: string }>;
          const observations = allObs.filter(o => o.projectId === project.id);
          const nextId = await loadIdCounter(dashDataDir);
          const typeCounts: Record<string, number> = {};
          for (const obs of observations) { const t = obs.type || 'unknown'; typeCounts[t] = (typeCounts[t] || 0) + 1; }
          const sorted = [...observations].sort((a, b) => (b.id || 0) - (a.id || 0)).slice(0, 10);
          sendJson({ entities: graph.entities.length, relations: graph.relations.length, observations: observations.length, nextId, typeCounts, recentObservations: sorted });
          return;
        }

        if (apiPath === '/observations') {
          const { loadObservationsJson } = await import('../../store/persistence.js');
          const allObs = await loadObservationsJson(dashDataDir) as Array<{ projectId?: string }>;
          sendJson(allObs.filter(o => o.projectId === project.id));
          return;
        }

        if (apiPath === '/graph') {
          const { loadGraphJsonl } = await import('../../store/persistence.js');
          const graph = await loadGraphJsonl(dashDataDir);
          sendJson(graph);
          return;
        }

        if (apiPath === '/sessions') {
          const { loadSessionsJson } = await import('../../store/persistence.js');
          const allSessions = await loadSessionsJson(dashDataDir) as Array<{ projectId?: string }>;
          sendJson(allSessions.filter(s => s.projectId === project.id));
          return;
        }

        if (apiPath === '/retention') {
          const { loadObservationsJson } = await import('../../store/persistence.js');
          const allObs = await loadObservationsJson(dashDataDir) as Array<{ projectId?: string; id?: number; title?: string; type?: string; importance?: number; accessCount?: number; lastAccessedAt?: string; createdAt?: string; entityName?: string }>;
          const observations = allObs.filter(o => o.projectId === project.id);
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

        if (apiPath === '/projects') {
          const { loadObservationsJson } = await import('../../store/persistence.js');
          const allObs = await loadObservationsJson(baseDir) as Array<{ projectId?: string }>;
          const projectSet = new Map<string, number>();
          for (const obs of allObs) { if (obs.projectId) projectSet.set(obs.projectId, (projectSet.get(obs.projectId) || 0) + 1); }
          const projects = Array.from(projectSet.entries()).sort((a, b) => b[1] - a[1]).map(([id, count]) => ({ id, name: id.split('/').pop() || id, count, isCurrent: id === project.id }));
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
      console.error(`[memorix] Active sessions: ${transports.size}`);
      console.error(`[memorix] Agents can connect via: { "transport": "http", "url": "http://localhost:${port}/mcp" }`);
    });

    // Session timeout GC — close sessions idle for 30 minutes
    const SESSION_TIMEOUT_MS = 30 * 60 * 1000;
    const sessionLastActivity = new Map<string, number>();
    const gcInterval = setInterval(() => {
      const now = Date.now();
      for (const [sid, transport] of transports) {
        const lastActive = sessionLastActivity.get(sid) ?? 0;
        if (now - lastActive > SESSION_TIMEOUT_MS) {
          console.error(`[memorix] Session ${sid.slice(0, 8)}… timed out (idle ${Math.round((now - lastActive) / 60000)}min), closing`);
          transport.close().catch(() => {});
          transports.delete(sid);
          sessionLastActivity.delete(sid);
        }
      }
    }, 60_000); // Check every minute
    gcInterval.unref(); // Don't prevent process exit

    // Graceful shutdown
    const shutdown = async () => {
      console.error('[memorix] Shutting down HTTP server...');
      for (const [sid, transport] of transports) {
        try {
          await transport.close();
          transports.delete(sid);
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
