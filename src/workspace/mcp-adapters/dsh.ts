import { homedir } from 'node:os';
import { join } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { MCPConfigAdapter, MCPServerEntry } from '../../types.js';

/**
 * DeepSeek Harness (DSH) MCP Configuration Adapter.
 *
 * DSH composes its runtime from Cordis patch layers. External MCP servers are
 * registered as rows of the `@deepseek-ai/dsh-mcp-client` plugin inside a
 * patch list. The user-level layer that applies to every profile lives at:
 *
 *   $DSH_HOME/cordis.patch.yml   (default: ~/.dsh/cordis.patch.yml)
 *
 * Row shape follows DSH's own shipped Memorix reference
 * (examples/mcp-memory/memorix.cordis.yml in deepseek-ai/deepseek-harness):
 *
 *   - insert:
 *       - id: memory-memorix
 *         name: '@deepseek-ai/dsh-mcp-client'
 *         config:
 *           serverName: memorix
 *           transport: stdio
 *           command: memorix
 *           args: [serve]
 *
 * The `cwd` key is deliberately omitted so the MCP child inherits the DSH
 * process working directory — the workspace DSH was launched from — which is
 * what keeps Memorix bound to the current Git project.
 *
 * Source: https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/mcp/mcp-client
 */

const MCP_CLIENT_PLUGIN = '@deepseek-ai/dsh-mcp-client';
const MEMORIX_ROW_ID = 'memory-memorix';

function resolveDshHome(): string {
  const configured = process.env.DSH_HOME?.trim();
  if (configured) return configured;
  return join(homedir(), '.dsh');
}

function isMemorixRow(row: unknown): row is Record<string, unknown> {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return false;
  const record = row as Record<string, unknown>;
  if (record.name !== MCP_CLIENT_PLUGIN) return false;
  const config = record.config;
  return Boolean(
    config && typeof config === 'object' && !Array.isArray(config)
    && (config as Record<string, unknown>).serverName === 'memorix',
  );
}

function rowToEntry(row: Record<string, unknown>): MCPServerEntry | null {
  const config = row.config as Record<string, unknown>;
  if (!config || typeof config !== 'object') return null;
  const entry: MCPServerEntry = {
    name: 'memorix',
    command: typeof config.command === 'string' ? config.command : '',
    args: Array.isArray(config.args) ? config.args.filter((arg): arg is string => typeof arg === 'string') : [],
  };
  if (typeof config.url === 'string' && config.url) entry.url = config.url;
  if (config.env && typeof config.env === 'object' && !Array.isArray(config.env)) {
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(config.env as Record<string, unknown>)) {
      if (typeof value === 'string') env[key] = value;
    }
    if (Object.keys(env).length > 0) entry.env = env;
  }
  if (config.disabled === true) entry.disabled = true;
  return entry;
}

/** Flatten one parsed patch document into its row list, tolerating both
 *  `- insert: [...]` operations and bare row lists. */
function patchRows(document: unknown): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  if (!Array.isArray(document)) return rows;
  for (const item of document) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    if (Array.isArray(record.insert)) {
      for (const row of record.insert) {
        if (row && typeof row === 'object' && !Array.isArray(row)) {
          rows.push(row as Record<string, unknown>);
        }
      }
      continue;
    }
    rows.push(record);
  }
  return rows;
}

export class DshMCPAdapter implements MCPConfigAdapter {
  readonly source = 'dsh' as const;

  parse(content: string): MCPServerEntry[] {
    if (!content.trim()) return [];
    let document: unknown;
    try {
      document = parseYaml(content);
    } catch {
      return [];
    }
    return patchRows(document)
      .filter(isMemorixRow)
      .map(rowToEntry)
      .filter((entry): entry is MCPServerEntry => entry !== null);
  }

  generate(servers: MCPServerEntry[]): string {
    const rows = servers
      .filter((server) => server.name === 'memorix')
      .map((server) => {
        const config: Record<string, unknown> = {
          serverName: server.name,
        };
        if (server.url) {
          config.transport = 'streamable-http';
          config.url = server.url;
          if (server.headers && Object.keys(server.headers).length > 0) config.headers = server.headers;
        } else {
          config.transport = 'stdio';
          config.command = server.command;
          if (server.args && server.args.length > 0) config.args = server.args;
          if (server.env && Object.keys(server.env).length > 0) config.env = server.env;
        }
        const row: Record<string, unknown> = {
          id: MEMORIX_ROW_ID,
          name: MCP_CLIENT_PLUGIN,
          config,
        };
        if (server.disabled === true) row.disabled = true;
        return row;
      });

    if (rows.length === 0) return '';
    return stringifyYaml([{ insert: rows }], { lineWidth: 0 }) + '\n';
  }

  getConfigPath(_projectRoot?: string): string {
    return join(resolveDshHome(), 'cordis.patch.yml');
  }
}

export { MEMORIX_ROW_ID };
