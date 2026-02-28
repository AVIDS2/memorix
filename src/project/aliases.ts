/**
 * Project Alias Registry
 *
 * Solves the "project identity split" problem: the same project gets different
 * projectIds depending on which IDE detects it (git remote vs local path vs placeholder).
 *
 * Maintains a registry file (~/.memorix/data/.project-aliases.json) that groups
 * all known IDs for the same physical project under one canonical ID.
 *
 * Canonical ID priority: git remote > local > placeholder
 *
 * Matching heuristics (any match → same project):
 *   1. Same normalized rootPath
 *   2. Same git remote URL
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { ProjectInfo } from '../types.js';

const DEFAULT_DATA_DIR = path.join(os.homedir(), '.memorix', 'data');
const ALIAS_FILE = '.project-aliases.json';

/** A group of project IDs that all refer to the same physical project */
export interface AliasGroup {
  /** The best-known ID for this project (git remote > local > placeholder) */
  canonical: string;
  /** All known IDs including canonical */
  aliases: string[];
  /** All known root paths (normalized) for this project */
  rootPaths: string[];
  /** Git remote URL if known */
  gitRemote?: string;
}

interface AliasRegistry {
  version: 1;
  groups: AliasGroup[];
}

/** In-memory cache of the registry */
let registryCache: AliasRegistry | null = null;
let registryDir: string | null = null;

/**
 * Normalize a root path for comparison.
 * - Forward slashes
 * - Lowercase on Windows
 * - No trailing slash
 */
function normalizePath(p: string): string {
  let normalized = p.replace(/\\/g, '/').replace(/\/+$/, '');
  if (process.platform === 'win32') {
    normalized = normalized.toLowerCase();
  }
  return normalized;
}

/**
 * Determine the priority of a project ID prefix.
 * Higher = better canonical candidate.
 */
function idPriority(id: string): number {
  if (id.startsWith('placeholder/')) return 0;
  if (id.startsWith('local/')) return 1;
  // Git remote-based IDs (e.g., "user/repo") have no prefix → highest priority
  return 2;
}

/**
 * Get the alias registry file path.
 */
function getRegistryPath(baseDir?: string): string {
  return path.join(baseDir ?? registryDir ?? DEFAULT_DATA_DIR, ALIAS_FILE);
}

/**
 * Load the alias registry from disk.
 */
async function loadRegistry(baseDir?: string): Promise<AliasRegistry> {
  if (registryCache) return registryCache;
  try {
    const data = await fs.readFile(getRegistryPath(baseDir), 'utf-8');
    const parsed = JSON.parse(data);
    if (parsed.version === 1 && Array.isArray(parsed.groups)) {
      registryCache = parsed;
      return registryCache!;
    }
  } catch { /* file doesn't exist yet */ }
  registryCache = { version: 1, groups: [] };
  return registryCache;
}

/**
 * Save the alias registry to disk.
 */
async function saveRegistry(baseDir?: string): Promise<void> {
  if (!registryCache) return;
  const filePath = getRegistryPath(baseDir);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(registryCache, null, 2), 'utf-8');
}

/**
 * Find an existing alias group that matches the given project info.
 *
 * Match criteria (any one is sufficient):
 *   1. Group already contains this exact ID
 *   2. Group has a matching normalized rootPath
 *   3. Group has a matching gitRemote
 */
function findMatchingGroup(
  registry: AliasRegistry,
  projectInfo: ProjectInfo,
): AliasGroup | null {
  const normalizedRoot = normalizePath(projectInfo.rootPath);

  for (const group of registry.groups) {
    // Match by ID
    if (group.aliases.includes(projectInfo.id)) return group;

    // Match by rootPath
    if (group.rootPaths.some((rp) => rp === normalizedRoot)) return group;

    // Match by git remote
    if (projectInfo.gitRemote && group.gitRemote && group.gitRemote === projectInfo.gitRemote) {
      return group;
    }
  }

  return null;
}

/**
 * Select the best canonical ID from a list of aliases.
 * Priority: git remote-based > local > placeholder
 */
function selectCanonical(aliases: string[]): string {
  return [...aliases].sort((a, b) => idPriority(b) - idPriority(a))[0];
}

/**
 * Register a detected project in the alias registry.
 *
 * If the project matches an existing group, merges the new ID/rootPath into it.
 * If not, creates a new group.
 *
 * Returns the **canonical** project ID that should be used for storage and search.
 *
 * @param projectInfo - The detected project info from detectProject()
 * @param baseDir - Override data directory (for testing)
 * @returns The canonical project ID
 */
export async function registerAlias(projectInfo: ProjectInfo, baseDir?: string): Promise<string> {
  const registry = await loadRegistry(baseDir);
  const normalizedRoot = normalizePath(projectInfo.rootPath);

  const existingGroup = findMatchingGroup(registry, projectInfo);

  if (existingGroup) {
    // Merge into existing group
    let changed = false;

    if (!existingGroup.aliases.includes(projectInfo.id)) {
      existingGroup.aliases.push(projectInfo.id);
      changed = true;
    }

    if (!existingGroup.rootPaths.includes(normalizedRoot)) {
      existingGroup.rootPaths.push(normalizedRoot);
      changed = true;
    }

    if (projectInfo.gitRemote && !existingGroup.gitRemote) {
      existingGroup.gitRemote = projectInfo.gitRemote;
      changed = true;
    }

    // Re-evaluate canonical (maybe we just learned a git remote ID)
    const newCanonical = selectCanonical(existingGroup.aliases);
    if (newCanonical !== existingGroup.canonical) {
      existingGroup.canonical = newCanonical;
      changed = true;
    }

    if (changed) {
      await saveRegistry(baseDir);
    }

    return existingGroup.canonical;
  }

  // Create new group
  const newGroup: AliasGroup = {
    canonical: projectInfo.id,
    aliases: [projectInfo.id],
    rootPaths: [normalizedRoot],
    ...(projectInfo.gitRemote ? { gitRemote: projectInfo.gitRemote } : {}),
  };
  registry.groups.push(newGroup);
  await saveRegistry(baseDir);

  return newGroup.canonical;
}

/**
 * Resolve all known aliases for a project ID.
 *
 * Used in search to expand the projectId filter so that observations stored
 * under any alias are found regardless of which IDE stored them.
 *
 * @returns Array of all known IDs for the same project, or [projectId] if no aliases found.
 */
export async function resolveAliases(projectId: string, baseDir?: string): Promise<string[]> {
  const registry = await loadRegistry(baseDir);

  for (const group of registry.groups) {
    if (group.aliases.includes(projectId) || group.canonical === projectId) {
      return [...group.aliases];
    }
  }

  return [projectId];
}

/**
 * Get the canonical ID for a project ID.
 *
 * @returns The canonical ID, or the input ID if no alias group found.
 */
export async function getCanonicalId(projectId: string, baseDir?: string): Promise<string> {
  const registry = await loadRegistry(baseDir);

  for (const group of registry.groups) {
    if (group.aliases.includes(projectId) || group.canonical === projectId) {
      return group.canonical;
    }
  }

  return projectId;
}

/**
 * Get all alias groups (for dashboard/debug).
 */
export async function getAllAliasGroups(baseDir?: string): Promise<AliasGroup[]> {
  const registry = await loadRegistry(baseDir);
  return registry.groups;
}

/**
 * Auto-merge obvious alias groups by scanning existing observation projectIds.
 *
 * Detects project IDs that share the same base name but have different prefixes:
 *   - placeholder/foo + local/foo → merge under the higher-priority one
 *   - AVIDS2/test-repo + local/test-repo → merge under AVIDS2/test-repo
 *
 * Called once during server startup after observations are loaded.
 *
 * @param observedIds - All unique projectIds found in observations data
 * @returns Number of new merges performed
 */
export async function autoMergeByBaseName(
  observedIds: string[],
  baseDir?: string,
): Promise<number> {
  if (observedIds.length <= 1) return 0;

  const registry = await loadRegistry(baseDir);

  // Group observed IDs by their base name (the part after the last /)
  const byBaseName = new Map<string, string[]>();
  for (const id of observedIds) {
    const baseName = id.split('/').pop() ?? id;
    if (!byBaseName.has(baseName)) byBaseName.set(baseName, []);
    byBaseName.get(baseName)!.push(id);
  }

  let mergeCount = 0;

  for (const [_baseName, ids] of byBaseName) {
    if (ids.length <= 1) continue;

    // Check if these IDs are already in the same alias group
    const existingGroups = new Set<number>();
    const ungroupedIds: string[] = [];

    for (const id of ids) {
      const groupIdx = registry.groups.findIndex(
        g => g.aliases.includes(id) || g.canonical === id,
      );
      if (groupIdx >= 0) {
        existingGroups.add(groupIdx);
      } else {
        ungroupedIds.push(id);
      }
    }

    // If all IDs are already in the same group, skip
    if (existingGroups.size <= 1 && ungroupedIds.length === 0) continue;

    // Merge: pick the best canonical from all IDs
    const allIdsInGroup = [...ids];
    const canonical = selectCanonical(allIdsInGroup);

    if (existingGroups.size > 0) {
      // Merge into the first existing group
      const primaryIdx = [...existingGroups][0];
      const primaryGroup = registry.groups[primaryIdx];

      // Add all IDs to primary group
      for (const id of allIdsInGroup) {
        if (!primaryGroup.aliases.includes(id)) {
          primaryGroup.aliases.push(id);
        }
      }

      // Absorb other existing groups into primary
      const otherIdxs = [...existingGroups].slice(1).sort((a, b) => b - a);
      for (const idx of otherIdxs) {
        const other = registry.groups[idx];
        for (const alias of other.aliases) {
          if (!primaryGroup.aliases.includes(alias)) {
            primaryGroup.aliases.push(alias);
          }
        }
        for (const rp of other.rootPaths) {
          if (!primaryGroup.rootPaths.includes(rp)) {
            primaryGroup.rootPaths.push(rp);
          }
        }
        if (other.gitRemote && !primaryGroup.gitRemote) {
          primaryGroup.gitRemote = other.gitRemote;
        }
        registry.groups.splice(idx, 1);
      }

      // Re-evaluate canonical
      primaryGroup.canonical = selectCanonical(primaryGroup.aliases);
      mergeCount++;
    } else {
      // All ungrouped — create new group
      registry.groups.push({
        canonical,
        aliases: allIdsInGroup,
        rootPaths: [],
      });
      mergeCount++;
    }
  }

  if (mergeCount > 0) {
    await saveRegistry(baseDir);
  }

  return mergeCount;
}

/**
 * Initialize the alias registry with a data directory.
 * Should be called once during server startup.
 */
export function initAliasRegistry(dataDir: string): void {
  registryDir = dataDir;
  registryCache = null; // Force reload from new location
}

/**
 * Reset the in-memory cache (for testing).
 */
export function resetAliasCache(): void {
  registryCache = null;
}
