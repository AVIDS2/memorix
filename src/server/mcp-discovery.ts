import type { ServerCapabilities } from '@modelcontextprotocol/sdk/types.js';

export const MCP_MODERN_PROTOCOL_VERSION = '2026-07-28';
export const MCP_LEGACY_PROTOCOL_VERSION = '2025-11-25';
export const MCP_OLDEST_LEGACY_PROTOCOL_VERSION = '2024-11-05';
export const MCP_SERVER_DISCOVER_METHOD = 'server/discover';
export const MCP_SERVER_INFO_META_KEY = 'io.modelcontextprotocol/serverInfo';

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

export function getMcpServerInfo(): McpServerInfo {
  return {
    name: 'memorix',
    version: typeof __MEMORIX_VERSION__ !== 'undefined' ? __MEMORIX_VERSION__ : '1.0.1',
  };
}

/** Build the deliberately partial modern-discovery result shared by all stdio paths. */
export function createMcpDiscoverResult(
  capabilities: ServerCapabilities,
  serverInfo: McpServerInfo,
): McpDiscoverResult {
  return {
    resultType: 'complete',
    supportedVersions: [
      MCP_LEGACY_PROTOCOL_VERSION,
      MCP_OLDEST_LEGACY_PROTOCOL_VERSION,
    ],
    capabilities,
    _meta: {
      [MCP_SERVER_INFO_META_KEY]: { ...serverInfo },
    },
    // v1 has no response-cache negotiation. A zero private TTL prevents clients
    // from inventing a shared cache for an implementation that cannot invalidate it.
    ttlMs: 0,
    cacheScope: 'private',
  };
}

/**
 * The startup gate can answer discovery before McpServer exists. These are the
 * only capabilities the production stdio profile advertises at that boundary.
 */
export function createMcpStartupDiscoverResult(serverInfo: McpServerInfo): McpDiscoverResult {
  return createMcpDiscoverResult({ tools: { listChanged: true } }, serverInfo);
}
