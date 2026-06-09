/**
 * Entity Extractor
 *
 * Regex-based entity extraction from observation content.
 * Inspired by MemCP's RegexEntityExtractor (MAGMA paper).
 *
 * Extracts: file paths, module paths, URLs, @mentions, CamelCase identifiers.
 * Also detects causal patterns for automatic edge typing.
 */
export interface ExtractedEntities {
    files: string[];
    modules: string[];
    urls: string[];
    mentions: string[];
    identifiers: string[];
    hasCausalLanguage: boolean;
}
/**
 * Extract entities from text content.
 * Returns deduplicated lists of each entity type.
 */
export declare function extractEntities(content: string): ExtractedEntities;
/**
 * Auto-generate concepts from extracted entities.
 * Merges with any user-provided concepts.
 */
export declare function enrichConcepts(userConcepts: string[], extracted: ExtractedEntities): string[];
//# sourceMappingURL=entity-extractor.d.ts.map