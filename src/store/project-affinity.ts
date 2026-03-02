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
export function calculateProjectAffinity(
  memory: MemoryContent,
  context: AffinityContext,
): AffinityResult {
  const projectName = context.projectName.toLowerCase();
  const projectId = context.projectId.toLowerCase();
  
  // Extract base name from projectId (e.g., "memorix" from "AVIDS2/memorix")
  const projectBaseName = projectId.split('/').pop() ?? projectName;
  
  // Build searchable content string
  const contentParts = [
    memory.title,
    memory.narrative ?? '',
    memory.entityName ?? '',
    ...(memory.facts ?? []),
    ...(memory.concepts ?? []),
    ...(memory.filesModified ?? []),
  ];
  const content = contentParts.join(' ').toLowerCase();
  
  // Check for direct project name mention
  if (content.includes(projectName) || content.includes(projectBaseName)) {
    return { score: 1.0, level: 'high', reason: 'project_name_in_content' };
  }
  
  // Check for project keywords (if provided)
  if (context.projectKeywords && context.projectKeywords.length > 0) {
    const keywordsLower = context.projectKeywords.map(k => k.toLowerCase());
    const matchedKeywords = keywordsLower.filter(k => content.includes(k));
    if (matchedKeywords.length >= 2) {
      return { score: 0.9, level: 'high', reason: `keywords_matched: ${matchedKeywords.join(', ')}` };
    }
    if (matchedKeywords.length === 1) {
      return { score: 0.7, level: 'medium', reason: `keyword_matched: ${matchedKeywords[0]}` };
    }
  }
  
  // Check for file paths that suggest project relevance
  const files = memory.filesModified ?? [];
  if (files.some(f => f.toLowerCase().includes(projectName) || f.toLowerCase().includes(projectBaseName))) {
    return { score: 0.85, level: 'high', reason: 'project_in_file_path' };
  }
  
  // Check entity name
  if (memory.entityName) {
    const entityLower = memory.entityName.toLowerCase();
    if (entityLower.includes(projectName) || entityLower.includes(projectBaseName)) {
      return { score: 0.8, level: 'high', reason: 'project_in_entity' };
    }
  }
  
  // Check concepts for project-related terms
  const concepts = memory.concepts ?? [];
  if (concepts.some(c => c.toLowerCase().includes(projectName) || c.toLowerCase().includes(projectBaseName))) {
    return { score: 0.75, level: 'medium', reason: 'project_in_concepts' };
  }
  
  // No project reference found — this memory might be about a different project
  // Apply penalty but don't completely filter (might still be relevant)
  return { score: 0.3, level: 'low', reason: 'no_project_reference' };
}

/**
 * Apply project affinity scoring to search results.
 *
 * @param results - Search results with scores
 * @param memories - Full memory content for each result (keyed by ID)
 * @param context - Current project context
 * @param options - Scoring options
 * @returns Results with adjusted scores, sorted by affinity-weighted score
 */
export function applyProjectAffinity<T extends { id: number; score: number }>(
  results: T[],
  memories: Map<number, MemoryContent>,
  context: AffinityContext,
  options: {
    /** Minimum affinity score to include (default: 0, include all) */
    minAffinity?: number;
    /** Whether to filter out low-affinity results entirely (default: false) */
    filterLowAffinity?: boolean;
  } = {},
): T[] {
  const { minAffinity = 0, filterLowAffinity = false } = options;
  
  // Calculate affinity for each result
  const withAffinity = results.map(result => {
    const memory = memories.get(result.id);
    if (!memory) {
      // No memory content available — assume medium affinity
      return { ...result, affinity: 0.5, affinityLevel: 'medium' as const };
    }
    
    const { score: affinityScore, level } = calculateProjectAffinity(memory, context);
    return {
      ...result,
      score: result.score * affinityScore, // Apply affinity as multiplier
      affinity: affinityScore,
      affinityLevel: level,
    };
  });
  
  // Filter by minimum affinity if requested
  let filtered = withAffinity;
  if (filterLowAffinity) {
    filtered = withAffinity.filter(r => r.affinity >= 0.5);
  } else if (minAffinity > 0) {
    filtered = withAffinity.filter(r => r.affinity >= minAffinity);
  }
  
  // Re-sort by affinity-weighted score
  filtered.sort((a, b) => b.score - a.score);
  
  // Return without the extra affinity fields (keep original shape)
  return filtered.map(({ affinity: _, affinityLevel: __, ...rest }) => rest as T);
}

/**
 * Extract project keywords from project name and common patterns.
 * Used to improve affinity detection for projects with distinctive names.
 */
export function extractProjectKeywords(projectName: string, projectId: string): string[] {
  const keywords: string[] = [projectName];
  
  // Add base name from projectId
  const baseName = projectId.split('/').pop();
  if (baseName && baseName !== projectName) {
    keywords.push(baseName);
  }
  
  // Add common variations
  const variations = [
    projectName.replace(/-/g, '_'),
    projectName.replace(/_/g, '-'),
    projectName.replace(/[_-]/g, ''),
  ];
  for (const v of variations) {
    if (v !== projectName && !keywords.includes(v)) {
      keywords.push(v);
    }
  }
  
  return keywords.filter(k => k.length > 2);
}
