/**
 * HTTP Transport Integration Tests
 *
 * Tests the MCP Streamable HTTP transport (serve-http command).
 * Verifies session management, tool listing, and multi-session support.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

vi.mock('../../src/embedding/provider.js', () => ({
  getEmbeddingProvider: async () => null,
  isVectorSearchAvailable: async () => false,
  resetProvider: () => {},
}));

vi.mock('../../src/llm/provider.js', () => ({
  initLLM: () => null,
  isLLMEnabled: () => false,
  getLLMConfig: () => null,
}));

// Dynamic imports to avoid bundling issues
let StreamableHTTPServerTransport: any;
let StreamableHTTPClientTransport: any;
let Client: any;
let isInitializeRequest: any;
let createMemorixServer: any;
let CallToolResultSchema: any;
let ListRootsRequestSchema: any;

const TEST_PORT = 13211; // Use high port to avoid conflicts
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

let httpServer: Server;
let tempHomeDir: string;
let testDir: string;
let projectADir: string;
let projectBDir: string;
const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
const originalHomePath = process.env.HOMEPATH;
const sessions = new Map<string, { transport: any; server: any; switchProject: any }>();

async function createFakeGitRepo(root: string, remote?: string) {
  await fs.mkdir(path.join(root, '.git'), { recursive: true });
  const config = remote
    ? `[remote "origin"]\n\turl = ${remote}\n`
    : '';
  await fs.writeFile(path.join(root, '.git', 'config'), config, 'utf8');
}

/**
 * Helper: send a JSON-RPC request to the MCP HTTP endpoint
 */
async function mcpPost(body: unknown, sessionId?: string): Promise<{ status: number; headers: Headers; text: string; json?: any }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/event-stream',
  };
  if (sessionId) headers['Mcp-Session-Id'] = sessionId;

  const res = await fetch(`${BASE_URL}/mcp`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  const text = await res.text();
  let json: any;

  // Parse SSE response
  const dataLines = text.split('\n').filter(l => l.startsWith('data:'));
  if (dataLines.length > 0) {
    try {
      json = JSON.parse(dataLines[0].replace('data: ', ''));
    } catch { /* not JSON */ }
  }

  // Try plain JSON
  if (!json && res.headers.get('content-type')?.includes('application/json')) {
    try { json = JSON.parse(text); } catch { /* not JSON */ }
  }

  return { status: res.status, headers: res.headers, text, json };
}

/**
 * Helper: initialize a new MCP session
 */
async function initSession(): Promise<string> {
  const res = await mcpPost({
    jsonrpc: '2.0',
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'test-agent', version: '1.0' },
    },
    id: 1,
  });

  const sid = res.headers.get('mcp-session-id');
  if (!sid) throw new Error('No session ID returned');

  // Send initialized notification
  await fetch(`${BASE_URL}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      'Mcp-Session-Id': sid,
    },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
  });

  return sid;
}

beforeAll(async () => {
  tempHomeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memorix-http-home-'));
  process.env.HOME = tempHomeDir;
  process.env.USERPROFILE = tempHomeDir;
  process.env.HOMEPATH = tempHomeDir;

  // Import dependencies
  const streamMod = await import('@modelcontextprotocol/sdk/server/streamableHttp.js');
  StreamableHTTPServerTransport = streamMod.StreamableHTTPServerTransport;
  const clientTransportMod = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
  StreamableHTTPClientTransport = clientTransportMod.StreamableHTTPClientTransport;
  const clientMod = await import('@modelcontextprotocol/sdk/client/index.js');
  Client = clientMod.Client;
  const typesMod = await import('@modelcontextprotocol/sdk/types.js');
  isInitializeRequest = typesMod.isInitializeRequest;
  CallToolResultSchema = typesMod.CallToolResultSchema;
  ListRootsRequestSchema = typesMod.ListRootsRequestSchema;
  const serverMod = await import('../../src/server.js');
  createMemorixServer = serverMod.createMemorixServer;

  // Create temp directory for test project
  testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memorix-http-test-'));
  projectADir = path.join(testDir, 'project-a');
  projectBDir = path.join(testDir, 'project-b');
  await fs.mkdir(projectADir, { recursive: true });
  await fs.mkdir(projectBDir, { recursive: true });
  await createFakeGitRepo(projectADir, 'https://github.com/AVIDS2/http-project-a.git');
  await createFakeGitRepo(projectBDir, 'https://github.com/AVIDS2/http-project-b.git');

  // Start test HTTP server (same logic as serve-http.ts)
  httpServer = createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Mcp-Session-Id, Last-Event-Id');
    res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');

    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    const url = new URL(req.url || '/', `http://localhost:${TEST_PORT}`);
    if (url.pathname !== '/mcp') {
      res.writeHead(404); res.end('Not found'); return;
    }

    try {
      if (req.method === 'POST') {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);
        const body = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
        const sessionId = req.headers['mcp-session-id'] as string | undefined;

        if (sessionId && sessions.has(sessionId)) {
          await sessions.get(sessionId)!.transport.handleRequest(req, res, body);
        } else if (!sessionId && isInitializeRequest(body)) {
          let createdState: { transport: any; server: any; switchProject: any } | null = null;
          const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: (sid: string) => {
              if (createdState) sessions.set(sid, createdState);
            },
          });
          transport.onclose = () => {
            const sid = transport.sessionId;
            if (sid) sessions.delete(sid);
          };
          const { server, switchProject } = await createMemorixServer(testDir);
          createdState = { transport, server, switchProject };
          await server.connect(transport);

          const tryRootsSwitch = async () => {
            try {
              const { roots } = await server.server.listRoots();
              if (!roots || roots.length === 0) return;
              for (const root of roots) {
                if (!root.uri.startsWith('file://')) continue;
                const rootPath = fileURLToPath(root.uri);
                const switched = await switchProject(rootPath);
                if (switched) return;
              }
            } catch { /* roots unsupported */ }
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
        } else {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'Bad Request' }, id: null }));
        }
      } else if (req.method === 'GET') {
        const sessionId = req.headers['mcp-session-id'] as string | undefined;
        if (!sessionId || !sessions.has(sessionId)) {
          res.writeHead(400); res.end('Invalid session'); return;
        }
        await sessions.get(sessionId)!.transport.handleRequest(req, res);
      } else if (req.method === 'DELETE') {
        const sessionId = req.headers['mcp-session-id'] as string | undefined;
        if (!sessionId || !sessions.has(sessionId)) {
          res.writeHead(400); res.end('Invalid session'); return;
        }
        await sessions.get(sessionId)!.transport.handleRequest(req, res);
      } else {
        res.writeHead(405); res.end('Method not allowed');
      }
    } catch (err) {
      console.error('[test-server] Error:', err);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32603, message: String(err) }, id: null }));
      }
    }
  });

  await new Promise<void>((resolve) => {
    httpServer.listen(TEST_PORT, '127.0.0.1', () => resolve());
  });
}, 30_000);

afterAll(async () => {
  for (const [, state] of sessions) {
    try { await state.transport.close(); } catch { /* ignore */ }
  }
  sessions.clear();
  await new Promise<void>((resolve) => {
    httpServer.close(() => resolve());
  });
  process.env.HOME = originalHome;
  process.env.USERPROFILE = originalUserProfile;
  process.env.HOMEPATH = originalHomePath;
});

describe('HTTP Transport', () => {
  it('should return 404 for non-/mcp paths', async () => {
    const res = await fetch(`${BASE_URL}/other`);
    expect(res.status).toBe(404);
  });

  it('should reject POST without session ID or initialize', async () => {
    const res = await mcpPost({ jsonrpc: '2.0', method: 'tools/list', id: 1 });
    expect(res.status).toBe(400);
  });

  it('should initialize a new MCP session', async () => {
    const res = await mcpPost({
      jsonrpc: '2.0',
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test', version: '1.0' },
      },
      id: 1,
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('mcp-session-id')).toBeTruthy();
    expect(res.json?.result?.protocolVersion).toBe('2024-11-05');
    expect(res.json?.result?.capabilities?.tools).toBeDefined();
  });

  it('should list all Memorix tools via an initialized session', async () => {
    const sid = await initSession();

    const res = await mcpPost({ jsonrpc: '2.0', method: 'tools/list', id: 2 }, sid);

    expect(res.status).toBe(200);
    expect(res.json?.result?.tools).toBeDefined();
    const toolNames = res.json.result.tools.map((t: any) => t.name);
    expect(toolNames).toContain('memorix_store');
    expect(toolNames).toContain('memorix_search');
    expect(toolNames).toContain('memorix_detail');
    expect(toolNames.length).toBeGreaterThanOrEqual(20);
  });

  it('should support multiple concurrent sessions', async () => {
    const sid1 = await initSession();
    const sid2 = await initSession();

    expect(sid1).not.toBe(sid2);

    // Both sessions should respond to tools/list
    const [res1, res2] = await Promise.all([
      mcpPost({ jsonrpc: '2.0', method: 'tools/list', id: 3 }, sid1),
      mcpPost({ jsonrpc: '2.0', method: 'tools/list', id: 4 }, sid2),
    ]);

    expect(res1.json?.result?.tools?.length).toBeGreaterThanOrEqual(20);
    expect(res2.json?.result?.tools?.length).toBeGreaterThanOrEqual(20);
  });

  it('should isolate project context per HTTP session via roots', async () => {
    const clientA = new Client(
      { name: 'roots-client-a', version: '1.0.0' },
      { capabilities: { roots: { listChanged: true } } },
    );
    const clientB = new Client(
      { name: 'roots-client-b', version: '1.0.0' },
      { capabilities: { roots: { listChanged: true } } },
    );

    clientA.setRequestHandler(ListRootsRequestSchema, async () => ({
      roots: [{ uri: pathToFileURL(projectADir).href, name: 'project-a' }],
    }));
    clientB.setRequestHandler(ListRootsRequestSchema, async () => ({
      roots: [{ uri: pathToFileURL(projectBDir).href, name: 'project-b' }],
    }));

    const transportA = new StreamableHTTPClientTransport(new URL(`${BASE_URL}/mcp`));
    const transportB = new StreamableHTTPClientTransport(new URL(`${BASE_URL}/mcp`));

    try {
      await clientA.connect(transportA);
      await clientB.connect(transportB);
      await clientA.sendRootsListChanged();
      await clientB.sendRootsListChanged();
      await new Promise(resolve => setTimeout(resolve, 100));

      const resultA = await clientA.request({
        method: 'tools/call',
        params: {
          name: 'memorix_session_start',
          arguments: { agent: 'http-roots-a' },
        },
      }, CallToolResultSchema);
      const resultB = await clientB.request({
        method: 'tools/call',
        params: {
          name: 'memorix_session_start',
          arguments: { agent: 'http-roots-b' },
        },
      }, CallToolResultSchema);

      const textA = resultA.content?.[0]?.text ?? '';
      const textB = resultB.content?.[0]?.text ?? '';
      expect(textA).toContain('Project: http-project-a');
      expect(textA).toContain('AVIDS2/http-project-a');
      expect(textB).toContain('Project: http-project-b');
      expect(textB).toContain('AVIDS2/http-project-b');
    } finally {
      await transportA.close();
      await transportB.close();
    }
  });

  it('should reject requests with invalid session ID', async () => {
    const res = await mcpPost(
      { jsonrpc: '2.0', method: 'tools/list', id: 5 },
      'nonexistent-session-id',
    );
    // Should get 400 because session doesn't exist and it's not an initialize request
    expect(res.status).toBe(400);
  });

  it('should handle CORS preflight', async () => {
    const res = await fetch(`${BASE_URL}/mcp`, { method: 'OPTIONS' });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('access-control-allow-methods')).toContain('POST');
  });
});
