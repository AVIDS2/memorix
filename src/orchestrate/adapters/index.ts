/**
 * Agent adapter registry.
 */

export { ClaudeAdapter } from './claude.js';
export { CodexAdapter } from './codex.js';
export { GeminiAdapter } from './gemini.js';
export { OpenCodeAdapter } from './opencode.js';
export type { AgentAdapter, AgentProcess, AgentProcessResult, AgentMessage, AgentMessageType, TokenUsage, SpawnOptions } from './types.js';

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

export interface AgentQuota {
  name: string;
  quota: number;
}

/**
 * Parse agent quota string: "claude:2,codex:1,gemini:2,opencode:2"
 * Plain names default to quota 1: "claude,codex" → [{claude,1},{codex,1}]
 */
export function parseAgentQuotas(raw: string): AgentQuota[] {
  const result: AgentQuota[] = [];
  for (const token of raw.split(',').map(s => s.trim()).filter(Boolean)) {
    const [name, countStr] = token.split(':');
    const quota = countStr ? parseInt(countStr, 10) : 1;
    if (!name || !Number.isFinite(quota) || quota < 1) {
      console.error(`[orchestrate] Invalid agent quota: "${token}" — expected "name" or "name:N"`);
      continue;
    }
    const key = name.toLowerCase();
    if (!REGISTRY[key]) {
      console.error(`[orchestrate] Unknown agent adapter: ${key} (available: ${Object.keys(REGISTRY).join(', ')})`);
      continue;
    }
    result.push({ name: key, quota });
  }
  return result;
}

/** Build quota map from AgentQuota array */
export function buildQuotaMap(quotas: AgentQuota[]): Record<string, number> {
  const map: Record<string, number> = {};
  for (const q of quotas) {
    map[q.name] = (map[q.name] ?? 0) + q.quota;
  }
  return map;
}

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
