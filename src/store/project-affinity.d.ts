/**
 * Project Affinity Scoring
 *
 * Prevents cross-project memory pollution by scoring search results
 * based on how well they match the current project context.
 *
 * Inspired by mcp-memory-service's memory-scorer.js:
 * - High affinity: content mentions project name → full score
 * - Medium affinity: related concepts but no direct mention → 0.7x
 * - Low affinity: no project reference → 0.3x (heavily penalized)
 *
 * This runs AFTER projectId filtering, as a second layer of defense
 * against memories that were stored under the correct projectId but
 * contain content about a different project (e.g., discussing Memorix
 * development while in a test project workspace).
 */
export interface AffinityContext {
    /** Current project name (e.g., "for_memmcp_test", "memorix") */
    projectName: string;
    /** Current project ID (e.g., "local/for_memmcp_test", "AVIDS2/memorix") */
    projectId: string;
    /** Optional: keywords that indicate project relevance */
    projectKeywords?: string[];
}
export interface MemoryContent {
    title: string;
    narrative?: string;
    facts?: string[];
    concepts?: string[];
    entityName?: string;
    filesModified?: string[];
}
export interface AffinityResult {
    /** Affinity score 0-1 (1 = high affinity, 0 = no affinity) */
    score: number;
    /** Affinity level for debugging */
    level: 'high' | 'medium' | 'low' | 'none';
    /** Reason for the score */
    reason: string;
}
/**
 * Calculate project affinity score for a memory.
 *
 * @param memory - The memory content to evaluate
 * @param context - Current project context
 * @returns AffinityResult with score, level, and reason
 */
export declare function calculateProjectAffinity(memory: MemoryContent, context: AffinityContext): AffinityResult;
/**
 * Apply project affinity scoring to search results.
 *
 * @param results - Search results with scores
 * @param memories - Full memory content for each result (keyed by ID)
 * @param context - Current project context
 * @param options - Scoring options
 * @returns Results with adjusted scores, sorted by affinity-weighted score
 */
export declare function applyProjectAffinity<T extends {
    id: number;
    score: number;
}>(results: T[], memories: Map<number, MemoryContent>, context: AffinityContext, options?: {
    /** Minimum affinity score to include (default: 0, include all) */
    minAffinity?: number;
    /** Whether to filter out low-affinity results entirely (default: false) */
    filterLowAffinity?: boolean;
}): T[];
/**
 * Extract project keywords from project name and common patterns.
 * Used to improve affinity detection for projects with distinctive names.
 */
export declare function extractProjectKeywords(projectName: string, projectId: string): string[];
//# sourceMappingURL=project-affinity.d.ts.map