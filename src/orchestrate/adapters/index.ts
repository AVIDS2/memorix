/**
 * Agent adapter registry.
 */

export { ClaudeAdapter } from './claude.js';
export { CodexAdapter } from './codex.js';
export { GeminiAdapter } from './gemini.js';
export { OpenCodeAdapter } from './opencode.js';
export type { AgentAdapter, AgentProcess, AgentProcessResult, SpawnOptions } from './types.js';

import { ClaudeAdapter } from './claude.js';
import { CodexAdapter } from './codex.js';
import { GeminiAdapter } from './gemini.js';
import { OpenCodeAdapter } from './opencode.js';
import type { AgentAdapter } from './types.js';

const REGISTRY: Record<string, () => AgentAdapter> = {
  claude: () => new ClaudeAdapter(),
  codex: () => new CodexAdapter(),
  gemini: () => new GeminiAdapter(),
  opencode: () => new OpenCodeAdapter(),
};

/** Resolve adapter names to instances. Unknown names are skipped with a warning. */
export function resolveAdapters(names: string[]): AgentAdapter[] {
  const adapters: AgentAdapter[] = [];
  for (const name of names) {
    const factory = REGISTRY[name.toLowerCase()];
    if (factory) {
      adapters.push(factory());
    } else {
      console.error(`[orchestrate] Unknown agent adapter: ${name} (available: ${Object.keys(REGISTRY).join(', ')})`);
    }
  }
  return adapters;
}
