export const DEFAULT_CODEGRAPH_EXCLUDES = [
  'node_modules/**',
  'dist/**',
  'build/**',
  'coverage/**',
  '.next/**',
  '.turbo/**',
  '.git/**',
  '.tmp/**',
  '.worktrees/**',
  '.claude/worktrees/**',
];

export function normalizeCodeGraphExcludePatterns(exclude?: string[]): string[] {
  return [...new Set([
    ...DEFAULT_CODEGRAPH_EXCLUDES,
    ...(exclude ?? []).map(pattern => pattern.trim()).filter(Boolean),
  ])];
}

export function isCodeGraphExcludedPath(path: string, exclude?: string[]): boolean {
  const normalized = normalizeCodePath(path);
  return normalizeCodeGraphExcludePatterns(exclude).some((pattern) => matchesPattern(normalized, normalizeCodePath(pattern)));
}

function normalizeCodePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\/+/, '');
}

function matchesPattern(path: string, pattern: string): boolean {
  if (pattern.endsWith('/**')) {
    const base = pattern.slice(0, -3);
    if (base.startsWith('**/')) {
      const suffix = base.slice(3);
      return path === suffix || path.endsWith(`/${suffix}`) || path.includes(`/${suffix}/`);
    }
    if (!base.includes('/')) {
      return path === base || path.startsWith(`${base}/`) || path.includes(`/${base}/`);
    }
    return path === base || path.startsWith(`${base}/`);
  }
  if (pattern.startsWith('**/')) {
    const suffix = pattern.slice(3);
    return path === suffix || path.endsWith(`/${suffix}`);
  }
  return path === pattern || path.startsWith(`${pattern}/`);
}
