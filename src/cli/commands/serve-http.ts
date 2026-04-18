/**
 * memorix serve-http — Start MCP Server on Streamable HTTP transport (Control Plane mode)
 *
 * Starts the Memorix Control Plane: a single HTTP server that provides:
 *   - MCP endpoint at /mcp (multi-agent, multi-session)
 *   - Web Dashboard at / (project browser, graph, team, config)
 *   - Team API at /api/team (agents, locks, tasks, messages)
 *
 * Mode semantics:
 *   - "Control Plane" = HTTP MCP + Dashboard + Team (this command, default port 3211)
 *   - "Standalone" = Dashboard only, no MCP/team (memorix dashboard, default port 3210)
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
import type { ObservationStore } from '../../store/obs-store.js';

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
    const { findGitInSubdirs, detectProjectWithDiagnostics } = await import('../../project/detector.js');
    const { existsSync, readFileSync, writeFileSync, mkdirSync } = await import('node:fs');
    const { homedir } = await import('node:os');
    const earlyPath = await import('node:path');

    const port = parseInt(args.port || '3211', 10);

    // Priority: explicit --cwd arg > MEMORIX_PROJECT_ROOT env > last-project-root fallback > process.cwd()
    let safeCwd: string;
    try { safeCwd = process.cwd(); } catch { safeCwd = homedir(); }
    let projectRoot = args.cwd || process.env.MEMORIX_PROJECT_ROOT || safeCwd;

    // Fallback: if projectRoot has no git, try last-project-root
    const lastRootFile = earlyPath.join(homedir(), '.memorix', 'last-project-root');
    const initialCheck = detectProjectWithDiagnostics(projectRoot);
    if (!initialCheck.project && existsSync(lastRootFile)) {
      try {
        const lastRoot = readFileSync(lastRootFile, 'utf-8').trim();
        if (lastRoot && existsSync(lastRoot)) {
          const lastCheck = detectProjectWithDiagnostics(lastRoot);
          if (lastCheck.project) {
            console.error(`[memorix] No git at "${projectRoot}", restored last known project: ${lastRoot}`);
            projectRoot = lastRoot;
          }
        }
      } catch { /* ignore */ }
    }

    console.error(`[memorix] HTTP transport starting on port ${port}`);
    console.error(`[memorix] Project root: ${projectRoot}`);

    // Per-project TeamStore cache (Option B) — each dataDir gets its own TeamStore instance.
    // This ensures true isolation between projects in HTTP control-plane mode.
    const teamStoreCache = new Map<string, Awaited<ReturnType<typeof initTeamStore>>>();
    const { initTeamStore } = await import('../../team/team-store.js');

    async function getTeamStore(dataDir: string) {
      const existing = teamStoreCache.get(dataDir);
      if (existing) return existing;
      const store = await initTeamStore(dataDir);
      teamStoreCache.set(dataDir, store);
      return store;
    }

    // Bootstrap the initial project's TeamStore
    const persistMod = await import('../../store/persistence.js');
    const detectorMod = await import('../../project/detector.js');
    const detectedProj = detectorMod.detectProject(projectRoot);
    const teamDataDir = detectedProj ? await persistMod.getProjectDataDir(detectedProj.rootPath) : projectRoot;
    const sharedTeamStore = await getTeamStore(teamDataDir);

    type SessionState = {
      transport: InstanceType<typeof StreamableHTTPServerTransport>;
      server: Awaited<ReturnType<typeof createMemorixServer>>['server'];
      switchProject: Awaited<ReturnType<typeof createMemorixServer>>['switchProject'];
      isExplicitlyBound: Awaited<ReturnType<typeof createMemorixServer>>['isExplicitlyBound'];
    };

    // Session map: sessionId → transport + per-session server state
    const sessions = new Map<string, SessionState>();

    // Session activity tracking (for GC timeout)
    const sessionLastActivity = new Map<string, number>();

    // Probe session noise reduction: defer init logs, suppress short-lived sessions
    let suppressedProbeCount = 0;
    let lastProbeSummaryTime = Date.now();
    const PROBE_SUMMARY_INTERVAL_MS = 60_000; // Log summary at most once per minute
    const SESSION_LOG_DELAY_MS = 5_000; // Only log sessions alive > 5 seconds
    const pendingLogTimers = new Map<string, ReturnType<typeof setTimeout>>();

    function maybeProbeSummary() {
      if (suppressedProbeCount > 0 && Date.now() - lastProbeSummaryTime > PROBE_SUMMARY_INTERVAL_MS) {
        console.error(`[memorix] ${suppressedProbeCount} probe connection(s) suppressed (short-lived / unresolved)`);
        suppressedProbeCount = 0;
        lastProbeSummaryTime = Date.now();
      }
    }

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
     * Patch ServerResponse for MCP compatibility with strict HTTP clients (rmcp/reqwest).
     *
     * Fixes three Hono/Node.js response issues that cause "error decoding response body" in Codex:
     * 1. Empty 202 responses get Transfer-Encoding:chunked instead of Content-Length:0
     * 2. SSE responses (text/event-stream) get Content-Length when the stream completes
     *    quickly, which confuses SSE parsers expecting a streaming response.
     * 3. JSON responses with multi-byte UTF-8 (emoji) get wrong Content-Length because
     *    Hono's listener.js calculates it via value.length (character count) instead of
     *    Buffer.byteLength (byte count). This makes rmcp/reqwest choke on search results.
     */
    function patchMcpResponse(res: ServerResponse): void {
      const origWriteHead = res.writeHead;
      const origWrite = res.write;
      const origEnd = res.end;

      // JSON buffering state — needed because the MCP transport pipes Response body
      // via write(chunk)+end(), and we must set byte-accurate Content-Length before
      // the first byte is sent (chunked encoding confuses rmcp/reqwest in Codex).
      let isJsonResponse = false;
      let deferredWriteHeadArgs: [number, ...any[]] | null = null;
      let bufferedChunks: Buffer[] = [];

      (res as any).writeHead = function (statusCode: number, ...rest: any[]): ServerResponse {
        // Locate headers object in overloaded writeHead(status, headers) or writeHead(status, msg, headers)
        let headers: Record<string, any> | undefined;
        for (let i = rest.length - 1; i >= 0; i--) {
          if (rest[i] && typeof rest[i] === 'object' && !Array.isArray(rest[i])) {
            headers = rest[i];
            break;
          }
        }

        // Fix 1: Empty-body responses (202/204) — set Content-Length: 0, remove chunked
        if (statusCode === 202 || statusCode === 204) {
          if (headers) {
            headers['content-length'] = '0';
            delete headers['transfer-encoding'];
          }
          this.setHeader('content-length', '0');
          this.removeHeader('transfer-encoding');
          return origWriteHead.apply(this, [statusCode, ...rest] as any);
        }

        // Fix 2: SSE responses — must NOT have Content-Length (forces chunked streaming)
        const ct = headers?.['content-type'] ?? headers?.['Content-Type'] ?? this.getHeader('content-type');
        if (typeof ct === 'string' && ct.includes('text/event-stream')) {
          if (headers) {
            delete headers['content-length'];
            delete headers['Content-Length'];
          }
          this.removeHeader('content-length');
          return origWriteHead.apply(this, [statusCode, ...rest] as any);
        }

        // Fix 3: JSON responses — defer writeHead AND buffer body via write().
        // The MCP transport pipes the Web Response body as write(chunk)+end().
        // Without buffering, chunked Transfer-Encoding is used (no Content-Length),
        // which rmcp/reqwest fails to decode. We accumulate chunks and flush
        // everything atomically in end() with byte-accurate Content-Length.
        if (typeof ct === 'string' && ct.includes('application/json')) {
          isJsonResponse = true;
          deferredWriteHeadArgs = [statusCode, ...rest];
          return this; // defer — flushed in end()
        }

        return origWriteHead.apply(this, [statusCode, ...rest] as any);
      };

      // Buffer write() calls for JSON responses
      (res as any).write = function (chunk: any, ...args: any[]): boolean {
        if (isJsonResponse) {
          if (chunk != null) {
            bufferedChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          }
          // Call the callback if provided (write(chunk, encoding, cb) or write(chunk, cb))
          const cb = args.length > 0 ? args[args.length - 1] : undefined;
          if (typeof cb === 'function') cb();
          return true;
        }
        return origWrite.apply(this, [chunk, ...args] as any);
      };

      // Flush buffered JSON body with correct Content-Length
      (res as any).end = function (chunk?: any, ...args: any[]): ServerResponse {
        if (isJsonResponse && deferredWriteHeadArgs) {
          // Collect final chunk
          if (chunk != null && typeof chunk !== 'function') {
            bufferedChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
          }
          const body = Buffer.concat(bufferedChunks);

          // Set byte-accurate Content-Length in writeHead headers
          const [status, ...whRest] = deferredWriteHeadArgs;
          for (let i = whRest.length - 1; i >= 0; i--) {
            if (whRest[i] && typeof whRest[i] === 'object' && !Array.isArray(whRest[i])) {
              whRest[i]['content-length'] = String(body.length);
              delete whRest[i]['Content-Length'];
              delete whRest[i]['transfer-encoding'];
              break;
            }
          }
          this.setHeader('content-length', String(body.length));
          this.removeHeader('transfer-encoding');

          // Flush atomically: writeHead then end(body)
          origWriteHead.apply(this, [status, ...whRest] as any);
          deferredWriteHeadArgs = null;
          bufferedChunks = [];

          // Resolve the callback from end() args
          const cb = args.length > 0 ? args[args.length - 1] : undefined;
          return origEnd.call(this, body, typeof cb === 'function' ? cb : undefined);
        }

        // Non-JSON: pass through
        if (deferredWriteHeadArgs) {
          origWriteHead.apply(this, deferredWriteHeadArgs as any);
          deferredWriteHeadArgs = null;
        }
        return origEnd.apply(this, [chunk, ...args] as any);
      };
    }

    /**
     * Allowed CORS origins — only localhost variants.
     * Non-browser MCP clients (rmcp, Windsurf, curl) typically send no Origin
     * header at all, so they bypass CORS entirely (browser-only mechanism).
     */
    const ALLOWED_ORIGIN_RE = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

    function setCorsHeaders(req: IncomingMessage, res: ServerResponse) {
      const origin = req.headers['origin'];
      if (origin && ALLOWED_ORIGIN_RE.test(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
      }
      // No Access-Control-Allow-Origin at all for disallowed origins —
      // browser will block the response (fail-closed).
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
        patchMcpResponse(res);
        await sessions.get(sessionId)!.transport.handleRequest(req, res, body);
        return;
      }

      if (!sessionId && isInitializeRequest(body)) {
        // New session — create transport + server
        let createdState: SessionState | null = null;
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          enableJsonResponse: true,
          onsessioninitialized: (sid: string) => {
            if (createdState) sessions.set(sid, createdState);
            sessionLastActivity.set(sid, Date.now());
            // Defer log — only emit if session survives past SESSION_LOG_DELAY_MS
            const timer = setTimeout(() => {
              pendingLogTimers.delete(sid);
              console.error(`[memorix] HTTP session active: ${sid.slice(0, 8)}…`);
            }, SESSION_LOG_DELAY_MS);
            pendingLogTimers.set(sid, timer);
          },
        });

        transport.onclose = () => {
          const sid = transport.sessionId;
          if (sid) {
            // If the deferred init log hasn't fired yet, this was a short-lived probe
            const pending = pendingLogTimers.get(sid);
            if (pending) {
              clearTimeout(pending);
              pendingLogTimers.delete(sid);
              suppressedProbeCount++;
              maybeProbeSummary();
            } else if (sessions.has(sid)) {
              console.error(`[memorix] HTTP session closed: ${sid.slice(0, 8)}…`);
            }
            sessions.delete(sid);
            sessionLastActivity.delete(sid);
          }
        };

        // Create a fresh MCP server for this session (with shared team state)
      const { server, switchProject, isExplicitlyBound } = await createMemorixServer(
        projectRoot,
        undefined,
        { teamStore: sharedTeamStore },
        {
          allowUntrackedFallback: false,
          deferProjectInitUntilBound: true,
          dashboardMode: 'control-plane',
          dashboardPort: port,
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
              // Cross-platform: strip leading slash on Windows drive paths
              if (/^\/[A-Za-z]:/.test(rootPath)) rootPath = rootPath.slice(1);
              // Normalize to OS-native separators
              rootPath = earlyPath.normalize(rootPath);

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

        patchMcpResponse(res);
        await transport.handleRequest(req, res, body);
        // Do NOT proactively call listRoots() after session establishment —
        // this violates MCP SEP-2260 (server-initiated request must be associated
        // with a client request). Codex and other strict clients treat standalone
        // roots/list as unexpected, which can break MCP tool injection.
        // Project binding relies on:
        //   1. RootsListChangedNotification (client-initiated, then we respond)
        //   2. memorix_session_start({ projectRoot }) for explicit binding
        //   3. cwd-based detection as fallback (deferred-binding mode)
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
    // Serve dashboard alongside MCP so Team panel has direct access to TeamStore
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
    const dashboardObservationStores = new Map<string, ObservationStore>();

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

    async function getDashboardObservationStore(dataDir: string): Promise<ObservationStore> {
      const cached = dashboardObservationStores.get(dataDir);
      if (cached) return cached;
      const { createObservationStore } = await import('../../store/obs-store.js');
      const store = await createObservationStore(dataDir);
      dashboardObservationStores.set(dataDir, store);
      return store;
    }

    async function loadDashboardObservations(dataDir: string) {
      const store = await getDashboardObservationStore(dataDir);
      return store.loadAll();
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
        // CORS headers are already set by setCorsHeaders() in the main handler —
        // do NOT override with wildcard '*' here (security: localhost-only policy).
        res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(data));
      };

      try {
        // Project switcher sync — in control-plane, project is scoped per-request via ?project= query param,
        // so this is a no-op (frontend still sends it for contract parity with standalone mode)
        if (apiPath === '/set-current-project' && req.method === 'POST') {
          sendJson({ ok: true, scope: 'per-request' });
          return;
        }

        if (apiPath === '/team') {
          // Phase 4a: All team state is in SQLite via TeamStore
          const { projectId: teamProjectId } = await resolveRequestProject(url);
          const ts = sharedTeamStore;
          const scope = url.searchParams.get('scope') || 'project';

          // Determine effective project ID for query
          const effectiveTeamProjectId = scope === 'global' ? undefined : teamProjectId;

          const agents = effectiveTeamProjectId ? ts.listAgents(effectiveTeamProjectId) : ts.listAllAgents();
          const locks = effectiveTeamProjectId ? ts.listLocks(effectiveTeamProjectId) : ts.listAllLocks();
          const tasks = effectiveTeamProjectId ? ts.listTasks(effectiveTeamProjectId) : ts.listAllTasks();
          const available = effectiveTeamProjectId ? ts.listTasks(effectiveTeamProjectId, { available: true }) : ts.listAllTasks({ available: true });

          // Normalize snake_case DB rows → camelCase frontend contract
          const normalizedAgents = agents.map((a: any) => ({
            id: a.agent_id ?? a.id,
            projectId: a.project_id ?? a.projectId,
            instanceId: a.instance_id ?? a.instanceId,
            agentType: a.agent_type ?? a.agentType,
            name: a.name,
            role: a.role,
            capabilities: typeof a.capabilities === 'string' ? JSON.parse(a.capabilities || '[]') : (a.capabilities || []),
            status: a.status,
            joinedAt: a.joined_at ?? a.joinedAt,
            lastSeenAt: a.last_heartbeat ?? a.last_seen_at ?? a.lastSeenAt,
            leftAt: a.left_at ?? a.leftAt,
            unread: ts.getUnreadCount(teamProjectId, a.agent_id ?? a.id),
            source: a.source || 'sqlite',
          }));

          const normalizedLocks = locks.map((l: any) => ({
            file: l.file,
            projectId: l.project_id ?? l.projectId,
            lockedBy: l.locked_by ?? l.lockedBy,
            lockedAt: l.locked_at ?? l.lockedAt,
            expiresAt: l.expires_at ?? l.expiresAt,
          }));

          const normalizedTasks = tasks.map((tk: any) => ({
            id: tk.task_id ?? tk.id,
            projectId: tk.project_id ?? tk.projectId,
            description: tk.description,
            status: tk.status,
            assignee: tk.assignee_agent_id ?? tk.assignee,
            result: tk.result,
            metadata: typeof tk.metadata === 'string' ? JSON.parse(tk.metadata || 'null') : tk.metadata,
            createdBy: tk.created_by ?? tk.createdBy,
            createdAt: tk.created_at ?? tk.createdAt,
            updatedAt: tk.updated_at ?? tk.updatedAt,
            deps: tk.deps || [],
            requiredRole: tk.required_role ?? tk.requiredRole ?? null,
            preferredRole: tk.preferred_role ?? tk.preferredRole ?? null,
          }));

          // Activity layering: active / recent / historical
          // Thresholds (ms): recent = last 7 days, historical = older
          const RECENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
          const now = Date.now();
          const tierOf = (a: any): 'active' | 'recent' | 'historical' => {
            if (a.status === 'active') return 'active';
            const seen = Date.parse(a.lastSeenAt ?? '') || 0;
            if (now - seen <= RECENT_WINDOW_MS) return 'recent';
            return 'historical';
          };
          const withTier = normalizedAgents.map((a: any) => ({ ...a, activityTier: tierOf(a) }));
          const activeCount = withTier.filter((a: any) => a.activityTier === 'active').length;
          const recentCount = withTier.filter((a: any) => a.activityTier === 'recent').length;
          const historicalCount = withTier.filter((a: any) => a.activityTier === 'historical').length;

          // Role occupancy and handoffs
          const roles = effectiveTeamProjectId ? ts.listRoles(effectiveTeamProjectId) : [];
          const roleOccupancy = effectiveTeamProjectId ? ts.getRoleOccupancy(effectiveTeamProjectId) : [];
          const handoffs = effectiveTeamProjectId ? ts.listHandoffs(effectiveTeamProjectId) : [];

          sendJson({
            scope,
            agents: withTier,
            // Primary headline number
            activeCount,
            // Secondary layering
            recentCount,
            historicalCount,
            totalAgents: withTier.length,
            recentWindowDays: 7,
            locks: normalizedLocks,
            tasks: normalizedTasks,
            availableTasks: available.length,
            sessions: sessions.size,
            roles,
            roleOccupancy,
            handoffs,
          });
          return;
        }

        if (apiPath === '/project') {
          const { projectId: pid, projectName: pname } = await resolveRequestProject(url);
          const isResolved = pid !== '__unresolved__';
          const rootPath = isResolved && defaultProject.rootPath && pid === defaultProject.id ? defaultProject.rootPath : null;
          sendJson({ id: pid, name: pname, resolved: isResolved, rootPath, mode: 'control-plane', port, mcpEndpoint: `http://127.0.0.1:${port}/mcp` });
          return;
        }

        if (apiPath === '/stats') {
          const { projectId: statsProjectId, dataDir: statsDataDir } = await resolveRequestProject(url);
          const { initGraphStore, getGraphStore } = await import('../../store/graph-store.js');
          await initGraphStore(statsDataDir);
          const graph = { entities: getGraphStore().loadEntities(), relations: getGraphStore().loadRelations() };

          const allObs = await loadDashboardObservations(statsDataDir) as Array<{
            projectId?: string;
            type?: string;
            id?: number;
            title?: string;
            entityName?: string;
            createdAt?: string;
            source?: string;
            commitHash?: string;
            filesModified?: string[];
            status?: string;
            importance?: number;
            accessCount?: number;
          }>;
          const observations = allObs.filter(o => o.projectId === statsProjectId && (o.status ?? 'active') === 'active');
          const statsStore = await getDashboardObservationStore(statsDataDir);
          const nextId = await statsStore.loadIdCounter();
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

          let vectorStatus = { total: 0, missing: 0, missingIds: [] as number[], backfillRunning: false };
          try {
            const { getVectorStatus } = await import('../../memory/observations.js');
            vectorStatus = getVectorStatus();
          } catch { /* best effort */ }

          // Real search mode from the last actual search execution
          let searchMode = 'fulltext';
          try {
            const { getLastSearchMode } = await import('../../store/orama-store.js');
            searchMode = getLastSearchMode(statsProjectId);
          } catch { /* best effort */ }

          // Embedding provider state: disabled / temporarily_unavailable / ready
          let embeddingProviderState: 'disabled' | 'temporarily_unavailable' | 'ready' = 'disabled';
          try {
            const { isEmbeddingExplicitlyDisabled } = await import('../../embedding/provider.js');
            if (isEmbeddingExplicitlyDisabled()) {
              embeddingProviderState = 'disabled';
            } else if (embeddingStatus.enabled) {
              embeddingProviderState = 'ready';
            } else {
              embeddingProviderState = 'temporarily_unavailable';
            }
          } catch { /* best effort */ }

          // Project-scoped graph counts (must match /graph and /export)
          const projectEntityNames = new Set(
            observations.filter(o => o.entityName).map(o => o.entityName!)
          );
          const projectEntities = graph.entities.filter((e: any) => projectEntityNames.has(e.name));
          const projectEntitySet = new Set(projectEntities.map((e: any) => e.name));
          const projectRelations = graph.relations.filter((r: any) => projectEntitySet.has(r.from) && projectEntitySet.has(r.to));

          sendJson({
            entities: projectEntities.length,
            relations: projectRelations.length,
            observations: observations.length,
            nextId,
            typeCounts,
            sourceCounts,
            recentObservations: sorted,
            embedding: embeddingStatus,
            embeddingProviderState,
            searchMode,
            vectorStatus,
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
          const allObs = await loadDashboardObservations(obsDataDir) as Array<{ projectId?: string; status?: string }>;
          sendJson(allObs.filter(o => o.projectId === obsProjectId && (o.status ?? 'active') === 'active'));
          return;
        }

        if (apiPath === '/graph') {
          const { projectId: graphProjectId, dataDir: graphDataDir } = await resolveRequestProject(url);
          const { initGraphStore, getGraphStore } = await import('../../store/graph-store.js');
          await initGraphStore(graphDataDir);
          const fullGraph = { entities: getGraphStore().loadEntities(), relations: getGraphStore().loadRelations() };

          // Project-scope the graph: only include entities that have observations in this project
          const allObs = await loadDashboardObservations(graphDataDir) as Array<{ projectId?: string; entityName?: string; status?: string }>;
          const projectEntityNames = new Set(
            allObs
              .filter(o => o.projectId === graphProjectId && (o.status ?? 'active') === 'active' && o.entityName)
              .map(o => o.entityName!)
          );

          const entities = fullGraph.entities.filter(e => projectEntityNames.has(e.name));
          const entityNameSet = new Set(entities.map(e => e.name));
          const relations = fullGraph.relations.filter(r => entityNameSet.has(r.from) && entityNameSet.has(r.to));

          sendJson({ entities, relations });
          return;
        }

        if (apiPath === '/sessions') {
          const { projectId: sessProjectId, dataDir: sessDataDir } = await resolveRequestProject(url);
          const { initSessionStore, getSessionStore, resetSessionStore } = await import('../../store/session-store.js');
          await initSessionStore(sessDataDir);
          const allSessions = await getSessionStore().loadByProject(sessProjectId);
          sendJson(allSessions);
          return;
        }

        if (apiPath === '/retention') {
          const { projectId: retProjectId, dataDir: retDataDir } = await resolveRequestProject(url);
          const allObs = await loadDashboardObservations(retDataDir) as Array<{ projectId?: string; id?: number; title?: string; type?: string; importance?: number; accessCount?: number; lastAccessedAt?: string; createdAt?: string; entityName?: string; status?: string }>;
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
          const { projectId: configProjectId } = await resolveRequestProject(url);
          const os = await import('node:os');
          const { existsSync } = await import('node:fs');
          const { join } = await import('node:path');
          const { loadYamlConfig } = await import('../../config/yaml-loader.js');
          const { loadFileConfig, loadDotenv, getLoadedEnvFiles } = await import('../../config.js');

          // Determine the effective project root for config resolution.
          // For the startup project, use the known projectRoot.
          // For other projects, we cannot reverse-lookup the fs root from a project ID,
          // so fall back to user-level config only and flag the limitation.
          const isStartupProject = configProjectId === defaultProject.id;
          const effectiveRoot = isStartupProject ? projectRoot : null;

          if (effectiveRoot) {
            loadDotenv(effectiveRoot);
          }
          const yml = effectiveRoot ? loadYamlConfig(effectiveRoot) : loadYamlConfig(null);
          const legacy = loadFileConfig();

          const files: Record<string, { exists: boolean; path: string; unavailable?: boolean }> = {};
          const home = os.homedir();
          if (effectiveRoot) {
            const paths: Record<string, string> = {
              'project memorix.yml': join(effectiveRoot, 'memorix.yml'),
              'user memorix.yml': join(home, '.memorix', 'memorix.yml'),
              'project .env': join(effectiveRoot, '.env'),
              'user .env': join(home, '.memorix', '.env'),
              'legacy config.json': join(home, '.memorix', 'config.json'),
            };
            for (const [key, fpath] of Object.entries(paths)) {
              files[key] = { exists: existsSync(fpath), path: fpath };
            }
          } else {
            // Non-startup/unresolved project: only user-level config files are resolvable
            files['project memorix.yml'] = { exists: false, path: 'unavailable', unavailable: true };
            files['project .env'] = { exists: false, path: 'unavailable', unavailable: true };
            const userPaths: Record<string, string> = {
              'user memorix.yml': join(home, '.memorix', 'memorix.yml'),
              'user .env': join(home, '.memorix', '.env'),
              'legacy config.json': join(home, '.memorix', 'config.json'),
            };
            for (const [key, fpath] of Object.entries(userPaths)) {
              files[key] = { exists: existsSync(fpath), path: fpath };
            }
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

          sendJson({
            projectId: configProjectId,
            isStartupProject,
            ...(!isStartupProject ? { note: 'Project-level config (memorix.yml, .env) is only available for the startup project. Showing user-level config only.' } : {}),
            files,
            values,
            loadedEnvFiles: [...getLoadedEnvFiles()],
          });
          return;
        }

        if (apiPath === '/identity') {
          const { projectId: idProjectId, dataDir: idDataDir } = await resolveRequestProject(url);
          const { classifyProjectId, isDirtyProjectId } = await import('../../dashboard/project-classification.js');
          const allObs = await loadDashboardObservations(idDataDir) as Array<{ projectId?: string }>;
          const allProjectIds = [...new Set(allObs.map(o => o.projectId).filter(Boolean))] as string[];

          // Classify every known ID (real / temporary / placeholder) + dirty axis
          const classified = allProjectIds.map(id => ({
            id,
            kind: classifyProjectId(id),
            dirty: isDirtyProjectId(id),
            isCurrent: id === idProjectId,
          }));

          const realIds = classified.filter(c => c.kind === 'real').map(c => c.id);
          const temporaryIds = classified.filter(c => c.kind === 'temporary').map(c => c.id);
          const placeholderIds = classified.filter(c => c.kind === 'placeholder').map(c => c.id);
          const dirtyIds = classified.filter(c => c.dirty).map(c => c.id);

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

          // Alias groups intersecting real (non-temporary, non-placeholder) IDs.
          // This is the number UI should headline — not the raw registry count.
          const realIdSet = new Set(realIds);
          const aliasGroupsReal = aliasGroups.filter((g: any) => {
            const members = [g.canonical, ...(g.aliases || [])].filter(Boolean);
            return members.some((m: string) => realIdSet.has(m));
          }).length;

          // Current project dirty flag
          const currentDirty = isDirtyProjectId(idProjectId);
          // Unmerged real fragments = real IDs that aren't covered by any alias group
          const aliasCoveredReal = new Set<string>();
          for (const g of aliasGroups) {
            for (const m of [g.canonical, ...(g.aliases || [])]) {
              if (m && realIdSet.has(m)) aliasCoveredReal.add(m);
            }
          }
          const unmergedRealFragments = realIds.filter(id => !aliasCoveredReal.has(id));
          const hasMultipleUnmerged = unmergedRealFragments.length > 1;
          const isHealthy = !currentDirty && !hasMultipleUnmerged;

          sendJson({
            currentProjectId: idProjectId,
            canonicalId,
            aliases,
            currentKind: classifyProjectId(idProjectId),
            currentDirty,
            // Primary counts — the ones UI should headline
            realKnownIds: realIds,
            // De-emphasized / historical
            temporaryKnownIds: temporaryIds,
            placeholderKnownIds: placeholderIds,
            // Back-compat: full list for legacy consumers
            allProjectIds,
            dirtyIds,
            // Alias registry: both a raw count (whole registry) and a real-scoped count
            aliasGroups: aliasGroups.length,
            aliasGroupsReal,
            unmergedRealFragments,
            isHealthy,
            healthIssues: [
              ...(currentDirty ? ['Current project ID is dirty (broken canonical)'] : []),
              ...(hasMultipleUnmerged ? [`${unmergedRealFragments.length} unmerged real project fragments detected`] : []),
            ],
          });
          return;
        }

        if (apiPath === '/projects') {
          const { classifyProjectId, isDirtyProjectId } = await import('../../dashboard/project-classification.js');
          const allObs = await loadDashboardObservations(defaultDataDir) as Array<{ projectId?: string; status?: string; createdAt?: string; timestamp?: string }>;
          const agg = new Map<string, { count: number; lastActivity: number }>();
          for (const obs of allObs) {
            if (!obs.projectId) continue;
            if ((obs.status ?? 'active') !== 'active') continue;
            const ts = Date.parse(obs.createdAt ?? obs.timestamp ?? '') || 0;
            const cur = agg.get(obs.projectId);
            if (cur) {
              cur.count++;
              if (ts > cur.lastActivity) cur.lastActivity = ts;
            } else {
              agg.set(obs.projectId, { count: 1, lastActivity: ts });
            }
          }
          const projects = Array.from(agg.entries())
            .filter(([id]) => id !== '__unresolved__')
            .sort((a, b) => b[1].count - a[1].count)
            .map(([id, v]) => ({
              id,
              name: id.split('/').pop() || id,
              count: v.count,
              lastActivity: v.lastActivity || null,
              isCurrent: id === defaultProject.id,
              kind: classifyProjectId(id),
              dirty: isDirtyProjectId(id),
            }));
          sendJson(projects);
          return;
        }

        // DELETE /api/observations/:id — delete a single observation
        const deleteMatch = apiPath.match(/^\/observations\/(\d+)$/);
        if (deleteMatch && req.method === 'DELETE') {
          const obsId = parseInt(deleteMatch[1], 10);
          const { projectId: delProjectId, dataDir: delDataDir } = await resolveRequestProject(url);
          const store = await getDashboardObservationStore(delDataDir);
          const allObs = await store.loadAll();
          const matchObs = allObs.find((o: any) => o.id === obsId);
          if (!matchObs) {
            sendJson({ error: 'Observation not found' }, 404);
          } else if ((matchObs as any).projectId !== delProjectId) {
            sendJson({ error: `Observation #${obsId} belongs to project "${(matchObs as any).projectId}", not "${delProjectId}"` }, 403);
          } else {
            await store.remove(obsId);
            // Sync: clean up graph entity references
            try {
              const { initGraphStore, getGraphStore } = await import('../../store/graph-store.js');
              await initGraphStore(delDataDir);
              const gStore = getGraphStore();
              const prefix = `[#${obsId}] `;
              const deletions: { entityName: string; observations: string[] }[] = [];
              for (const entity of gStore.loadEntities()) {
                const toRemove = entity.observations.filter((o: string) => o.startsWith(prefix));
                if (toRemove.length > 0) deletions.push({ entityName: entity.name, observations: toRemove });
              }
              if (deletions.length > 0) gStore.deleteObservations(deletions);
            } catch { /* graph sync is best-effort */ }
            sendJson({ ok: true, deleted: obsId });
          }
          return;
        }

        // GET /api/export — export observations as JSON
        if (apiPath === '/export') {
          const { projectId: expProjectId, projectName: expProjectName, dataDir: expDataDir } = await resolveRequestProject(url);
          const { initGraphStore, getGraphStore } = await import('../../store/graph-store.js');
          await initGraphStore(expDataDir);
          const fullGraph = { entities: getGraphStore().loadEntities(), relations: getGraphStore().loadRelations() };
          const allObs = await loadDashboardObservations(expDataDir) as Array<{ projectId?: string; entityName?: string; status?: string }>;
          const observations = allObs.filter(o => o.projectId === expProjectId && (o.status ?? 'active') === 'active');
          const expStore = await getDashboardObservationStore(expDataDir);
          const nextId = await expStore.loadIdCounter();
          const exportEntityNames = new Set(
            observations.filter(o => o.entityName).map(o => o.entityName!),
          );
          const exportEntities = fullGraph.entities.filter((e: any) => exportEntityNames.has(e.name));
          const exportEntitySet = new Set(exportEntities.map((e: any) => e.name));
          const exportRelations = fullGraph.relations.filter((r: any) => exportEntitySet.has(r.from) && exportEntitySet.has(r.to));
          const exportData = {
            project: { id: expProjectId, name: expProjectName },
            exportedAt: new Date().toISOString(),
            graph: { entities: exportEntities, relations: exportRelations },
            observations,
            nextId,
          };
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Content-Disposition': `attachment; filename="memorix-${expProjectId.replace(/\//g, '-')}-export.json"`,
          });
          res.end(JSON.stringify(exportData, null, 2));
          return;
        }

        sendJson({ error: 'Not found' }, 404);
      } catch (err) {
        sendJson({ error: err instanceof Error ? err.message : 'Unknown error' }, 500);
      }
    }

    const httpServer = createServer(async (req, res) => {
      setCorsHeaders(req, res);

      // Handle CORS preflight
      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      const url = new URL(req.url || '/', `http://localhost:${port}`);

      // Lightweight health check — responds immediately, no heavy init required.
      // This is the readiness signal for background start / status.
      if (url.pathname === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'ok',
          mode: 'control-plane',
          port,
          uptime: Math.round(process.uptime()),
          pid: process.pid,
        }));
        return;
      }

      // MCP endpoint
      if (url.pathname === '/mcp') {
        // Ensure Accept header includes both application/json and text/event-stream.
        // Some MCP clients (e.g. rmcp) omit text/event-stream, causing the SDK's
        // StreamableHTTPServerTransport to reject with 406 Not Acceptable.
        // Hono's node-server reads rawHeaders (not req.headers), so we must patch both.
        const accept = req.headers['accept'] || '';
        const needs: string[] = [];
        if (!accept.includes('application/json')) needs.push('application/json');
        if (!accept.includes('text/event-stream')) needs.push('text/event-stream');
        if (needs.length > 0) {
          const patched = accept ? `${accept}, ${needs.join(', ')}` : needs.join(', ');
          req.headers['accept'] = patched;
          // Patch rawHeaders array (Hono reads this for Web Standard Request conversion)
          let found = false;
          for (let i = 0; i < req.rawHeaders.length; i += 2) {
            if (req.rawHeaders[i].toLowerCase() === 'accept') {
              req.rawHeaders[i + 1] = patched;
              found = true;
              break;
            }
          }
          if (!found) {
            req.rawHeaders.push('Accept', patched);
          }
        }

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
      // Write readiness file — background start polls this for out-of-band readiness detection
      try {
        const memorixDir = (process.env.HOME || process.env.USERPROFILE || '').replace(/\\/g, '/') + '/.memorix';
        mkdirSync(memorixDir, { recursive: true });
        writeFileSync(memorixDir + '/background.ready', JSON.stringify({ pid: process.pid, port, readyAt: Date.now() }));
      } catch { /* best-effort — HTTP /health is the primary signal */ }

      console.error(`[memorix] ═══════════════════════════════════════════════════`);
      console.error(`[memorix] Mode: Control Plane (HTTP MCP + Dashboard + Team)`);
      console.error(`[memorix] MCP Server listening on http://127.0.0.1:${port}/mcp`);
      console.error(`[memorix] Dashboard:     http://127.0.0.1:${port}/`);
      console.error(`[memorix] Team API:      http://127.0.0.1:${port}/api/team`);
      console.error(`[memorix] Port:          ${port}`);
      console.error(`[memorix] ═══════════════════════════════════════════════════`);
      console.error(`[memorix] Sessions at startup: ${sessions.size} (live count available at /api/team)`);
      console.error(`[memorix] Agents can connect via: { "transport": "http", "url": "http://localhost:${port}/mcp" }`);

      // Fire-and-forget: silent auto-update check after server is fully started.
      // All output goes to stderr only. Failures never affect the server.
      import('../update-checker.js').then(m => m.checkForUpdates()).catch(() => {});
    });

    // Session timeout GC — close sessions idle for 30 minutes
    const SESSION_TIMEOUT_MS = 30 * 60 * 1000;
    const gcInterval = setInterval(() => {
      maybeProbeSummary(); // Flush suppressed probe count periodically
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
      if (suppressedProbeCount > 0) {
        console.error(`[memorix] ${suppressedProbeCount} probe connection(s) suppressed during this session`);
      }
      console.error('[memorix] Shutting down HTTP server...');
      // Clean up readiness and heartbeat files
      try {
        const memorixDir = (process.env.HOME || process.env.USERPROFILE || '').replace(/\\/g, '/') + '/.memorix';
        const { unlinkSync } = await import('node:fs');
        try { unlinkSync(memorixDir + '/background.ready'); } catch { /* ok */ }
        try { unlinkSync(memorixDir + '/background.heartbeat'); } catch { /* ok */ }
      } catch { /* best-effort */ }
      for (const store of dashboardObservationStores.values()) {
        try { store.close(); } catch { /* best-effort */ }
      }
      dashboardObservationStores.clear();
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

    // Prevent unhandled rejections / exceptions from killing the background process.
    // Without these, any unhandled promise rejection in Node.js v20+ terminates the process
    // silently — the background control plane disappears with no log trail.
    process.on('unhandledRejection', (reason) => {
      console.error('[memorix] Unhandled rejection in control plane:', reason);
    });
    process.on('uncaughtException', (err) => {
      console.error('[memorix] Uncaught exception in control plane:', err);
      // Do NOT exit — log and continue. The process is a long-running service.
      // Only exit on truly catastrophic errors (OOM, stack overflow) which Node handles itself.
    });

    // Self-health watchdog: write heartbeat every 30s so stale detection works
    // even if the process is alive but the HTTP server has hung.
    const _memorixDir = (process.env.HOME || process.env.USERPROFILE || '').replace(/\\/g, '/') + '/.memorix';
    const heartbeatFile = _memorixDir + '/background.heartbeat';
    const heartbeatInterval = setInterval(() => {
      try {
        writeFileSync(heartbeatFile, JSON.stringify({
          pid: process.pid,
          port,
          uptime: Math.round(process.uptime()),
          heartbeatAt: Date.now(),
        }));
      } catch { /* best-effort */ }
    }, 30_000);
    heartbeatInterval.unref();
    // Write initial heartbeat immediately
    try {
      mkdirSync(_memorixDir, { recursive: true });
      writeFileSync(heartbeatFile, JSON.stringify({
        pid: process.pid,
        port,
        uptime: Math.round(process.uptime()),
        heartbeatAt: Date.now(),
      }));
    } catch { /* best-effort */ }
  },
});
