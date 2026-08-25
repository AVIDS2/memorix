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
    modernResultMetadata: 'discovery-only';
    statelessRequests: 'supported' | 'compatibility-only' | 'unsupported';
    statefulStreamableHttp: 'supported';
  };
  capabilities: {
    tasks: 'supported' | 'unsupported';
    polling: 'supported' | 'unsupported';
    subscriptions: 'supported' | 'unsupported';
    listCache: 'supported' | 'unsupported';
    explicitProjectHandle: 'supported';
  };
}

/** The pinned SDK is stateful; do not present a fake durable task loop. */
export function getMcpDiagnostics(): McpDiagnostics {
  return {
    serverName: MCP_SERVER_NAME,
    protocol: {
      current: CURRENT_MCP_PROTOCOL_VERSION,
      legacy: LEGACY_MCP_PROTOCOL_VERSION,
      discovery: 'supported',
      versionlessRequests: 'legacy-compatible',
      modernResultMetadata: 'discovery-only',
      statelessRequests: 'compatibility-only',
      statefulStreamableHttp: 'supported',
    },
    capabilities: {
      tasks: 'unsupported',
      polling: 'unsupported',
      subscriptions: 'unsupported',
      listCache: 'unsupported',
      explicitProjectHandle: 'supported',
    },
  };
}
