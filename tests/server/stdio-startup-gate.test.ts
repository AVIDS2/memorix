import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';

import { getMcpServerInfo } from '../../src/server/mcp-compat.js';
import { StdioStartupGate } from '../../src/server/stdio-startup-gate.js';

type JsonRpcMessage = Record<string, unknown>;

function readLines(stream: PassThrough): Promise<JsonRpcMessage[]> {
  return new Promise((resolve) => {
    let buffer = '';
    const messages: JsonRpcMessage[] = [];
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      let newline: number;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) messages.push(JSON.parse(line) as JsonRpcMessage);
      }
      if (messages.length > 0) {
        stream.off('data', onData);
        resolve(messages);
      }
    };
    stream.on('data', onData);
  });
}

describe('stdio startup gate', () => {
  it('answers early discovery with complete static capabilities and queues other requests', async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const gate = new StdioStartupGate({
      stdin,
      stdout,
      serverInfo: getMcpServerInfo(),
    });
    gate.start();

    const forwarded: string[] = [];
    gate.input.on('data', (chunk: Buffer) => forwarded.push(chunk.toString('utf8')));

    const discoveryOutput = readLines(stdout);
    stdin.write(JSON.stringify({
      jsonrpc: '2.0',
      id: 'early-discover',
      method: 'server/discover',
    }) + '\n');
    stdin.write(JSON.stringify({
      jsonrpc: '2.0',
      id: 'early-list',
      method: 'tools/list',
    }) + '\n');

    const [discovery] = await discoveryOutput;
    expect(discovery).toMatchObject({
      jsonrpc: '2.0',
      id: 'early-discover',
      result: {
        resultType: 'complete',
        supportedVersions: ['2025-11-25', '2024-11-05'],
        capabilities: { tools: { listChanged: true } },
        ttlMs: 0,
        cacheScope: 'private',
        _meta: {
          'io.modelcontextprotocol/serverInfo': { name: 'memorix' },
        },
      },
    });
    expect(forwarded).toEqual([]);

    gate.markReady();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(forwarded.join('')).toBe(JSON.stringify({
      jsonrpc: '2.0',
      id: 'early-list',
      method: 'tools/list',
    }) + '\n');

    gate.stop();
  });

  it('forwards initialize and versionless calls while answering later discovery once', async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const gate = new StdioStartupGate({
      stdin,
      stdout,
      serverInfo: getMcpServerInfo(),
    });
    gate.start();

    const forwarded: string[] = [];
    gate.input.on('data', (chunk: Buffer) => forwarded.push(chunk.toString('utf8')));
    stdin.write(JSON.stringify({
      jsonrpc: '2.0',
      id: 'initialize',
      method: 'initialize',
      params: { protocolVersion: '2025-11-25' },
    }) + '\n');
    stdin.write(JSON.stringify({
      jsonrpc: '2.0',
      id: 'call',
      method: 'tools/call',
      params: { name: 'memorix_codegraph_status', arguments: {} },
    }) + '\n');

    gate.markReady();
    await new Promise<void>((resolve) => setImmediate(resolve));
    stdin.write(JSON.stringify({
      jsonrpc: '2.0',
      id: 'late-discover',
      method: 'server/discover',
    }) + '\n');
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(forwarded.join('')).toBe([
      JSON.stringify({
        jsonrpc: '2.0',
        id: 'initialize',
        method: 'initialize',
        params: { protocolVersion: '2025-11-25' },
      }),
      JSON.stringify({
        jsonrpc: '2.0',
        id: 'call',
        method: 'tools/call',
        params: { name: 'memorix_codegraph_status', arguments: {} },
      }),
    ].map((line) => line + '\n').join(''));

    const discoveryOutput = readLines(stdout);
    stdin.write(JSON.stringify({
      jsonrpc: '2.0',
      id: 'late-discover',
      method: 'server/discover',
    }) + '\n');
    await expect(discoveryOutput).resolves.toEqual([expect.objectContaining({
      jsonrpc: '2.0',
      id: 'late-discover',
      result: expect.objectContaining({ resultType: 'complete' }),
    })]);

    gate.stop();
  });

  it('preserves fragmented notifications/responses, reports parse errors, and fails safely at the input limit', async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const errors: Error[] = [];
    const gate = new StdioStartupGate({
      stdin,
      stdout,
      serverInfo: getMcpServerInfo(),
      maxBufferSize: 256,
      onError: (error) => errors.push(error),
    });
    gate.start();

    let forwarded = '';
    gate.input.on('data', (chunk: Buffer) => { forwarded += chunk.toString('utf8'); });
    const parseError = readLines(stdout);
    stdin.write('{"jsonrpc":"2.0","id":"response","result":');
    stdin.write('{} }\n{"jsonrpc":"2.0","method":"notifications/initialized"}\n');
    stdin.write('not-json\n');

    await expect(parseError).resolves.toEqual([{
      jsonrpc: '2.0',
      id: null,
      error: { code: -32700, message: 'Parse error' },
    }]);
    gate.markReady();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(forwarded).toBe([
      '{"jsonrpc":"2.0","id":"response","result":{} }\n',
      '{"jsonrpc":"2.0","method":"notifications/initialized"}\n',
    ].join(''));
    expect(errors).toEqual([]);
    gate.stop();

    const limitedStdin = new PassThrough();
    const limitedStdout = new PassThrough();
    const limitedErrors: Error[] = [];
    const limitedGate = new StdioStartupGate({
      stdin: limitedStdin,
      stdout: limitedStdout,
      serverInfo: getMcpServerInfo(),
      maxBufferSize: 8,
      onError: (error) => limitedErrors.push(error),
    });
    limitedGate.start();
    limitedStdin.write('123456789');
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(limitedErrors[0]?.message).toContain('exceeded 8 bytes');
    expect(limitedGate.input.destroyed).toBe(true);
    limitedGate.stop();
  });

  it('replays queued messages before ending the SDK input when stdin closes during startup', async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    let ended = 0;
    const gate = new StdioStartupGate({
      stdin,
      stdout,
      serverInfo: getMcpServerInfo(),
      onEnd: () => { ended += 1; },
    });
    gate.start();

    const forwarded: string[] = [];
    let inputEnded = false;
    gate.input.on('data', (chunk: Buffer) => forwarded.push(chunk.toString('utf8')));
    gate.input.on('end', () => { inputEnded = true; });
    const queued = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) + '\n';
    stdin.write(queued);
    stdin.end();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(ended).toBe(0);
    const inputEnd = new Promise<void>((resolve) => gate.input.once('end', resolve));
    gate.markReady();
    await inputEnd;

    expect(forwarded).toEqual([queued]);
    expect(inputEnded).toBe(true);
    expect(ended).toBe(1);
    gate.stop();
  });

  it('hands EOF to the transport input after the gate is ready', async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    let ended = 0;
    const gate = new StdioStartupGate({
      stdin,
      stdout,
      serverInfo: getMcpServerInfo(),
      onEnd: () => { ended += 1; },
    });
    gate.start();
    gate.markReady();

    let inputEnded = false;
    gate.input.on('data', () => {});
    gate.input.on('end', () => { inputEnded = true; });
    const inputEnd = new Promise<void>((resolve) => gate.input.once('end', resolve));
    stdin.end();
    await inputEnd;

    expect(inputEnded).toBe(true);
    expect(ended).toBe(1);
    gate.stop();
  });
});
