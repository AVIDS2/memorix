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

import {
  createMcpDiscoverResult,
  MCP_SERVER_DISCOVER_METHOD,
  type McpDiscoverResult,
  type McpServerInfo,
} from './mcp-discovery.js';

export {
  createMcpDiscoverResult,
  getMcpServerInfo,
  MCP_LEGACY_PROTOCOL_VERSION,
  MCP_MODERN_PROTOCOL_VERSION,
  MCP_OLDEST_LEGACY_PROTOCOL_VERSION,
  MCP_SERVER_DISCOVER_METHOD,
  MCP_SERVER_INFO_META_KEY,
} from './mcp-discovery.js';
export type { McpDiscoverResult, McpServerInfo } from './mcp-discovery.js';

const ServerDiscoverRequestSchema = RequestSchema.extend({
  method: z.literal(MCP_SERVER_DISCOVER_METHOD),
  params: z.looseObject({}).optional(),
});

const registeredServers = new WeakSet<McpServer>();

/** Build the wire result without exposing unsupported cache/task features. */
export function buildMcpDiscoverResult(server: McpServer, serverInfo: McpServerInfo): McpDiscoverResult {
  // SDK 1.30 exposes this method at runtime but marks it private in its
  // declaration file. The discovery response must reflect the capabilities
  // already registered on this exact low-level Server instance.
  const getCapabilities = (server.server as unknown as {
    getCapabilities: () => ServerCapabilities;
  }).getCapabilities.bind(server.server);
  return createMcpDiscoverResult(getCapabilities(), serverInfo);
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
