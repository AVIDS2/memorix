/**
 * Persistence Layer — Runtime + Migration
 *
 * Runtime responsibilities:
 *   - Data directory resolution (flat global ~/.memorix/data/)
 *   - Orama DB file path helpers
 *   - Legacy per-project subdirectory migration
 *
 * JSON I/O helpers have been moved to persistence-json.ts.
 * They are re-exported here for backward compatibility during the transition.
 *
 * SQLite is the sole canonical runtime store.
 * JSON/JSONL files are only used for migration, export/import, and debug.
 */
export { getGraphFilePath, saveGraphJsonl, loadGraphJsonl, saveObservationsJson, loadObservationsJson, saveIdCounter, loadIdCounter, saveMiniSkillsJson, loadMiniSkillsJson, loadMiniSkillsCounter, saveMiniSkillsCounter, saveSessionsJson, loadSessionsJson, } from './persistence-json.js';
/**
 * Get the data directory for Memorix storage.
 *
 * Returns the FLAT global directory (~/.memorix/data/) regardless of projectId.
 * projectId is stored as metadata inside observations, not used for directory partitioning.
 * This ensures all IDEs share the same data directory even if they detect different projectIds.
 *
 * @param _projectId - Ignored for directory purposes (kept for API compat)
 */
export declare function getProjectDataDir(_projectId: string, baseDir?: string): Promise<string>;
/**
 * Get the base data directory (parent of all project dirs).
 */
export declare function getBaseDataDir(baseDir?: string): string;
/**
 * List all project data directories.
 * Used for cross-project (global) search.
 */
export declare function listProjectDirs(baseDir?: string): Promise<string[]>;
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
export declare function migrateSubdirsToFlat(baseDir?: string): Promise<boolean>;
/**
 * Get the file path for the Orama database file.
 */
export declare function getDbFilePath(projectDir: string): string;
/**
 * Check if a database file exists for the given project.
 */
export declare function hasExistingData(projectDir: string): Promise<boolean>;
//# sourceMappingURL=persistence.d.ts.map