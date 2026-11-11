/**
 * Project classification helpers — shared by /api/projects and /api/identity.
 *
 * Three kinds:
 *   - 'real':        genuine user projects (e.g. AVIDS2/memorix, github.com/org/repo)
 *   - 'temporary':   test/demo/smoke/e2e scratch projects (local/task-*, local/smoke-*, etc.)
 *   - 'placeholder': unresolved / obviously broken IDs (placeholder/*, __unresolved__, System32)
 *
 * A 'dirty' project is one with a clearly broken canonical ID (System32 etc.).
 * 'dirty' and 'temporary' are orthogonal axes:
 *   - local/task-abc        → temporary, NOT dirty
 *   - placeholder/xxx       → placeholder, dirty
 *   - System32\something    → real-looking location but dirty (broken ID)
 */

export type ProjectKind = 'real' | 'temporary' | 'placeholder';

/** Regex list — anything matching is temporary (scratch projects) */
const TEMPORARY_PATTERNS: RegExp[] = [
  /^local\/task-/i,
  /^local\/smoke-/i,
  /^local\/release-smoke-/i,
  /^local\/memorix-e2e-/i,
  /^local\/orchestrate-/i,
  /^local\/scratch-/i,
  /^local\/tmp-/i,
];

/** Regex list — anything matching is placeholder/unresolved */
const PLACEHOLDER_PATTERNS: RegExp[] = [
  /^__unresolved__$/,
  /^placeholder\//i,
];

/** Regex list — IDs that indicate a broken canonical ID (dirty). */
const DIRTY_PATTERNS: RegExp[] = [
  /^placeholder\//i,
  /System32/i,
  /Microsoft VS Code/i,
  /node_modules/i,
  /\.vscode/i,
  /^local\/[A-Z]:\\/i,
];

export function classifyProjectId(id: string): ProjectKind {
  if (!id) return 'placeholder';
  if (PLACEHOLDER_PATTERNS.some(p => p.test(id))) return 'placeholder';
  if (TEMPORARY_PATTERNS.some(p => p.test(id))) return 'temporary';
  return 'real';
}

export function isDirtyProjectId(id: string): boolean {
  if (!id) return false;
  return DIRTY_PATTERNS.some(p => p.test(id));
}

/** Friendly label for UI badges */
export function projectKindLabel(kind: ProjectKind): string {
  switch (kind) {
    case 'real': return 'real';
    case 'temporary': return 'temporary';
    case 'placeholder': return 'placeholder';
  }
}
