/**
 * Persistence Layer
 *
 * Saves and restores the Orama database to/from disk.
 * Source: @orama/plugin-data-persistence (official Orama plugin)
 *
 * Data is stored in a single FLAT global directory shared across ALL agents and projects:
 *   ~/.memorix/data/ (observations.json, graph.jsonl, counter.json, sessions.json)
 *
 * projectId is metadata only — stored inside each observation record,
 * NOT used for directory partitioning. This ensures cross-IDE relay works
 * even when different IDEs detect different projectIds for the same repo.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { atomicWriteFile } from './file-lock.js';

/** Default base data directory */
const DEFAULT_DATA_DIR = path.join(os.homedir(), '.memorix', 'data');

/**
 * Sanitize a projectId for use as a directory name.
 * Used only during migration to locate legacy per-project subdirectories.
 */
function sanitizeProjectId(projectId: string): string {
  return projectId.replace(/\//g, '--').replace(/[<>:"|?*\\]/g, '_');
}

/**
 * Get the data directory for Memorix storage.
 *
 * Returns the FLAT global directory (~/.memorix/data/) regardless of projectId.
 * projectId is stored as metadata inside observations, not used for directory partitioning.
 * This ensures all IDEs share the same data directory even if they detect different projectIds.
 *
 * @param _projectId - Ignored for directory purposes (kept for API compat)
 */
export async function getProjectDataDir(_projectId: string, baseDir?: string): Promise<string> {
  // Reject sentinel IDs to prevent garbage writes
  if (_projectId === '__invalid__') {
    throw new Error('Cannot create data directory for invalid project');
  }
  const base = baseDir ?? DEFAULT_DATA_DIR;
  await fs.mkdir(base, { recursive: true });
  return base;
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
 * Migrate legacy per-project subdirectories into the flat base directory.
 *
 * Before v0.9.6, data was stored in per-project subdirectories:
 *   ~/.memorix/data/AVIDS2--memorix/observations.json
 *   ~/.memorix/data/local--myproject/observations.json
 *
 * This caused data fragmentation when different IDEs detected different projectIds.
 * Now all data lives in ~/.memorix/data/ directly.
 *
 * Migration:
 *   1. Scan all subdirectories under base dir
 *   2. Merge observations from all subdirs into base dir (remap IDs to avoid collision)
 *   3. Merge graph.jsonl (deduplicate entities by name)
 *   4. Move subdirectories to .migrated-subdirs/ backup
 */
export async function migrateSubdirsToFlat(baseDir?: string): Promise<boolean> {
  const base = baseDir ?? DEFAULT_DATA_DIR;
  await fs.mkdir(base, { recursive: true });

  // Find all subdirectories that contain observations.json
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(base, { withFileTypes: true });
  } catch {
    return false;
  }

  const dataDirs = entries
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => path.join(base, e.name));

  if (dataDirs.length === 0) return false;

  // Check which subdirs actually have observation data
  const subdirData: Array<{ dir: string; obs: any[]; graph: { entities: any[]; relations: any[] } }> = [];
  for (const dir of dataDirs) {
    const obsPath = path.join(dir, 'observations.json');
    try {
      const data = await fs.readFile(obsPath, 'utf-8');
      const obs = JSON.parse(data);
      if (Array.isArray(obs) && obs.length > 0) {
        // Also try to load graph
        let graph = { entities: [] as any[], relations: [] as any[] };
        try {
          const graphData = await fs.readFile(path.join(dir, 'graph.jsonl'), 'utf-8');
          const lines = graphData.split('\n').filter((l: string) => l.trim());
          for (const line of lines) {
            const item = JSON.parse(line);
            if (item.type === 'entity') graph.entities.push(item);
            if (item.type === 'relation') graph.relations.push(item);
          }
        } catch { /* no graph */ }
        subdirData.push({ dir, obs, graph });
      }
    } catch { /* no observations */ }
  }

  if (subdirData.length === 0) return false;

  // Load existing base-level data (if any)
  let baseObs: any[] = [];
  try {
    const data = await fs.readFile(path.join(base, 'observations.json'), 'utf-8');
    baseObs = JSON.parse(data);
    if (!Array.isArray(baseObs)) baseObs = [];
  } catch { /* no existing base data */ }

  let baseGraph = { entities: [] as any[], relations: [] as any[] };
  try {
    const graphData = await fs.readFile(path.join(base, 'graph.jsonl'), 'utf-8');
    const lines = graphData.split('\n').filter((l: string) => l.trim());
    for (const line of lines) {
      const item = JSON.parse(line);
      if (item.type === 'entity') baseGraph.entities.push(item);
      if (item.type === 'relation') baseGraph.relations.push(item);
    }
  } catch { /* no graph */ }

  // Merge all observations: collect, sort by createdAt, remap IDs
  const allObs: any[] = [...baseObs];
  for (const { obs } of subdirData) {
    for (const o of obs) {
      // Deduplicate by title+createdAt+projectId (same observation from migration overlap)
      const isDuplicate = allObs.some(
        (existing) => existing.title === o.title && existing.createdAt === o.createdAt,
      );
      if (!isDuplicate) {
        allObs.push(o);
      }
    }
  }

  // Sort by createdAt then remap IDs sequentially
  allObs.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
  for (let i = 0; i < allObs.length; i++) {
    allObs[i].id = i + 1;
  }

  // Merge graphs (deduplicate entities by name)
  const entityMap = new Map<string, any>();
  for (const e of baseGraph.entities) entityMap.set(e.name, e);
  for (const { graph } of subdirData) {
    for (const e of graph.entities) {
      if (!entityMap.has(e.name)) {
        entityMap.set(e.name, e);
      } else {
        // Merge observations lists
        const existing = entityMap.get(e.name);
        const obsSet = new Set([...(existing.observations || []), ...(e.observations || [])]);
        existing.observations = [...obsSet];
      }
    }
  }

  const relationSet = new Set<string>();
  const mergedRelations: any[] = [];
  for (const rel of [...baseGraph.relations, ...subdirData.flatMap((d) => d.graph.relations)]) {
    const key = `${rel.from}|${rel.to}|${rel.relationType}`;
    if (!relationSet.has(key)) {
      relationSet.add(key);
      mergedRelations.push(rel);
    }
  }

  // Write merged data to base directory
  await fs.writeFile(path.join(base, 'observations.json'), JSON.stringify(allObs, null, 2), 'utf-8');
  await fs.writeFile(
    path.join(base, 'counter.json'),
    JSON.stringify({ nextId: allObs.length + 1 }),
    'utf-8',
  );

  // Write merged graph
  const graphLines = [
    ...[...entityMap.values()].map((e) => JSON.stringify({ type: 'entity', name: e.name, entityType: e.entityType, observations: e.observations })),
    ...mergedRelations.map((r) => JSON.stringify({ type: 'relation', from: r.from, to: r.to, relationType: r.relationType })),
  ];
  if (graphLines.length > 0) {
    await fs.writeFile(path.join(base, 'graph.jsonl'), graphLines.join('\n'), 'utf-8');
  }

  // Also merge sessions if present
  let allSessions: any[] = [];
  try {
    const data = await fs.readFile(path.join(base, 'sessions.json'), 'utf-8');
    allSessions = JSON.parse(data);
    if (!Array.isArray(allSessions)) allSessions = [];
  } catch { /* no sessions */ }
  for (const { dir } of subdirData) {
    try {
      const data = await fs.readFile(path.join(dir, 'sessions.json'), 'utf-8');
      const sessions = JSON.parse(data);
      if (Array.isArray(sessions)) allSessions.push(...sessions);
    } catch { /* no sessions */ }
  }
  if (allSessions.length > 0) {
    await fs.writeFile(path.join(base, 'sessions.json'), JSON.stringify(allSessions, null, 2), 'utf-8');
  }

  // Move subdirectories to backup
  const backupDir = path.join(base, '.migrated-subdirs');
  await fs.mkdir(backupDir, { recursive: true });
  for (const { dir } of subdirData) {
    const dirName = path.basename(dir);
    try {
      await fs.rename(dir, path.join(backupDir, dirName));
    } catch {
      // If rename fails (cross-device), try to just leave it
      // The important thing is the merged data is written
    }
  }

  // Also move remaining empty subdirectories
  for (const dir of dataDirs) {
    const dirName = path.basename(dir);
    try {
      await fs.access(dir);
      await fs.rename(dir, path.join(backupDir, dirName));
    } catch { /* already moved or doesn't exist */ }
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

/**
 * Save sessions data as JSON.
 */
export async function saveSessionsJson(
  projectDir: string,
  sessions: unknown[],
): Promise<void> {
  const filePath = path.join(projectDir, 'sessions.json');
  await atomicWriteFile(filePath, JSON.stringify(sessions, null, 2));
}

/**
 * Load sessions data from JSON.
 */
export async function loadSessionsJson(projectDir: string): Promise<unknown[]> {
  const filePath = path.join(projectDir, 'sessions.json');
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
