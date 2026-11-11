/**
 * Modern MCP protocol bridge.
 *
 * Memorix's product handlers still use the mature v1 SDK internally. The
 * public modern transport is served by the official v2 SDK; this bridge keeps
 * one source of truth for the tool implementation by forwarding v2 tool calls
 * through an in-process v1 client/server pair.
 */

import {
  fromJsonSchema,
  McpServer as ModernMcpServer,
} from '@modelcontextprotocol/server';
import { Client as LegacyClient } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport as LegacyInMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { getMcpServerInfo } from './mcp-discovery.js';
import type { CreateMemorixServerOptions } from '../server.js';
import type { ProjectBindingSource } from './request-context.js';

export interface ModernMcpBridgeOptions extends CreateMemorixServerOptions {
  projectRoot: string;
}

/**
 * Lifecycle hooks kept beside the v2 facade so transport adapters do not lose
 * Memorix-specific project binding and deferred maintenance behavior.
 */
export interface ModernMcpBridgeLifecycle {
  projectId: string;
  deferredInit: () => Promise<void>;
  activateProjectRuntime: () => Promise<void>;
  switchProject: (newCwd: string, source?: ProjectBindingSource) => Promise<boolean>;
  getProjectDataDir: () => string;
  isExplicitlyBound: () => boolean;
  handleTransportClose: () => void;
}

export type ModernMcpBridge = ModernMcpServer & {
  memorix: ModernMcpBridgeLifecycle;
};

let businessRuntimeQueue: Promise<unknown> = Promise.resolve();

/** Serialize access to the legacy process-global store layer. */
export function withBusinessRuntimeQueue<T>(work: () => Promise<T>): Promise<T> {
  const result = businessRuntimeQueue.then(work);
  businessRuntimeQueue = result.catch(() => undefined);
  return result;
}

export interface ModernMcpRuntime {
  projectId: string;
  getProjectDataDir: () => string;
  createBridge: () => ModernMcpBridge;
  close: () => Promise<void>;
}

interface RuntimePoolEntry {
  runtime: ModernMcpRuntime;
  refs: number;
  lastUsedAt: number;
}

/**
 * Reuses the expensive legacy business runtime while giving the v2 handler a
 * fresh protocol server per request, as required by the official SDK.
 */
export class ModernMcpRuntimePool {
  private readonly entries = new Map<string, RuntimePoolEntry>();
  private readonly pending = new Map<string, Promise<RuntimePoolEntry>>();

  constructor(private readonly maxEntries = 32) {}

  async createBridge(
    key: string,
    create: () => Promise<ModernMcpRuntime>,
  ): Promise<ModernMcpBridge> {
    let entry = this.entries.get(key);
    if (!entry) {
      let pending = this.pending.get(key);
      if (!pending) {
        pending = create().then(runtime => {
          const created: RuntimePoolEntry = { runtime, refs: 0, lastUsedAt: Date.now() };
          this.entries.set(key, created);
          return created;
        });
        this.pending.set(key, pending);
      }
      try {
        entry = await pending;
      } finally {
        this.pending.delete(key);
      }
    }

    entry.refs++;
    entry.lastUsedAt = Date.now();
    const bridge = entry.runtime.createBridge();
    const close = bridge.close.bind(bridge);
    let released = false;
    bridge.close = async () => {
      try {
        await close();
      } finally {
        if (!released) {
          released = true;
          entry!.refs = Math.max(0, entry!.refs - 1);
          entry!.lastUsedAt = Date.now();
        }
      }
    };
    return bridge;
  }

  async evictIdle(): Promise<number> {
    let closed = 0;
    const idle = [...this.entries.entries()]
      .filter(([, entry]) => entry.refs === 0)
      .sort(([, left], [, right]) => left.lastUsedAt - right.lastUsedAt);
    for (const [key, entry] of idle) {
      if (this.entries.size <= this.maxEntries || entry.refs > 0) continue;
      this.entries.delete(key);
      await entry.runtime.close();
      closed++;
    }
    return closed;
  }

  async close(): Promise<void> {
    const entries = [...this.entries.values()];
    this.entries.clear();
    await Promise.all(entries.map(entry => entry.runtime.close().catch(() => undefined)));
  }

  stats(): { entries: number; activeRefs: number; pending: number } {
    return {
      entries: this.entries.size,
      activeRefs: [...this.entries.values()].reduce((sum, entry) => sum + entry.refs, 0),
      pending: this.pending.size,
    };
  }
}

/**
 * Build an official v2 server whose tools delegate to the existing Memorix
 * implementation. The v1 side is process-local and never becomes a second
 * network endpoint, so project isolation and business behavior stay shared.
 */
export async function createModernMcpRuntime(
  options: ModernMcpBridgeOptions,
): Promise<ModernMcpRuntime> {
  const { createMemorixServer } = await import('../server.js');
  const legacy = await createMemorixServer(
    options.projectRoot,
    undefined,
    undefined,
    {
      ...options,
      allowUntrackedFallback: options.allowUntrackedFallback ?? false,
      deferProjectInitUntilBound: options.deferProjectInitUntilBound ?? true,
      deferProjectRuntimeInit: options.deferProjectRuntimeInit ?? true,
    },
  );

  const [clientTransport, serverTransport] = LegacyInMemoryTransport.createLinkedPair();
  const legacyClient = new LegacyClient({
    name: 'memorix-modern-bridge',
    version: getMcpServerInfo().version,
  });
  await legacy.server.connect(serverTransport);
  await legacyClient.connect(clientTransport);

  const listed = await legacyClient.listTools();
  const callTool = (name: string, args: Record<string, unknown>) =>
    withBusinessRuntimeQueue(async () => {
      await legacy.activateProjectRuntime();
      return await legacyClient.callTool({ name, arguments: args });
    });

  const lifecycle: ModernMcpBridgeLifecycle = {
    projectId: legacy.projectId,
    deferredInit: legacy.deferredInit,
    activateProjectRuntime: legacy.activateProjectRuntime,
    switchProject: legacy.switchProject,
    getProjectDataDir: legacy.getProjectDataDir,
    isExplicitlyBound: legacy.isExplicitlyBound,
    handleTransportClose: legacy.handleTransportClose,
  };

  let closed = false;
  return {
    projectId: legacy.projectId,
    getProjectDataDir: legacy.getProjectDataDir,
    createBridge: () => {
      const requestServer = new ModernMcpServer(getMcpServerInfo()) as ModernMcpBridge;
      for (const tool of listed.tools) {
        requestServer.registerTool(
          tool.name,
          {
            ...(tool.title ? { title: tool.title } : {}),
            ...(tool.description ? { description: tool.description } : {}),
            inputSchema: fromJsonSchema(tool.inputSchema as Record<string, unknown>),
          },
          async (args) => await callTool(tool.name, args as Record<string, unknown>) as never,
        );
      }
      requestServer.memorix = lifecycle;
      return requestServer;
    },
    close: async () => {
      if (closed) return;
      closed = true;
      await legacyClient.close().catch(() => undefined);
      await legacy.server.close().catch(() => undefined);
      legacy.handleTransportClose();
    },
  };
}

export async function createModernMcpBridge(
  options: ModernMcpBridgeOptions,
): Promise<ModernMcpBridge> {
  const runtime = await createModernMcpRuntime(options);
  const bridge = runtime.createBridge();
  const close = bridge.close.bind(bridge);
  let closed = false;
  bridge.close = async () => {
    if (closed) return;
    closed = true;
    await close();
    await runtime.close();
  };
  return bridge;
}
