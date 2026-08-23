import { getLoadedEnvValue } from '../config/dotenv-loader.js';

export interface DashboardKeySourceOptions {
  value: string;
  envKeys: readonly string[];
  configSource: string;
}

/** Resolve a secret source using the ordered environment fallback candidates. */
export function resolveDashboardKeySource({ value, envKeys, configSource }: DashboardKeySourceOptions): string {
  for (const envKey of envKeys) {
    const envValue = process.env[envKey];
    if (envValue !== value) continue;
    return getLoadedEnvValue(envKey) === envValue ? '.env' : `env:${envKey}`;
  }
  return configSource;
}
