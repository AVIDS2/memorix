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
  switchProject: (newCwd: string, source?: ProjectBindingSource) => Promise<boolean>;
  isExplicitlyBound: () => boolean;
  handleTransportClose: () => void;
}

export type ModernMcpBridge = ModernMcpServer & {
  memorix: ModernMcpBridgeLifecycle;
};

/**
 * Build an official v2 server whose tools delegate to the existing Memorix
 * implementation. The v1 side is process-local and never becomes a second
 * network endpoint, so project isolation and business behavior stay shared.
 */
export async function createModernMcpBridge(
  options: ModernMcpBridgeOptions,
): Promise<ModernMcpBridge> {
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
  const modern = new ModernMcpServer(getMcpServerInfo());

  for (const tool of listed.tools) {
    modern.registerTool(
      tool.name,
      {
        ...(tool.title ? { title: tool.title } : {}),
        ...(tool.description ? { description: tool.description } : {}),
        inputSchema: fromJsonSchema(tool.inputSchema as Record<string, unknown>),
      },
      async (args) => await legacyClient.callTool({
        name: tool.name,
        arguments: args as Record<string, unknown>,
      }) as never,
    );
  }

  const bridge = modern as ModernMcpBridge;
  bridge.memorix = {
    projectId: legacy.projectId,
    deferredInit: legacy.deferredInit,
    switchProject: legacy.switchProject,
    isExplicitlyBound: legacy.isExplicitlyBound,
    handleTransportClose: legacy.handleTransportClose,
  };

  let closed = false;
  const modernClose = modern.close.bind(modern);
  modern.close = async () => {
    if (closed) return;
    closed = true;
    await modernClose();
    await legacyClient.close().catch(() => undefined);
    await legacy.server.close().catch(() => undefined);
    legacy.handleTransportClose();
  };

  return bridge;
}
