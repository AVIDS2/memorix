/**
 * HTTP Embedding Fallback Regression Test
 *
 * Reproduces the real HTTP/MCP failure path:
 * 1. Session binds to a project while API embeddings are active (1536d index).
 * 2. A later semantic search hits a quota error at runtime.
 * 3. provider.ts falls back to a local provider with different dimensions (384d).
 * 4. The HTTP tool call must degrade to fulltext instead of breaking the session.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const mockApiProviderCreate = vi.fn();
const mockFastEmbedCreate = vi.fn();
const mockTransformersCreate = vi.fn();

vi.mock('../../src/embedding/api-provider.js', () => ({
  APIEmbeddingProvider: {
    create: mockApiProviderCreate,
  },
}));

vi.mock('../../src/embedding/fastembed-provider.js', () => ({
  FastEmbedProvider: {
    create: mockFastEmbedCreate,
  },
}));

vi.mock('../../src/embedding/transformers-provider.js', () => ({
  TransformersProvider: {
    create: mockTransformersCreate,
  },
}));

vi.mock('../../src/llm/provider.js', () => ({
  initLLM: () => null,
  isLLMEnabled: () => false,
  getLLMConfig: () => null,
}));

import { resetProvider } from '../../src/embedding/provider.js';
import { resetDb } from '../../src/store/orama-store.js';
import { resetConfigCache } from '../../src/config.js';

let StreamableHTTPServerTransport: any;
let isInitializeRequest: any;
let createMemorixServer: any;
let CallToolResultSchema: any;

const TEST_PORT = 13212;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;
const EMBEDDING_ENV_KEYS = [
  'MEMORIX_API_KEY',
  'MEMORIX_EMBEDDING',
  'MEMORIX_EMBEDDING_API_KEY',
  'MEMORIX_EMBEDDING_BASE_URL',
  'MEMORIX_EMBEDDING_MODEL',
  'MEMORIX_LLM_API_KEY',
  'OPENAI_API_KEY',
];

let httpServer: Server;
let tempHomeDir: string;
let testDir: string;
let projectDir: string;
const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
const originalHomePath = process.env.HOMEPATH;
const savedEnv: Record<string, string | undefined> = {};
const sessions = new Map<string, { transport: any; server: any; switchProject: any }>();

function makeVector(dimensions: number, value: number): number[] {
  return Array.from({ length: dimensions }, () => value);
}

async function createFakeGitRepo(root: string, remote: string) {
  await fs.mkdir(path.join(root, '.git'), { recursive: true });
  await fs.writeFile(
    path.join(root, '.git', 'config'),
    `[remote "origin"]\n\turl = ${remote}\n`,
    'utf8',
  );
}

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

  const dataLines = text.split('\n').filter(line => line.startsWith('data:'));
  if (dataLines.length > 0) {
    try {
      json = JSON.parse(dataLines[0].replace('data: ', ''));
    } catch {
      // ignore non-JSON event data
    }
  }

  if (!json && res.headers.get('content-type')?.includes('application/json')) {
    try {
      json = JSON.parse(text);
    } catch {
      // ignore non-JSON body
    }
  }

  return { status: res.status, headers: res.headers, text, json };
}

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

async function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Condition not met within ${timeoutMs}ms`);
    }
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

beforeAll(async () => {
  tempHomeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memorix-http-embed-home-'));
  process.env.HOME = tempHomeDir;
  process.env.USERPROFILE = tempHomeDir;
  process.env.HOMEPATH = tempHomeDir;

  const streamMod = await import('@modelcontextprotocol/sdk/server/streamableHttp.js');
  StreamableHTTPServerTransport = streamMod.StreamableHTTPServerTransport;
  const typesMod = await import('@modelcontextprotocol/sdk/types.js');
  isInitializeRequest = typesMod.isInitializeRequest;
  CallToolResultSchema = typesMod.CallToolResultSchema;
  const serverMod = await import('../../src/server.js');
  createMemorixServer = serverMod.createMemorixServer;

  testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memorix-http-embed-test-'));
  projectDir = path.join(testDir, 'project-a');
  await fs.mkdir(projectDir, { recursive: true });
  await createFakeGitRepo(projectDir, 'https://github.com/AVIDS2/http-embed-project.git');

  httpServer = createServer(async (req, res) => {
    const origin = req.headers['origin'];
    const allowedOrigin = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
    if (origin && allowedOrigin.test(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Mcp-Session-Id, Last-Event-Id');
    res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url || '/', `http://localhost:${TEST_PORT}`);
    if (url.pathname !== '/mcp') {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    try {
      if (req.method === 'POST') {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);
        const body = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
        const sessionId = req.headers['mcp-session-id'] as string | undefined;

        if (sessionId && sessions.has(sessionId)) {
          await sessions.get(sessionId)!.transport.handleRequest(req, res, body);
          return;
        }

        if (!sessionId && isInitializeRequest(body)) {
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

          const { server, switchProject } = await createMemorixServer(
            testDir,
            undefined,
            undefined,
            {
              allowUntrackedFallback: false,
              deferProjectInitUntilBound: true,
            },
          );
          createdState = { transport, server, switchProject };
          await server.connect(transport);
          await transport.handleRequest(req, res, body);
          return;
        }

        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'Bad Request' }, id: null }));
        return;
      }

      if (req.method === 'GET' || req.method === 'DELETE') {
        const sessionId = req.headers['mcp-session-id'] as string | undefined;
        if (!sessionId || !sessions.has(sessionId)) {
          res.writeHead(400);
          res.end('Invalid session');
          return;
        }
        await sessions.get(sessionId)!.transport.handleRequest(req, res);
        return;
      }

      res.writeHead(405);
      res.end('Method not allowed');
    } catch (error) {
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32603, message: String(error) }, id: null }));
      }
    }
  });

  await new Promise<void>((resolve) => {
    httpServer.listen(TEST_PORT, '127.0.0.1', () => resolve());
  });
}, 30_000);

beforeEach(() => {
  for (const key of EMBEDDING_ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }

  process.env.MEMORIX_EMBEDDING = 'auto';
  process.env.MEMORIX_EMBEDDING_API_KEY = 'api-key';
  process.env.MEMORIX_EMBEDDING_BASE_URL = 'https://embeddings.example/v1';
  process.env.MEMORIX_EMBEDDING_MODEL = 'text-embedding-3-small';

  resetProvider();
  resetDb();
  resetConfigCache();

  const apiEmbed = vi.fn()
    .mockResolvedValueOnce(makeVector(1536, 0.01))
    .mockRejectedValueOnce(new Error('Embedding API error (402): quota exceeded and account balance is $0.0'));
  const apiEmbedBatch = vi.fn(async (texts: string[]) => texts.map(() => makeVector(1536, 0.01)));
  const fallbackEmbed = vi.fn().mockResolvedValue(makeVector(384, 0.25));
  const fallbackEmbedBatch = vi.fn(async (texts: string[]) => texts.map(() => makeVector(384, 0.25)));

  mockApiProviderCreate.mockReset();
  mockApiProviderCreate.mockResolvedValue({
    name: 'api-text-embedding-3-small',
    dimensions: 1536,
    embed: apiEmbed,
    embedBatch: apiEmbedBatch,
  });

  mockFastEmbedCreate.mockReset();
  mockFastEmbedCreate.mockResolvedValue({
    name: 'fastembed-bge-small-en-v1.5',
    dimensions: 384,
    embed: fallbackEmbed,
    embedBatch: fallbackEmbedBatch,
  });

  mockTransformersCreate.mockReset();
  mockTransformersCreate.mockResolvedValue(null);
});

afterEach(() => {
  resetProvider();
  resetDb();
  resetConfigCache();
  for (const key of EMBEDDING_ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

afterAll(async () => {
  for (const [, state] of sessions) {
    try {
      await state.transport.close();
    } catch {
      // ignore session close errors in cleanup
    }
  }
  sessions.clear();
  await new Promise<void>((resolve) => {
    httpServer.close(() => resolve());
  });
  process.env.HOME = originalHome;
  process.env.USERPROFILE = originalUserProfile;
  process.env.HOMEPATH = originalHomePath;
}, 30_000);

describe('HTTP embedding fallback regression', () => {
  it('keeps HTTP search alive when API quota fallback changes embedding dimensions mid-session', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const sessionId = await initSession();

      const startRes = await mcpPost({
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'memorix_session_start',
          arguments: { agent: 'http-embed-fallback', projectRoot: projectDir },
        },
        id: 101,
      }, sessionId);

      const startResult = CallToolResultSchema.parse(startRes.json?.result);
      expect(startResult.isError).toBeFalsy();

      const storeRes = await mcpPost({
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'memorix_store',
          arguments: {
            entityName: 'http-embed-fallback',
            type: 'problem-solution',
            title: 'HTTP quota fallback memory',
            narrative: 'The HTTP session should keep working when embedding quota errors switch providers at runtime.',
          },
        },
        id: 102,
      }, sessionId);

      const storeResult = CallToolResultSchema.parse(storeRes.json?.result);
      expect(storeResult.isError).toBeFalsy();

      await waitFor(() => {
        const provider = mockApiProviderCreate.mock.results[0]?.value;
        return Boolean(provider);
      });

      const apiEmbed = (await mockApiProviderCreate.mock.results[0]!.value).embed as ReturnType<typeof vi.fn>;
      await waitFor(() => apiEmbed.mock.calls.length >= 1);
      await new Promise(resolve => setTimeout(resolve, 50));

      const searchRes = await mcpPost({
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'memorix_search',
          arguments: {
            query: 'why did the HTTP quota fallback memory break after the embedding provider switched at runtime',
          },
        },
        id: 103,
      }, sessionId);

      expect(searchRes.status).toBe(200);
      const searchResult = CallToolResultSchema.parse(searchRes.json?.result);
      expect(searchResult.isError).toBeFalsy();
      const searchText = searchResult.content.map((part: any) => part.text ?? '').join('\n');
      expect(searchText).toContain('HTTP quota fallback memory');
      expect(apiEmbed).toHaveBeenCalledTimes(2);
      expect(mockFastEmbedCreate).toHaveBeenCalledTimes(1);

      const followUpRes = await mcpPost({
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'memorix_search',
          arguments: {
            query: 'HTTP quota fallback memory',
          },
        },
        id: 104,
      }, sessionId);

      const followUpResult = CallToolResultSchema.parse(followUpRes.json?.result);
      expect(followUpResult.isError).toBeFalsy();

      const logs = errorSpy.mock.calls.map(call => call.join(' ')).join('\n');
      expect(logs).toContain('API embedding temporarily unavailable — switching to local fallback provider');
      expect(logs).toContain('Embedding fallback activated: fastembed-bge-small-en-v1.5 (384d)');
      expect(
        logs.includes('Vector search dimension mismatch detected, retrying without embeddings') ||
        logs.includes('Embedding provider dimension mismatch (384d provider vs 1536d index); using fulltext search'),
      ).toBe(true);
    } finally {
      errorSpy.mockRestore();
    }
  }, 30_000);
});
