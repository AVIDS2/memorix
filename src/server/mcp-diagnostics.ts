/** MCP compatibility diagnostics shared by HTTP and CLI-facing checks. */

export const CURRENT_MCP_PROTOCOL_VERSION = '2026-07-28';
export const LEGACY_MCP_PROTOCOL_VERSION = '2025-11-25';
export const OLDEST_LEGACY_MCP_PROTOCOL_VERSION = '2024-11-05';
export const MCP_SERVER_NAME = 'io.github.AVIDS2/memorix';

export interface McpDiagnostics {
  serverName: string;
  protocol: {
    current: string;
    legacy: string;
    discovery: 'supported';
    versionlessRequests: 'legacy-compatible';
    modernResultMetadata: 'supported';
    statelessRequests: 'supported' | 'compatibility-only' | 'unsupported';
    statefulStreamableHttp: 'supported';
  };
  capabilities: {
    tasks: 'supported' | 'unsupported';
    polling: 'supported' | 'unsupported';
    subscriptions: 'supported' | 'unsupported';
    listCache: 'supported' | 'protocol-hints-only' | 'unsupported';
    explicitProjectHandle: 'supported';
  };
}

/** Do not present a fake durable task loop or a cache that does not exist. */
export function getMcpDiagnostics(): McpDiagnostics {
  return {
    serverName: MCP_SERVER_NAME,
    protocol: {
      current: CURRENT_MCP_PROTOCOL_VERSION,
      legacy: LEGACY_MCP_PROTOCOL_VERSION,
      discovery: 'supported',
      versionlessRequests: 'legacy-compatible',
      modernResultMetadata: 'supported',
      statelessRequests: 'supported',
      statefulStreamableHttp: 'supported',
    },
    capabilities: {
      tasks: 'unsupported',
      polling: 'unsupported',
      subscriptions: 'supported',
      // The protocol envelope is emitted, but TTL is intentionally zero until
      // Memorix can invalidate a durable per-project list cache correctly.
      listCache: 'protocol-hints-only',
      explicitProjectHandle: 'supported',
    },
  };
}
