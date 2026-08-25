import { PassThrough, type Readable, type Writable } from 'node:stream';

import {
  createMcpStartupDiscoverResult,
  MCP_SERVER_DISCOVER_METHOD,
  type McpServerInfo,
} from './mcp-discovery.js';

/** Keep the gate aligned with @modelcontextprotocol/sdk's stdio ReadBuffer limit. */
export const STDIO_STARTUP_GATE_MAX_BUFFER_SIZE = 10 * 1024 * 1024;

export interface StdioStartupGateOptions {
  stdin: Readable;
  stdout: Writable;
  serverInfo: McpServerInfo;
  maxBufferSize?: number;
  onError?: (error: Error) => void;
  onEnd?: () => void;
}

type JsonRpcEnvelope = Record<string, unknown>;
type ParsedLine = { message: JsonRpcEnvelope } | { error: { code: number; message: string } } | null;

/**
 * Reads stdio before the server's expensive project setup finishes.
 *
 * Only the handshake-free discovery request is answered at the front door. All
 * other complete JSON-RPC lines, including notifications and responses, stay in
 * an ordered queue and are replayed through the SDK transport once it is ready.
 */
export class StdioStartupGate {
  readonly input = new PassThrough();

  private readonly stdin: Readable;
  private readonly stdout: Writable;
  private readonly serverInfo: McpServerInfo;
  private readonly maxBufferSize: number;
  private readonly onError?: (error: Error) => void;
  private readonly onEnd?: () => void;
  private readonly queuedMessages: string[] = [];
  private pendingInput = '';
  private queuedBytes = 0;
  private started = false;
  private ready = false;
  private stopped = false;
  private stdinEnded = false;
  private endNotified = false;

  private readonly onData = (chunk: Buffer | string): void => {
    if (this.stopped) return;

    if (this.ready) {
      if (Buffer.byteLength(chunk, 'utf8') > this.maxBufferSize) {
        this.fail(new Error(`stdio input chunk exceeded ${this.maxBufferSize} bytes`));
        return;
      }
      this.input.write(chunk);
      return;
    }

    const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    if (
      this.queuedBytes
      + Buffer.byteLength(this.pendingInput, 'utf8')
      + Buffer.byteLength(text, 'utf8')
      > this.maxBufferSize
    ) {
      this.fail(new Error(`stdio startup input exceeded ${this.maxBufferSize} bytes before a complete JSON-RPC line`));
      return;
    }

    this.pendingInput += text;
    let newline = this.pendingInput.indexOf('\n');
    while (newline >= 0 && !this.stopped) {
      const line = this.pendingInput.slice(0, newline + 1);
      this.pendingInput = this.pendingInput.slice(newline + 1);
      this.handleLine(line);
      newline = this.pendingInput.indexOf('\n');
    }

    if (!this.stopped && Buffer.byteLength(this.pendingInput, 'utf8') > this.maxBufferSize) {
      this.fail(new Error(`stdio startup input exceeded ${this.maxBufferSize} bytes`));
    }
  };

  private readonly onStdinError = (error: Error): void => {
    this.fail(error);
  };

  private readonly onStdinEnd = (): void => {
    this.stdinEnded = true;
    if (this.ready) this.finishInput();
  };

  constructor(options: StdioStartupGateOptions) {
    this.stdin = options.stdin;
    this.stdout = options.stdout;
    this.serverInfo = { ...options.serverInfo };
    this.maxBufferSize = options.maxBufferSize ?? STDIO_STARTUP_GATE_MAX_BUFFER_SIZE;
    this.onError = options.onError;
    this.onEnd = options.onEnd;
  }

  start(): void {
    if (this.started || this.stopped) return;
    this.started = true;
    this.stdin.on('data', this.onData);
    this.stdin.on('error', this.onStdinError);
    this.stdin.on('end', this.onStdinEnd);
  }

  /** Release queued messages only after StdioServerTransport has installed its listener. */
  markReady(): void {
    if (this.stopped || this.ready) return;
    this.ready = true;
    for (const message of this.queuedMessages) this.input.write(message);
    this.queuedMessages.length = 0;
    this.queuedBytes = 0;
    if (this.pendingInput) {
      this.input.write(this.pendingInput);
      this.pendingInput = '';
    }
    if (this.stdinEnded) this.finishInput();
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.stdin.off('data', this.onData);
    this.stdin.off('error', this.onStdinError);
    this.stdin.off('end', this.onStdinEnd);
    this.queuedMessages.length = 0;
    this.pendingInput = '';
    this.queuedBytes = 0;
    if (!this.input.destroyed) this.input.end();
  }

  private handleLine(line: string): void {
    const parsed = this.parseLine(line);
    if (!parsed) return;
    if ('error' in parsed) {
      this.writeJsonRpcError(null, parsed.error.code, parsed.error.message);
      return;
    }

    if (!this.ready && this.isDiscoveryRequest(parsed.message)) {
      const response = {
        jsonrpc: '2.0',
        id: parsed.message.id,
        result: createMcpStartupDiscoverResult(this.serverInfo),
      };
      try {
        this.stdout.write(`${JSON.stringify(response)}\n`);
      } catch (error) {
        this.fail(error instanceof Error ? error : new Error(String(error)));
      }
      return;
    }

    if (this.ready) {
      this.input.write(line);
      return;
    }

    const bytes = Buffer.byteLength(line, 'utf8');
    if (this.queuedBytes + bytes > this.maxBufferSize) {
      this.fail(new Error(`stdio startup queue exceeded ${this.maxBufferSize} bytes`));
      return;
    }
    this.queuedMessages.push(line);
    this.queuedBytes += bytes;
  }

  private parseLine(line: string): ParsedLine {
    const trimmed = line.endsWith('\n') ? line.slice(0, -1).replace(/\r$/, '') : line;
    if (!trimmed.trim()) return null;

    let value: unknown;
    try {
      value = JSON.parse(trimmed);
    } catch {
      return { error: { code: -32700, message: 'Parse error' } };
    }

    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { error: { code: -32600, message: 'Invalid Request' } };
    }
    const message = value as JsonRpcEnvelope;
    if (message.jsonrpc !== '2.0') {
      return { error: { code: -32600, message: 'Invalid Request' } };
    }

    const hasId = Object.prototype.hasOwnProperty.call(message, 'id');
    const hasMethod = typeof message.method === 'string';
    const hasResult = Object.prototype.hasOwnProperty.call(message, 'result');
    const hasError = Object.prototype.hasOwnProperty.call(message, 'error');
    if (hasMethod && (hasResult || hasError)) {
      return { error: { code: -32600, message: 'Invalid Request' } };
    }
    if (!hasMethod && !hasResult && !hasError) {
      return { error: { code: -32600, message: 'Invalid Request' } };
    }
    if (hasId && !this.isValidRequestId(message.id)) {
      return { error: { code: -32600, message: 'Invalid Request' } };
    }
    if (!hasMethod && !hasId) {
      return { error: { code: -32600, message: 'Invalid Request' } };
    }
    return { message };
  }

  private isDiscoveryRequest(message: JsonRpcEnvelope): boolean {
    if (message.method !== MCP_SERVER_DISCOVER_METHOD) return false;
    if (!Object.prototype.hasOwnProperty.call(message, 'id')) return false;
    const params = message.params;
    return params === undefined || (typeof params === 'object' && params !== null && !Array.isArray(params));
  }

  private isValidRequestId(id: unknown): id is string | number | null {
    return id === null
      || typeof id === 'string'
      || (typeof id === 'number' && Number.isFinite(id));
  }

  private writeJsonRpcError(id: string | number | null, code: number, message: string): void {
    try {
      this.stdout.write(`${JSON.stringify({
        jsonrpc: '2.0',
        id,
        error: { code, message },
      })}\n`);
    } catch (error) {
      this.fail(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private finishInput(): void {
    if (!this.ready || this.input.destroyed || this.input.writableEnded) return;
    this.input.end();
    this.input.once('end', () => this.notifyEnd());
  }

  private notifyEnd(): void {
    if (this.endNotified) return;
    this.endNotified = true;
    this.onEnd?.();
  }

  private fail(error: Error): void {
    if (this.stopped) return;
    this.stopped = true;
    this.stdin.off('data', this.onData);
    this.stdin.off('error', this.onStdinError);
    this.stdin.off('end', this.onStdinEnd);
    this.queuedMessages.length = 0;
    this.pendingInput = '';
    this.queuedBytes = 0;
    // Destroy without an error argument so a not-yet-connected SDK transport
    // cannot turn the gate failure into an unhandled EventEmitter error.
    if (!this.input.destroyed) this.input.destroy();
    this.onError?.(error);
  }
}
