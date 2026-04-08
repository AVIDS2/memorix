import { homedir } from 'node:os';

export function getIntegrationTargetRoot(
  useGlobalDefaults: boolean,
  cwd: string,
  homeDir = homedir(),
): string {
  return useGlobalDefaults ? homeDir : cwd;
}

export function getIntegrationScopeLabel(useGlobalDefaults: boolean): string {
  return useGlobalDefaults
    ? 'global defaults'
    : 'current project';
}
