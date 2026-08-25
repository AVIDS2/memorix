/**
 * Small MCP 2026-07-28 discovery adapter for the pinned v1 SDK.
 *
 * The v1 SDK can route an extension request through its low-level Server, but
 * it does not implement the modern discovery/cache negotiation itself. Keep
 * this adapter deliberately narrow: advertise discovery and the existing
 * legacy tool handlers, while leaving unsupported extensions unadvertised.
 */

import { RequestSchema, type ServerCapabilities } from '@modelcontextprotocol/sdk/types.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod/v4';

export const MCP_MODERN_PROTOCOL_VERSION = '2026-07-28';
export const MCP_LEGACY_PROTOCOL_VERSION = '2025-11-25';
export const MCP_OLDEST_LEGACY_PROTOCOL_VERSION = '2024-11-05';
export const MCP_SERVER_DISCOVER_METHOD = 'server/discover';
export const MCP_SERVER_INFO_META_KEY = 'io.modelcontextprotocol/serverInfo';

const ServerDiscoverRequestSchema = RequestSchema.extend({
  method: z.literal(MCP_SERVER_DISCOVER_METHOD),
  params: z.looseObject({}).optional(),
});

export interface McpServerInfo {
  name: string;
  version: string;
}

export interface McpDiscoverResult {
  resultType: 'complete';
  supportedVersions: string[];
  capabilities: ServerCapabilities;
  _meta: {
    [MCP_SERVER_INFO_META_KEY]: McpServerInfo;
  };
  ttlMs: number;
  cacheScope: 'public' | 'private';
}

const registeredServers = new WeakSet<McpServer>();

/** Build the wire result without exposing unsupported cache/task features. */
export function buildMcpDiscoverResult(server: McpServer, serverInfo: McpServerInfo): McpDiscoverResult {
  // SDK 1.30 exposes this method at runtime but marks it private in its
  // declaration file. The discovery response must reflect the capabilities
  // already registered on this exact low-level Server instance.
  const getCapabilities = (server.server as unknown as {
    getCapabilities: () => ServerCapabilities;
  }).getCapabilities.bind(server.server);
  return {
    resultType: 'complete',
    supportedVersions: [
      MCP_MODERN_PROTOCOL_VERSION,
      MCP_LEGACY_PROTOCOL_VERSION,
      MCP_OLDEST_LEGACY_PROTOCOL_VERSION,
    ],
    capabilities: getCapabilities(),
    _meta: {
      [MCP_SERVER_INFO_META_KEY]: { ...serverInfo },
    },
    // v1 has no response-cache negotiation. A zero private TTL is the
    // conservative result and prevents clients from inventing a shared cache.
    ttlMs: 0,
    cacheScope: 'private',
  };
}

/**
 * Register `server/discover` on the v1 low-level Server.
 *
 * This is idempotent for a single McpServer instance because HTTP/session
 * setup can revisit the registration boundary while reusing an object.
 */
export function registerMcpDiscovery(server: McpServer, serverInfo: McpServerInfo): void {
  if (registeredServers.has(server)) return;

  server.server.setRequestHandler(ServerDiscoverRequestSchema, async () => (
    buildMcpDiscoverResult(server, serverInfo)
  ));
  registeredServers.add(server);
}
