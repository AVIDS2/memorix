import { execFileSync } from 'node:child_process';
import { PassThrough } from 'node:stream';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createMcpHandler, McpServer as ModernMcpServer } from '@modelcontextprotocol/server';
import { serveStdio, StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { afterEach, describe, expect, it } from 'vitest';
import { createModernMcpBridge } from '../../src/server/modern-mcp-bridge.js';

const modernMeta = {
  'io.modelcontextprotocol/protocolVersion': '2026-07-28',
  'io.modelcontextprotocol/clientInfo': { name: 'memorix-modern-test', version: '1.0.0' },
  'io.modelcontextprotocol/clientCapabilities': {},
};

function modernRequest(
  method: string,
  id: string | number,
  params: Record<string, unknown> = {},
  metadata: Record<string, unknown> = modernMeta,
): Request {
  const version = typeof metadata['io.modelcontextprotocol/protocolVersion'] === 'string'
    ? metadata['io.modelcontextprotocol/protocolVersion']
    : '2026-07-28';
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'mcp-protocol-version': version,
    'mcp-method': method,
  };
  if (method === 'tools/call' && typeof params.name === 'string') headers['mcp-name'] = params.name;
  return new Request('http://localhost/mcp', {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params: { ...params, _meta: metadata } }),
  });
}

async function makeProject(): Promise<{ root: string; dataDir: string }> {
  const root = await mkdtemp(path.join(tmpdir(), 'memorix-modern-mcp-'));
  const dataDir = path.join(root, 'data');
  await mkdir(dataDir, { recursive: true });
  execFileSync('git', ['init'], { cwd: root, stdio: 'ignore', windowsHide: true });
  return { root, dataDir };
}

describe('official MCP v2 modern bridge', () => {
  let project: { root: string; dataDir: string } | undefined;

  afterEach(async () => {
    const [{ resetObservationStore }, { resetSessionStore }, { resetMiniSkillStore }, { resetGraphStore }, { closeAllDatabases }] = await Promise.all([
      import('../../src/store/obs-store.js'),
      import('../../src/store/session-store.js'),
      import('../../src/store/mini-skill-store.js'),
      import('../../src/store/graph-store.js'),
      import('../../src/store/sqlite-db.js'),
    ]);
    resetObservationStore();
    resetSessionStore();
    resetMiniSkillStore();
    resetGraphStore();
    closeAllDatabases();
    if (project) await rm(project.root, { recursive: true, force: true });
    delete process.env.MEMORIX_DATA_DIR;
    project = undefined;
  });

  it('serves discovery, metadata, tool listing, and tool calls over modern HTTP', async () => {
    project = await makeProject();
    process.env.MEMORIX_DATA_DIR = project.dataDir;
    const handler = createMcpHandler(
      () => createModernMcpBridge({
        projectRoot: project!.root,
        allowUntrackedFallback: false,
        deferProjectInitUntilBound: true,
        deferProjectRuntimeInit: true,
        toolProfile: 'micro',
      }),
      { legacy: 'reject' },
    );

    const discoveryResponse = await handler.fetch(modernRequest('server/discover', 'discover'));
    const discovery = await discoveryResponse.json() as any;
    expect(discoveryResponse.status).toBe(200);
    expect(discovery.result.resultType).toBe('complete');
    expect(discovery.result.supportedVersions).toEqual(['2026-07-28']);
    expect(discovery.result.ttlMs).toBe(0);
    expect(discovery.result.cacheScope).toBe('private');
    expect(discovery.result._meta['io.modelcontextprotocol/serverInfo'].name).toBe('memorix');

    const listResponse = await handler.fetch(modernRequest('tools/list', 'list'));
    const listed = await listResponse.json() as any;
    expect(listResponse.status).toBe(200);
    expect(listed.result.resultType).toBe('complete');
    expect(listed.result.ttlMs).toBe(0);
    expect(listed.result._meta['io.modelcontextprotocol/serverInfo'].name).toBe('memorix');
    expect(listed.result.tools).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'memorix_project_context' }),
    ]));

    const callResponse = await handler.fetch(modernRequest('tools/call', 'call', {
      name: 'memorix_codegraph_status',
      arguments: {},
    }));
    const called = await callResponse.json() as any;
    expect(callResponse.status).toBe(200);
    expect(called.result.resultType).toBe('complete');
    expect(called.result._meta['io.modelcontextprotocol/serverInfo'].name).toBe('memorix');
    expect(called.result.content[0].type).toBe('text');

    await handler.close();
  });

  it('rejects a legacy initialize on the modern-only handler with a typed version error', async () => {
    const handler = createMcpHandler(
      () => new ModernMcpServer({ name: 'test', version: '1' }),
      { legacy: 'reject' },
    );
    const response = await handler.fetch(new Request('http://localhost/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'legacy', version: '1' } },
      }),
    }));
    const body = await response.json() as any;
    expect(response.status).toBe(400);
    expect(body.error.code).toBe(-32022);
    expect(body.error.data.supported).toEqual(['2026-07-28']);
    await handler.close();
  });

  it('rejects an unsupported modern revision and does not fake Tasks support', async () => {
    const handler = createMcpHandler(
      () => new ModernMcpServer({ name: 'test', version: '1' }),
      { legacy: 'reject' },
    );
    const unsupportedMeta = {
      ...modernMeta,
      'io.modelcontextprotocol/protocolVersion': '2026-10-01',
    };
    const unsupportedResponse = await handler.fetch(modernRequest('tools/list', 'unsupported', {}, unsupportedMeta));
    const unsupported = await unsupportedResponse.json() as any;
    expect(unsupportedResponse.status).toBe(400);
    expect(unsupported.error.data.supported).toEqual(['2026-07-28']);

    const tasksResponse = await handler.fetch(modernRequest('tasks/list', 'tasks'));
    const tasks = await tasksResponse.json() as any;
    expect(tasks.error).toBeDefined();
    expect(tasks.error.code).toBe(-32601);
    await handler.close();
  });

  it('serves the official subscriptions listen stream with an acknowledgement', async () => {
    const handler = createMcpHandler(
      () => new ModernMcpServer({ name: 'test', version: '1' }),
      { legacy: 'reject' },
    );
    const controller = new AbortController();
    const response = await handler.fetch(new Request(modernRequest('subscriptions/listen', 'subscription', {
      notifications: { toolsListChanged: true },
    }), { signal: controller.signal }));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const reader = response.body!.getReader();
    const first = await reader.read();
    const firstFrame = new TextDecoder().decode(first.value);
    expect(firstFrame).toContain('notifications/subscriptions/acknowledged');
    controller.abort();
    await reader.cancel();
    await handler.close();
  });

  it('serves the same bridge over modern stdio without a legacy handshake', async () => {
    project = await makeProject();
    process.env.MEMORIX_DATA_DIR = project.dataDir;
    const input = new PassThrough();
    const output = new PassThrough();
    const lines: any[] = [];
    let pending = '';
    output.setEncoding('utf8');
    output.on('data', (chunk: string) => {
      pending += chunk;
      let newline = pending.indexOf('\n');
      while (newline >= 0) {
        const line = pending.slice(0, newline).trim();
        pending = pending.slice(newline + 1);
        if (line) lines.push(JSON.parse(line));
        newline = pending.indexOf('\n');
      }
    });

    const handle = serveStdio(
      () => createModernMcpBridge({
        projectRoot: project!.root,
        allowUntrackedFallback: false,
        deferProjectInitUntilBound: true,
        deferProjectRuntimeInit: true,
        toolProfile: 'micro',
      }),
      { transport: new StdioServerTransport(input, output) },
    );
    const waitFor = async (id: string): Promise<any> => {
      const deadline = Date.now() + 15_000;
      while (Date.now() < deadline) {
        const found = lines.find((message) => String(message.id) === id);
        if (found) return found;
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      throw new Error(`Timed out waiting for stdio response ${id}`);
    };

    input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 'discover', method: 'server/discover', params: { _meta: modernMeta } })}\n`);
    const discovery = await waitFor('discover');
    expect(discovery.result.resultType).toBe('complete');
    expect(discovery.result.supportedVersions).toEqual(['2026-07-28']);

    input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 'list', method: 'tools/list', params: { _meta: modernMeta } })}\n`);
    const listed = await waitFor('list');
    expect(listed.result.resultType).toBe('complete');
    expect(listed.result.tools).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'memorix_project_context' }),
    ]));

    await handle.close();
    input.end();
  });
});
