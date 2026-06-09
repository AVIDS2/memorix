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
import type { ProjectInfo } from '../types.js';
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
export declare function registerAlias(projectInfo: ProjectInfo, baseDir?: string): Promise<string>;
/**
 * Resolve all known aliases for a project ID.
 *
 * Used in search to expand the projectId filter so that observations stored
 * under any alias are found regardless of which IDE stored them.
 *
 * @returns Array of all known IDs for the same project, or [projectId] if no aliases found.
 */
export declare function resolveAliases(projectId: string, baseDir?: string): Promise<string[]>;
/**
 * Get the canonical ID for a project ID.
 *
 * @returns The canonical ID, or the input ID if no alias group found.
 */
export declare function getCanonicalId(projectId: string, baseDir?: string): Promise<string>;
/**
 * Get all alias groups (for dashboard/debug).
 */
export declare function getAllAliasGroups(baseDir?: string): Promise<AliasGroup[]>;
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
export declare function autoMergeByBaseName(observedIds: string[], baseDir?: string): Promise<number>;
/**
 * Initialize the alias registry with a data directory.
 * Should be called once during server startup.
 */
export declare function initAliasRegistry(dataDir: string): void;
/**
 * Reset the in-memory cache (for testing).
 */
export declare function resetAliasCache(): void;
//# sourceMappingURL=aliases.d.ts.map