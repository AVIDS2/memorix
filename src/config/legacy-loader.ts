import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface MemorixConfig {
  llm?: {
    provider?: string;
    apiKey?: string;
    model?: string;
    baseUrl?: string;
  };
  agent?: {
    provider?: string;
    apiKey?: string;
    model?: string;
    baseUrl?: string;
  };
  embedding?: string;
  embeddingApi?: {
    apiKey?: string;
    baseUrl?: string;
    model?: string;
    dimensions?: number;
  };
}

let cachedConfig: MemorixConfig | null = null;

export function loadFileConfig(): MemorixConfig {
  if (cachedConfig !== null) return cachedConfig;

  const configPath = join(homedir(), '.memorix', 'config.json');
  try {
    if (existsSync(configPath)) {
      cachedConfig = JSON.parse(readFileSync(configPath, 'utf-8'));
      return cachedConfig!;
    }
  } catch {
    // Corrupt or unreadable legacy config should not block startup.
  }
  cachedConfig = {};
  return cachedConfig;
}

export function resetConfigCache(): void {
  cachedConfig = null;
}
