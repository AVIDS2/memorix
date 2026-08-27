import { PassThrough } from 'node:stream';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { closeAllDatabases } from '../../src/store/sqlite-db.js';
import { resetDb } from '../../src/store/orama-store.js';
import { resetObservationStore } from '../../src/store/obs-store.js';
import { createMemorixServer } from '../../src/server.js';
import {
  MCP_LEGACY_PROTOCOL_VERSION,
  MCP_MODERN_PROTOCOL_VERSION,
} from '../../src/server/mcp-compat.js';

type JsonRpcMessage = Record<string, unknown>;

let tempRoot = '';
let projectRoot = '';
let previousHome: string | undefined;
let previousUserProfile: string | undefined;
let previousDataDir: string | undefined;
let server: Awaited<ReturnType<typeof createMemorixServer>>['server'] | undefined;
let handleTransportClose: (() => void) | undefined;
let transport: StdioServerTransport | undefined;

function readMessage(output: PassThrough): Promise<JsonRpcMessage> {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      const newline = buffer.indexOf('\n');
      if (newline < 0) return;
      output.off('data', onData);
      try {
        resolve(JSON.parse(buffer.slice(0, newline)) as JsonRpcMessage);
      } catch (error) {
        reject(error);
      }
    };
    output.on('data', onData);
  });
}

async function sendMessage(input: PassThrough, output: PassThrough, message: JsonRpcMessage): Promise<JsonRpcMessage> {
  const response = readMessage(output);
  input.write(`${JSON.stringify(message)}\n`);
  return response;
}

async function createFakeGitRepo(root: string): Promise<void> {
  await fs.mkdir(path.join(root, '.git'), { recursive: true });
  await fs.writeFile(path.join(root, '.git', 'config'), '', 'utf8');
}

beforeEach(async () => {
  previousHome = process.env.HOME;
  previousUserProfile = process.env.USERPROFILE;
  previousDataDir = process.env.MEMORIX_DATA_DIR;
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'memorix-mcp-discovery-'));
  projectRoot = path.join(tempRoot, 'project');
  await fs.mkdir(projectRoot, { recursive: true });
  await createFakeGitRepo(projectRoot);
  process.env.HOME = path.join(tempRoot, 'home');
  process.env.USERPROFILE = process.env.HOME;
  process.env.MEMORIX_DATA_DIR = path.join(tempRoot, 'data');
  resetObservationStore();
  await resetDb();

  const created = await createMemorixServer(projectRoot, undefined, undefined, {
    toolProfile: 'micro',
    deferProjectRuntimeInit: true,
  });
  server = created.server;
  handleTransportClose = created.handleTransportClose;
});

afterEach(async () => {
  await server?.close().catch(() => undefined);
  await transport?.close().catch(() => undefined);
  handleTransportClose?.();
  transport = undefined;
  server = undefined;
  handleTransportClose = undefined;
  resetObservationStore();
  closeAllDatabases();
  await resetDb();
  process.env.HOME = previousHome;
  process.env.USERPROFILE = previousUserProfile;
  if (previousDataDir === undefined) delete process.env.MEMORIX_DATA_DIR;
  else process.env.MEMORIX_DATA_DIR = previousDataDir;
  await fs.rm(tempRoot, { recursive: true, force: true });
});

describe('MCP discovery compatibility at the production server entry', () => {
  it('handles discover before initialize, then serves versionless tools/list and tools/call', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    transport = new StdioServerTransport(input, output);
    await server!.connect(transport);

    const discovery = await sendMessage(input, output, {
      jsonrpc: '2.0',
      id: 'discover-1',
      method: 'server/discover',
      params: { _meta: { 'io.modelcontextprotocol/protocolVersion': MCP_MODERN_PROTOCOL_VERSION } },
    });
    const result = discovery.result as Record<string, any>;

    expect(result).toMatchObject({
      resultType: 'complete',
      supportedVersions: [MCP_LEGACY_PROTOCOL_VERSION, '2024-11-05'],
      capabilities: { tools: { listChanged: true } },
      ttlMs: 0,
      cacheScope: 'private',
      _meta: {
        'io.modelcontextprotocol/serverInfo': { name: 'memorix' },
      },
    });

    const list = await sendMessage(input, output, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
    });
    expect((list.result as Record<string, any>).tools).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'memorix_codegraph_status' }),
    ]));

    const call = await sendMessage(input, output, {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'memorix_codegraph_status', arguments: {} },
    });
    expect(call.error).toBeUndefined();
    expect(call.result).toMatchObject({ content: [{ type: 'text' }] });
  });

  it('keeps legacy initialize working on the production server', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    transport = new StdioServerTransport(input, output);
    await server!.connect(transport);

    const response = await sendMessage(input, output, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: MCP_LEGACY_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'legacy-test', version: '1.0.0' },
      },
    });

    expect(response.error).toBeUndefined();
    expect(response.result).toMatchObject({
      protocolVersion: MCP_LEGACY_PROTOCOL_VERSION,
      serverInfo: { name: 'memorix' },
    });
  });
});
