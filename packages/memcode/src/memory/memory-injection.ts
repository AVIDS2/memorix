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
import { importFromMemorix } from '../core/memorix-resolve.ts';
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
  /** Only inject for prompts that look like real development work. Default: true */
  intentGate: boolean;
}

const DEFAULT_CONFIG: MemoryInjectionConfig = {
  enabled: true,
  maxResults: 5,
  maxTokens: 2000,
  intentGate: true,
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
  if (cfg.intentGate && !looksLikeDevelopmentTask(query)) return systemPrompt;

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
    const memoryBlock = await formatMemoryBlock(result.entries, result.formatted, projectId, query);
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

function looksLikeDevelopmentTask(prompt: string): boolean {
	const text = prompt.trim();
	if (text.length < 4) return false;

	const casualOnlyPatterns = [
		/^[\u4e00-\u9fff]{1,4}$/,
		/^(你好|哈喽|在吗|hello|hi|hey|666|1+|2+|3+|4+|5+|6+|7+|8+|9+)$/i,
	];
	if (casualOnlyPatterns.some((pattern) => pattern.test(text))) {
		return false;
	}

	return /(?:\b(?:debug|review|build|run|fix|implement|refactor|search|memory|hook|model|config|state|status|bug|test|repair|patch)\b|[修改查看试测设配调命令配置状态问题])/.test(text);
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

async function formatMemoryBlock(entries: IndexEntry[], fallbackFormatted: string, projectId: string, query: string): Promise<string> {
  try {
    const observationsMod = await importFromMemorix('memory/observations.js');
    const graphContextMod = await importFromMemorix('memory/graph-context.js');
    const allObservations = typeof observationsMod.getAllObservations === 'function'
      ? observationsMod.getAllObservations()
      : [];
    if (typeof graphContextMod.buildGraphContextPacket === 'function') {
      const packet = graphContextMod.buildGraphContextPacket(allObservations, {
        projectId,
        query,
        limit: Math.max(1, Math.min(entries.length || 5, 5)),
      });
      if ((packet.memories?.length ?? 0) === 0 && (packet.entities?.length ?? 0) === 0) {
        throw new Error('empty graph context packet');
      }
      if (typeof graphContextMod.formatGraphContextPrompt === 'function') {
        return graphContextMod.formatGraphContextPrompt(packet);
      }
    }
  } catch {
    // Fall through to legacy presentation.
  }

  const lines: string[] = ['## Relevant Memories', ''];
  const hasTitles = entries.some((e) => e.title);
  if (hasTitles) {
    for (const entry of entries) {
      const type = entry.type ?? entry.documentType ?? 'memory';
      const title = entry.title ?? `#${entry.id}`;
      lines.push(`- [${type}] ${title}`);
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
