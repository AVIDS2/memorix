/**
 * LLM Quality Enhancements
 *
 * Premium memory quality features powered by LLM:
 * 1. Narrative Compression — compress verbose narratives into concise core knowledge
 * 2. Search Reranking — rerank search results by relevance to current task context
 *
 * Both features gracefully degrade: when LLM is not configured, they return
 * the original data unchanged.
 *
 * Performance targets:
 * - Compression: ~60% token reduction per stored memory
 * - Reranking: ~40% improvement in Top-5 precision
 */
/**
 * Compress a narrative to its essential core using LLM.
 *
 * Returns the original narrative if:
 * - LLM is not enabled
 * - Narrative is already short (≤80 chars)
 * - Narrative is already concise (commands, file paths, git operations)
 * - LLM call fails
 */
export declare function compressNarrative(narrative: string, facts?: string[], type?: string): Promise<{
    compressed: string;
    saved: number;
    usedLLM: boolean;
}>;
/** Minimal search result for reranking */
export interface RerankCandidate {
    id: string;
    title: string;
    type: string;
    score: number;
    narrative?: string;
}
/**
 * Rerank search results using LLM contextual understanding.
 *
 * Takes Orama's initial ranking and improves it by considering
 * semantic relevance to the current query/task context.
 *
 * Returns original order if LLM is not enabled or call fails.
 */
export declare function rerankResults(query: string, candidates: RerankCandidate[]): Promise<{
    reranked: RerankCandidate[];
    usedLLM: boolean;
}>;
//# sourceMappingURL=quality.d.ts.map