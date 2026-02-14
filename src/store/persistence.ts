/**
 * Persistence Layer
 *
 * Saves and restores the Orama database to/from disk.
 * Source: @orama/plugin-data-persistence (official Orama plugin)
 *
 * Data is stored in a single global directory shared across all agents:
 *   ~/.memorix/data/ (all files: observations.json, graph.jsonl, counter.json)
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/** Default base data directory — single global store shared across all agents */
const DEFAULT_DATA_DIR = path.join(os.homedir(), '.memorix', 'data');

/**
 * Get the global data directory for Memorix storage.
 * All agents share the same directory — projectId is stored as metadata only.
 * This follows the mcp-memory-service pattern for reliable cross-agent sharing.
 *
 * @param projectId - kept for API compat, ignored for directory resolution
 */
export async function getProjectDataDir(projectId: string, baseDir?: string): Promise<string> {
  const dataDir = baseDir ?? DEFAULT_DATA_DIR;
  await fs.mkdir(dataDir, { recursive: true });
  return dataDir;
}

/**
 * Get the file path for the Orama database file.
 */
export function getDbFilePath(projectDir: string): string {
  return path.join(projectDir, 'memorix.msp');
}

/**
 * Get the file path for the knowledge graph JSONL file.
 * (MCP-compatible format, same as official Memory Server)
 */
export function getGraphFilePath(projectDir: string): string {
  return path.join(projectDir, 'graph.jsonl');
}

/**
 * Check if a database file exists for the given project.
 */
export async function hasExistingData(projectDir: string): Promise<boolean> {
  try {
    await fs.access(getDbFilePath(projectDir));
    return true;
  } catch {
    return false;
  }
}

/**
 * Save the knowledge graph in JSONL format (MCP-compatible).
 * Each line is a JSON object with type: "entity" or "relation".
 *
 * Format adopted from MCP Official Memory Server.
 */
export async function saveGraphJsonl(
  projectDir: string,
  entities: Array<{ name: string; entityType: string; observations: string[] }>,
  relations: Array<{ from: string; to: string; relationType: string }>,
): Promise<void> {
  const lines = [
    ...entities.map((e) =>
      JSON.stringify({ type: 'entity', name: e.name, entityType: e.entityType, observations: e.observations }),
    ),
    ...relations.map((r) =>
      JSON.stringify({ type: 'relation', from: r.from, to: r.to, relationType: r.relationType }),
    ),
  ];
  await fs.writeFile(getGraphFilePath(projectDir), lines.join('\n'), 'utf-8');
}

/**
 * Load the knowledge graph from JSONL format.
 */
export async function loadGraphJsonl(
  projectDir: string,
): Promise<{
  entities: Array<{ name: string; entityType: string; observations: string[] }>;
  relations: Array<{ from: string; to: string; relationType: string }>;
}> {
  const filePath = getGraphFilePath(projectDir);
  try {
    const data = await fs.readFile(filePath, 'utf-8');
    const lines = data.split('\n').filter((line) => line.trim() !== '');
    return lines.reduce(
      (graph, line) => {
        const item = JSON.parse(line);
        if (item.type === 'entity') {
          graph.entities.push({
            name: item.name,
            entityType: item.entityType,
            observations: item.observations,
          });
        }
        if (item.type === 'relation') {
          graph.relations.push({
            from: item.from,
            to: item.to,
            relationType: item.relationType,
          });
        }
        return graph;
      },
      { entities: [] as Array<{ name: string; entityType: string; observations: string[] }>,
        relations: [] as Array<{ from: string; to: string; relationType: string }> },
    );
  } catch (error) {
    if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { entities: [], relations: [] };
    }
    throw error;
  }
}

/**
 * Save observation data as JSON (for Orama restore).
 */
export async function saveObservationsJson(
  projectDir: string,
  observations: unknown[],
): Promise<void> {
  const filePath = path.join(projectDir, 'observations.json');
  await fs.writeFile(filePath, JSON.stringify(observations, null, 2), 'utf-8');
}

/**
 * Load observation data from JSON.
 */
export async function loadObservationsJson(projectDir: string): Promise<unknown[]> {
  const filePath = path.join(projectDir, 'observations.json');
  try {
    const data = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

/**
 * Save the next observation ID counter.
 */
export async function saveIdCounter(projectDir: string, nextId: number): Promise<void> {
  const filePath = path.join(projectDir, 'counter.json');
  await fs.writeFile(filePath, JSON.stringify({ nextId }), 'utf-8');
}

/**
 * Load the next observation ID counter.
 */
export async function loadIdCounter(projectDir: string): Promise<number> {
  const filePath = path.join(projectDir, 'counter.json');
  try {
    const data = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(data).nextId ?? 1;
  } catch {
    return 1;
  }
}
