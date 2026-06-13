/**
 * Memory Injection Hook
 *
 * Runs before each agent turn to inject relevant Memorix memories
 * into the system prompt, giving the agent persistent cross-session knowledge.
 *
 * NOW WITH ASYNC PREFETCH: The heavy compactSearch() runs while the user
 * is typing (via MemoryPrefetcher). At injection time, we read from cache
 * or race against a 300ms timeout. Result: near-zero latency on cache hit.
 *
 * Hook point: ExtensionRunner `before_agent_start` event.
 *
 * Data flow:
 *   User types → MemoryPrefetcher.onInput() → debounce → compactSearch() → cache
 *   User sends → injectMemories() → getCachedOrFetch() → instant or 300ms timeout
 *     -> format results -> append to systemPrompt
 *     -> runLoop() starts with enriched context
 */

import type { ExtensionContext } from '../core/extensions/types.ts';
import { getPrefetcher } from './memory-prefetch.ts';
import { recordMemorixInjectedRefs } from './memorix-runtime-context.ts';

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
// Core injection function — now uses prefetch cache
// ---------------------------------------------------------------------------

/**
 * Inject memories into system prompt using the prefetch cache.
 * Falls back to direct search with 300ms timeout if cache misses.
 *
 * @param systemPrompt - The current system prompt.
 * @param prompt - The raw user prompt text for this turn.
 * @param projectId - Active project ID for scoped search.
 * @param config - Injection configuration.
 * @returns The system prompt with memories appended, or the original if none found.
 */
export async function injectMemories(
  systemPrompt: string,
  prompt: string,
  projectId: string,
  config: Partial<MemoryInjectionConfig> = {},
): Promise<string> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  if (!cfg.enabled) return systemPrompt;

  const query = extractSearchQuery(prompt);
  if (!query) return systemPrompt;

  try {
    // Use prefetcher — reads cache or races against timeout
    const prefetcher = getPrefetcher(projectId);
    const t0 = Date.now();
    const result = await prefetcher.getCachedOrFetch(query);
    const elapsed = Date.now() - t0;

    if (elapsed > 50) {
      console.error(`[memcode] memory injection: ${elapsed}ms (${result?.entries?.length ?? 0} results, ${result ? 'hit' : 'miss'})`);
    }

    if (!result || result.entries.length === 0) return systemPrompt;

    recordMemorixInjectedRefs(result.entries.map((entry) => ({ id: entry.id, projectId: (entry as any).projectId })));
    const memoryBlock = formatMemoryBlock(result.entries, result.formatted);
    return `${systemPrompt}\n\n${memoryBlock}`;
  } catch {
    // Memory injection is best-effort; never break the agent turn.
    return systemPrompt;
  }
}

// ---------------------------------------------------------------------------
// Search query extraction
// ---------------------------------------------------------------------------

function extractSearchQuery(prompt: string): string {
  const trimmed = prompt.trim();
  if (!trimmed) return '';
  if (trimmed.length > 500) return trimmed.slice(0, 500);
  return trimmed;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

function formatMemoryBlock(entries: IndexEntry[], fallbackFormatted: string): string {
  const lines: string[] = ['## Relevant Memories', ''];

  const hasTitles = entries.some((e) => e.title);
  if (hasTitles) {
    for (const entry of entries) {
      const type = entry.type ?? entry.documentType ?? 'memory';
      const title = entry.title ?? `#${entry.id}`;
      const bullet = `- [${type}] ${title}`;
      lines.push(bullet);
    }
  } else {
    lines.push(fallbackFormatted);
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Extension handler factory
// ---------------------------------------------------------------------------

export function createMemoryInjectionHandler(
  projectId: string,
  config: Partial<MemoryInjectionConfig> = {},
) {
  return async (
    event: { prompt: string; systemPrompt: string },
    _ctx: ExtensionContext,
  ): Promise<{ systemPrompt: string } | undefined> => {
    const enriched = await injectMemories(event.systemPrompt, event.prompt, projectId, config);
    if (enriched === event.systemPrompt) return undefined;
    return { systemPrompt: enriched };
  };
}
