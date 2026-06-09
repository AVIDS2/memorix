/**
 * Memory Injection Hook
 *
 * Runs before each agent turn to inject relevant Memorix memories
 * into the system prompt, giving the agent persistent cross-session knowledge.
 *
 * Hook point: ExtensionRunner `before_agent_start` event.
 *
 * Data flow:
 *   User sends message
 *     -> agent-session.ts: emitBeforeAgentStart()
 *     -> this handler: injectMemories()
 *     -> compactSearch() [src/compact/engine.ts, direct import]
 *     -> format results -> append to systemPrompt
 *     -> runLoop() starts with enriched context
 */

import type { ExtensionContext } from '../core/extensions/types.ts';

// Dynamic import for memorix core — avoids rootDir conflicts in tsc
async function getCompactSearch() {
	const mod = await import('../../../../src/compact/engine.js');
	return mod.compactSearch;
}

// Inline type to avoid static import from memorix core (rootDir conflict)
interface IndexEntry {
	id: number;
	type?: string;
	documentType?: string;
	title?: string;
	narrative?: string;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MemoryInjectionConfig {
  /** Enable/disable memory injection. Default: true */
  enabled: boolean;
  /** Maximum number of search results to inject. Default: 5 */
  maxResults: number;
  /** Token budget for injected memories. Default: 2000 */
  maxTokens: number;
}

const DEFAULT_CONFIG: MemoryInjectionConfig = {
  enabled: true,
  maxResults: 5,
  maxTokens: 2000,
};

// ---------------------------------------------------------------------------
// Core injection function
// ---------------------------------------------------------------------------

/**
 * Search Memorix for memories relevant to the current prompt and return
 * an enriched system prompt with a "Relevant Memories" section appended.
 *
 * @param systemPrompt - The current system prompt (may have been modified by earlier handlers).
 * @param prompt - The raw user prompt text for this turn.
 * @param projectId - Active project ID for scoped search.
 * @param config - Injection configuration.
 * @returns The system prompt with memories appended, or the original if no memories found.
 */
export async function injectMemories(
  systemPrompt: string,
  prompt: string,
  projectId: string,
  config: Partial<MemoryInjectionConfig> = {},
): Promise<string> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  if (!cfg.enabled) return systemPrompt;

  // Build search query from the user's prompt (simplest strategy for now).
  // Future: extract keywords, include recent conversation context, etc.
  const query = extractSearchQuery(prompt);
  if (!query) return systemPrompt;

  try {
    const compactSearch = await getCompactSearch();
    const { entries, formatted } = await compactSearch({
      query,
      projectId,
      limit: cfg.maxResults,
      maxTokens: cfg.maxTokens,
    });

    if (entries.length === 0) return systemPrompt;

    // Format as a bullet-point context block
    const memoryBlock = formatMemoryBlock(entries, formatted);

    return `${systemPrompt}\n\n${memoryBlock}`;
  } catch {
    // Memory injection is best-effort; never break the agent turn.
    return systemPrompt;
  }
}

// ---------------------------------------------------------------------------
// Search query extraction
// ---------------------------------------------------------------------------

/**
 * Extract a search query from the user prompt.
 * Current strategy: use the full prompt text, trimmed to a reasonable length.
 * Future strategies: keyword extraction, entity detection, full-context.
 */
function extractSearchQuery(prompt: string): string {
  const trimmed = prompt.trim();
  if (!trimmed) return '';

  // Cap at ~500 chars to avoid overly broad searches
  if (trimmed.length > 500) {
    return trimmed.slice(0, 500);
  }
  return trimmed;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/**
 * Format search results as a "Relevant Memories" section for the system prompt.
 *
 * Produces bullet points in the form:
 *   - [type] title — brief context...
 *
 * Falls back to the compact engine's table format when entries lack detail.
 */
function formatMemoryBlock(entries: IndexEntry[], fallbackFormatted: string): string {
  const lines: string[] = ['## Relevant Memories', ''];

  // If entries have titles (the common case), format as bullet points
  const hasTitles = entries.some((e) => e.title);
  if (hasTitles) {
    for (const entry of entries) {
      const type = entry.type ?? entry.documentType ?? 'memory';
      const title = entry.title ?? `#${entry.id}`;
      const bullet = `- [${type}] ${title}`;
      lines.push(bullet);
    }
  } else {
    // Fallback: use the compact engine's pre-formatted table
    lines.push(fallbackFormatted);
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Extension handler factory
// ---------------------------------------------------------------------------

/**
 * Create a `before_agent_start` extension handler that injects memories.
 *
 * Usage in a Memorix extension:
 * ```ts
 * import { createMemoryInjectionHandler } from '../memory/memory-injection.js';
 *
 * export default function (pi: ExtensionAPI) {
 *   pi.on('before_agent_start', createMemoryInjectionHandler('my-project-id'));
 * }
 * ```
 *
 * @param projectId - Active project ID for scoped memory search.
 * @param config - Optional injection configuration overrides.
 */
export function createMemoryInjectionHandler(
  projectId: string,
  config: Partial<MemoryInjectionConfig> = {},
) {
  return async (
    event: { prompt: string; systemPrompt: string },
    _ctx: ExtensionContext,
  ): Promise<{ systemPrompt: string } | undefined> => {
    const enriched = await injectMemories(event.systemPrompt, event.prompt, projectId, config);
    if (enriched === event.systemPrompt) return undefined; // no change
    return { systemPrompt: enriched };
  };
}
