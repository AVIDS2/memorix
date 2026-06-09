/**
 * JSON Persistence Helpers — Migration / Export / Debug Only
 *
 * These functions read/write JSON/JSONL files for one-time migration
 * from legacy storage formats into SQLite, or for export/import and debug.
 *
 * NOT used as runtime canonical store — SQLite is the sole canonical backend.
 */
/**
 * Get the file path for the knowledge graph JSONL file.
 * (MCP-compatible format, same as official Memory Server)
 */
export declare function getGraphFilePath(projectDir: string): string;
/**
 * Save the knowledge graph in JSONL format (MCP-compatible).
 * Each line is a JSON object with type: "entity" or "relation".
 *
 * Format adopted from MCP Official Memory Server.
 */
export declare function saveGraphJsonl(projectDir: string, entities: Array<{
    name: string;
    entityType: string;
    observations: string[];
}>, relations: Array<{
    from: string;
    to: string;
    relationType: string;
}>): Promise<void>;
/**
 * Load the knowledge graph from JSONL format.
 */
export declare function loadGraphJsonl(projectDir: string): Promise<{
    entities: Array<{
        name: string;
        entityType: string;
        observations: string[];
    }>;
    relations: Array<{
        from: string;
        to: string;
        relationType: string;
    }>;
}>;
/**
 * Save observation data as JSON (for Orama restore / export).
 */
export declare function saveObservationsJson(projectDir: string, observations: unknown[]): Promise<void>;
/**
 * Load observation data from JSON.
 */
export declare function loadObservationsJson(projectDir: string): Promise<unknown[]>;
/**
 * Save the next observation ID counter (legacy JSON format).
 */
export declare function saveIdCounter(projectDir: string, nextId: number): Promise<void>;
/**
 * Load the next observation ID counter (legacy JSON format).
 * For runtime use, prefer the SQLite meta table via SqliteBackend.
 */
export declare function loadIdCounter(projectDir: string): Promise<number>;
/**
 * Save mini-skills data as JSON (migration source only).
 */
export declare function saveMiniSkillsJson(projectDir: string, skills: unknown[]): Promise<void>;
/**
 * Load mini-skills data from JSON (migration source only).
 */
export declare function loadMiniSkillsJson(projectDir: string): Promise<unknown[]>;
/**
 * Load the mini-skills ID counter (legacy JSON format).
 */
export declare function loadMiniSkillsCounter(projectDir: string): Promise<number>;
/**
 * Save the mini-skills ID counter (legacy JSON format).
 */
export declare function saveMiniSkillsCounter(projectDir: string, nextId: number): Promise<void>;
/**
 * Save sessions data as JSON (migration source only).
 */
export declare function saveSessionsJson(projectDir: string, sessions: unknown[]): Promise<void>;
/**
 * Load sessions data from JSON (migration source only).
 */
export declare function loadSessionsJson(projectDir: string): Promise<unknown[]>;
//# sourceMappingURL=persistence-json.d.ts.map