import { join } from 'node:path';

export function getGlobalConfigTomlPath(homeDir: string): string {
  return join(homeDir, '.memorix', 'config.toml');
}

export function getProjectConfigTomlPath(projectRoot: string): string {
  return join(projectRoot, 'memorix.toml');
}

export function getGlobalYamlPath(homeDir: string): string {
  return join(homeDir, '.memorix', 'memorix.yml');
}

export function getProjectYamlPath(projectRoot: string): string {
  return join(projectRoot, 'memorix.yml');
}

export function getGlobalDotenvPath(homeDir: string): string {
  return join(homeDir, '.memorix', '.env');
}

export function getProjectDotenvPath(projectRoot: string): string {
  return join(projectRoot, '.env');
}

export function getLegacyConfigJsonPath(homeDir: string): string {
  return join(homeDir, '.memorix', 'config.json');
}
