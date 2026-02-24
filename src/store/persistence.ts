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
import { atomicWriteFile } from './file-lock.js';

/** Default base data directory */
const DEFAULT_DATA_DIR = path.join(os.homedir(), '.memorix', 'data');

/**
 * Sanitize a projectId for use as a directory name.
 * Replaces `/` with `--`, removes other unsafe chars.
 */
function sanitizeProjectId(projectId: string): string {
  return projectId.replace(/\//g, '--').replace(/[<>:"|?*\\]/g, '_');
}

/**
 * Get the project-specific data directory for Memorix storage.
 * Each project gets its own subdirectory under ~/.memorix/data/
 *
 * Example: projectId "AVIDS2/memorix" → ~/.memorix/data/AVIDS2--memorix/
 *
 * @param projectId - Git-based project identifier (e.g. "user/repo")
 */
export async function getProjectDataDir(projectId: string, baseDir?: string): Promise<string> {
  // Reject sentinel IDs to prevent garbage directories
  if (projectId === '__invalid__') {
    throw new Error('Cannot create data directory for invalid project');
  }
  const base = baseDir ?? DEFAULT_DATA_DIR;
  const dirName = sanitizeProjectId(projectId);
  const dataDir = path.join(base, dirName);
  await fs.mkdir(dataDir, { recursive: true });
  return dataDir;
}

/**
 * Get the base data directory (parent of all project dirs).
 */
export function getBaseDataDir(baseDir?: string): string {
  return baseDir ?? DEFAULT_DATA_DIR;
}

/**
 * List all project data directories.
 * Used for cross-project (global) search.
 */
export async function listProjectDirs(baseDir?: string): Promise<string[]> {
  const base = baseDir ?? DEFAULT_DATA_DIR;
  try {
    const entries = await fs.readdir(base, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory())
      .map((e) => path.join(base, e.name));
  } catch {
    return [];
  }
}

/**
 * Migrate legacy global data to project-specific directory.
 * If observations.json exists directly in the base data dir (old format),
 * move it into the correct project subdirectory.
 */
export async function migrateGlobalData(projectId: string, baseDir?: string): Promise<boolean> {
  const base = baseDir ?? DEFAULT_DATA_DIR;
  const globalObsPath = path.join(base, 'observations.json');
  const migratedObsPath = path.join(base, 'observations.json.migrated');

  // Check if global data exists (either live or already-migrated backup)
  let sourceObsPath: string | null = null;
  try {
    await fs.access(globalObsPath);
    sourceObsPath = globalObsPath;
  } catch {
    // Check for .migrated backup that wasn't fully merged
    try {
      await fs.access(migratedObsPath);
      sourceObsPath = migratedObsPath;
    } catch {
      return false; // No global data to migrate
    }
  }

  // Read the source (global) observations
  let globalObs: unknown[] = [];
  try {
    const data = await fs.readFile(sourceObsPath, 'utf-8');
    globalObs = JSON.parse(data);
    if (!Array.isArray(globalObs) || globalObs.length === 0) return false;
  } catch {
    return false;
  }

  // Read existing project observations (may have been partially written)
  const projectDir = await getProjectDataDir(projectId, baseDir);
  const projectObsPath = path.join(projectDir, 'observations.json');
  let projectObs: unknown[] = [];
  try {
    const data = await fs.readFile(projectObsPath, 'utf-8');
    projectObs = JSON.parse(data);
    if (!Array.isArray(projectObs)) projectObs = [];
  } catch { /* no existing data */ }

  // If project already has >= global data, skip (already migrated properly)
  if (projectObs.length >= globalObs.length) {
    return false;
  }

  // Merge: global data + project data, deduplicate by ID
  const existingIds = new Set(projectObs.map((o: any) => o.id));
  const merged = [...projectObs];
  for (const obs of globalObs) {
    if (!existingIds.has((obs as any).id)) {
      merged.push(obs);
    }
  }

  // Sort by ID
  merged.sort((a: any, b: any) => (a.id ?? 0) - (b.id ?? 0));

  // Normalize projectId for all migrated records to the current project
  for (const obs of merged) {
    (obs as any).projectId = projectId;
  }

  // Write merged observations
  await fs.writeFile(projectObsPath, JSON.stringify(merged, null, 2), 'utf-8');

  // Copy graph and counter if they exist
  for (const file of ['graph.jsonl', 'counter.json']) {
    const src = path.join(base, file);
    const srcMigrated = path.join(base, file + '.migrated');
    const dst = path.join(projectDir, file);
    // Try live file first, then .migrated backup
    for (const source of [src, srcMigrated]) {
      try {
        await fs.access(source);
        await fs.copyFile(source, dst);
        break;
      } catch { /* try next */ }
    }
  }

  // Find max ID for counter
  const maxId = merged.reduce((max: number, o: any) => Math.max(max, o.id ?? 0), 0);
  await fs.writeFile(
    path.join(projectDir, 'counter.json'),
    JSON.stringify({ nextId: maxId + 1 }),
    'utf-8',
  );

  // Rename source files to .migrated (if not already)
  for (const file of ['observations.json', 'graph.jsonl', 'counter.json']) {
    const src = path.join(base, file);
    try {
      await fs.access(src);
      await fs.rename(src, src + '.migrated');
    } catch { /* already migrated or doesn't exist */ }
  }

  return true;
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
  await atomicWriteFile(getGraphFilePath(projectDir), lines.join('\n'));
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
      {
        entities: [] as Array<{ name: string; entityType: string; observations: string[] }>,
        relations: [] as Array<{ from: string; to: string; relationType: string }>
      },
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
  await atomicWriteFile(filePath, JSON.stringify(observations, null, 2));
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
  await atomicWriteFile(filePath, JSON.stringify({ nextId }));
}

/**
 * Append archived observations to the archive file.
 * Archived observations are moved here by the retention engine.
 */
export async function appendArchivedObservations(
  projectDir: string,
  observations: unknown[],
): Promise<void> {
  const filePath = path.join(projectDir, 'observations.archived.json');
  let existing: unknown[] = [];
  try {
    const data = await fs.readFile(filePath, 'utf-8');
    existing = JSON.parse(data);
    if (!Array.isArray(existing)) existing = [];
  } catch { /* no archive yet */ }
  existing.push(...observations);
  await atomicWriteFile(filePath, JSON.stringify(existing, null, 2));
}

/**
 * Load archived observations.
 */
export async function loadArchivedObservations(projectDir: string): Promise<unknown[]> {
  const filePath = path.join(projectDir, 'observations.archived.json');
  try {
    const data = await fs.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(data);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
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
