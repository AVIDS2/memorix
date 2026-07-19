import type { ProjectContextExplain } from './project-context.js';

export type TaskLensId =
  | 'bugfix'
  | 'feature'
  | 'release'
  | 'onboarding'
  | 'refactor'
  | 'docs'
  | 'test'
  | 'general';

export interface TaskLens {
  id: TaskLensId;
  description: string;
  sourceLimit: number;
  cautionLimit: number;
  hideUnrelatedCautionDetails: boolean;
  hideUnrelatedReliableDetails: boolean;
}

type ProjectContextSource = ProjectContextExplain['sources'][number];

const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'as',
  'for',
  'in',
  'into',
  'of',
  'on',
  'onto',
  'the',
  'this',
  'that',
  'to',
  'with',
  'work',
  'project',
  'continue',
  '继续',
  '项目',
]);

const LENSES: Record<TaskLensId, TaskLens> = {
  bugfix: {
    id: 'bugfix',
    description: 'debug the failure with current code and the smallest repro first',
    sourceLimit: 6,
    cautionLimit: 4,
    hideUnrelatedCautionDetails: true,
    hideUnrelatedReliableDetails: false,
  },
  feature: {
    id: 'feature',
    description: 'build a scoped feature from nearby source, types, and user flow',
    sourceLimit: 6,
    cautionLimit: 3,
    hideUnrelatedCautionDetails: true,
    hideUnrelatedReliableDetails: false,
  },
  release: {
    id: 'release',
    description: 'prepare a release using current metadata, changelog, build, and package checks',
    sourceLimit: 4,
    cautionLimit: 2,
    hideUnrelatedCautionDetails: true,
    hideUnrelatedReliableDetails: true,
  },
  onboarding: {
    id: 'onboarding',
    description: 'understand the project shape before trusting old implementation details',
    sourceLimit: 4,
    cautionLimit: 2,
    hideUnrelatedCautionDetails: true,
    hideUnrelatedReliableDetails: true,
  },
  refactor: {
    id: 'refactor',
    description: 'change structure carefully by reading shared code, call sites, and tests',
    sourceLimit: 6,
    cautionLimit: 4,
    hideUnrelatedCautionDetails: true,
    hideUnrelatedReliableDetails: false,
  },
  docs: {
    id: 'docs',
    description: 'update documentation against current code and public entry points',
    sourceLimit: 5,
    cautionLimit: 2,
    hideUnrelatedCautionDetails: true,
    hideUnrelatedReliableDetails: true,
  },
  test: {
    id: 'test',
    description: 'work from tests, fixtures, harnesses, and the related source files',
    sourceLimit: 6,
    cautionLimit: 3,
    hideUnrelatedCautionDetails: true,
    hideUnrelatedReliableDetails: false,
  },
  general: {
    id: 'general',
    description: 'balanced project handoff with current facts, code memory, and verification hints',
    sourceLimit: 8,
    cautionLimit: 5,
    hideUnrelatedCautionDetails: false,
    hideUnrelatedReliableDetails: false,
  },
};

const KEYWORDS: Record<Exclude<TaskLensId, 'general'>, string[]> = {
  bugfix: [
    'bug',
    'crash',
    'incident',
    'debug',
    'error',
    'fail',
    'failing',
    'fix',
    'issue',
    'regression',
    'repro',
    '报错',
    '崩溃',
    '故障',
    '失败',
    '修复',
    '问题',
  ],
  feature: ['add', 'build', 'feature', 'implement', 'new', 'support', '新增', '实现', '支持', '功能'],
  release: ['bump', 'changelog', 'npm', 'pack', 'publish', 'release', 'version', '发版', '发布', '版本'],
  onboarding: ['architecture', 'handoff', 'onboard', 'overview', 'understand', '接手', '了解', '理解', '架构'],
  refactor: ['cleanup', 'migrate', 'refactor', 'rename', 'restructure', '重构', '迁移', '改造'],
  docs: ['doc', 'docs', 'readme', '文档', '说明'],
  test: ['coverage', 'fixture', 'smoke', 'spec', 'test', 'tests', 'testing', 'vitest', '测试'],
};

const LENS_PRIORITY: Exclude<TaskLensId, 'general'>[] = [
  'bugfix',
  'release',
  'test',
  'refactor',
  'feature',
  'docs',
  'onboarding',
];

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/');
}

function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9_./-]+|[\u4e00-\u9fff]+/g) ?? [])
    .map(token => token.trim())
    .filter(token => token.length > 1 && !STOP_WORDS.has(token));
}

/**
 * Match a task keyword only when the task states it as an action or intent,
 * rather than prohibiting that action. Workflow selection shares this rule so
 * a safety constraint cannot reintroduce an intent rejected by task routing.
 */
export function containsTaskKeyword(text: string, keyword: string): boolean {
  const matcher = /^[a-z0-9_-]+$/i.test(keyword)
    ? new RegExp(`(^|[^a-z0-9_-])${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=[^a-z0-9_-]|$)`, 'gi')
    : new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  let match: RegExpExecArray | null;
  while ((match = matcher.exec(text)) !== null) {
    const keywordIndex = match.index + (match[1]?.length ?? 0);
    if (!isNegatedTaskKeyword(text, keywordIndex)) return true;
  }
  return false;
}

/**
 * Task text often carries safety constraints such as "do not publish". Those
 * constraints must not route a debugging task into the release workflow.
 * Keep this deliberately small and local: it only suppresses a keyword inside
 * the same sentence when the sentence explicitly negates an action.
 */
function isNegatedTaskKeyword(text: string, keywordIndex: number): boolean {
  const boundary = Math.max(
    text.lastIndexOf('.', keywordIndex - 1),
    text.lastIndexOf('!', keywordIndex - 1),
    text.lastIndexOf('?', keywordIndex - 1),
    text.lastIndexOf(';', keywordIndex - 1),
    text.lastIndexOf('\n', keywordIndex - 1),
    text.lastIndexOf('\u3002', keywordIndex - 1),
    text.lastIndexOf('\uff01', keywordIndex - 1),
    text.lastIndexOf('\uff1f', keywordIndex - 1),
    text.lastIndexOf('\uff1b', keywordIndex - 1),
  );
  let prefix = text.slice(boundary + 1, keywordIndex).toLowerCase();
  const contrast = /(?:,|\uff0c)\s*(?:but|however|instead|yet|\u4f46\u662f|\u4f46|\u800c\u662f)\s*/gi;
  let contrastMatch: RegExpExecArray | null;
  let contrastEnd = -1;
  while ((contrastMatch = contrast.exec(prefix)) !== null) contrastEnd = contrast.lastIndex;
  if (contrastEnd >= 0) prefix = prefix.slice(contrastEnd);
  if (/\b(?:do|does|did|should|must|can|could|will|would|may|might)\s+not\b/.test(prefix)) return true;
  if (/\b(?:don't|dont|never|without|avoid|skip)\b/.test(prefix)) return true;
  if (/(?:^|[\s,])no\s+(?:[a-z0-9_-]+\s*){0,4}$/i.test(prefix)) return true;
  const chineseClauseStart = Math.max(prefix.lastIndexOf(','), prefix.lastIndexOf('\uff0c'), prefix.lastIndexOf('\u3001'));
  const chineseClause = prefix.slice(chineseClauseStart + 1);
  return /(?:\u4e0d\u8981|\u4e0d\u5e94|\u4e0d\u53ef|\u4e0d\u80fd|\u4e0d\u4f1a|\u7981\u6b62|\u52ff|\u4e0d)\s*(?:\u7acb\u5373|\u76f4\u63a5|\u518d|\u73b0\u5728|\u64c5\u81ea|\u5148)?\s*$/.test(chineseClause);
}

export function resolveTaskLens(task?: string): TaskLens {
  const normalized = (task ?? '').toLowerCase();
  if (!normalized.trim()) return LENSES.general;

  let best: { id: TaskLensId; score: number; priority: number } = {
    id: 'general',
    score: 0,
    priority: Number.MAX_SAFE_INTEGER,
  };

  for (const id of LENS_PRIORITY) {
    const score = KEYWORDS[id].reduce((sum, keyword) => sum + (containsTaskKeyword(normalized, keyword) ? 1 : 0), 0);
    const priority = LENS_PRIORITY.indexOf(id);
    if (score > best.score || (score === best.score && score > 0 && priority < best.priority)) {
      best = { id, score, priority };
    }
  }

  return best.score > 0 ? LENSES[best.id] : LENSES.general;
}

function pathKindScore(path: string, lens: TaskLens): number {
  const normalized = normalizePath(path).toLowerCase();
  const name = normalized.split('/').pop() ?? normalized;
  const inDocs = normalized.startsWith('docs/') || name === 'readme.md' || name.includes('readme');
  const isTest = /(^|\/)(tests?|__tests__|spec|fixtures?)\//.test(normalized)
    || /\.(test|spec)\.[cm]?[jt]sx?$/.test(normalized)
    || /\.(test|spec)\.py$/.test(normalized);
  const isSource = normalized.startsWith('src/') || normalized.includes('/src/');
  const isPackage = name === 'package.json' || name === 'package-lock.json' || name === 'pnpm-lock.yaml' || name === 'yarn.lock';
  const isChangelog = name === 'changelog.md' || name === 'changes.md';
  const isWorkflow = normalized.startsWith('.github/workflows/');

  switch (lens.id) {
    case 'bugfix':
      return (isTest ? 80 : 0) + (isSource ? 50 : 0) + (normalized.includes('debug') ? 20 : 0);
    case 'test':
      return (isTest ? 90 : 0) + (isSource ? 45 : 0);
    case 'release':
      return (isChangelog ? 100 : 0) + (isPackage ? 90 : 0) + (isWorkflow ? 70 : 0) + (inDocs ? 35 : 0);
    case 'onboarding':
      return (name === 'readme.md' ? 100 : 0) + (inDocs ? 80 : 0) + (isPackage ? 45 : 0) + (isSource ? 20 : 0);
    case 'docs':
      return (inDocs ? 100 : 0) + (isChangelog ? 60 : 0) + (isSource ? 25 : 0);
    case 'refactor':
      return (isSource ? 70 : 0) + (isTest ? 65 : 0);
    case 'feature':
      return (isSource ? 80 : 0) + (isTest ? 45 : 0) + (inDocs ? 20 : 0);
    default:
      if (isSource || isTest) return 60;
      if (normalized.startsWith('packages/') && normalized.includes('/src/')) return 45;
      if (inDocs) return 20;
      return 0;
  }
}

function tokenScore(text: string, tokens: string[]): number {
  if (tokens.length === 0) return 0;
  const normalized = text.toLowerCase();
  return tokens.reduce((sum, token) => sum + (normalized.includes(token) ? 12 : 0), 0);
}

function sourceTaskMatchScore(source: ProjectContextSource, task?: string): number {
  const tokens = tokenize(task ?? '');
  if (tokens.length === 0) return 0;
  const text = [
    source.title,
    source.path ?? '',
    source.symbol ?? '',
  ].join('\n').toLowerCase();
  const matches = tokens.filter(token => text.includes(token)).length;
  if (matches >= 2) return 40;
  if (matches === 1) return 24;
  return 0;
}

function fallbackPathRank(path: string): number {
  const normalized = normalizePath(path);
  if (normalized.startsWith('src/')) return 0;
  if (normalized.startsWith('tests/') || normalized.startsWith('test/')) return 1;
  if (normalized.startsWith('packages/') && normalized.includes('/src/')) return 2;
  if (normalized.startsWith('docs/') || normalized.toLowerCase() === 'readme.md') return 3;
  return 4;
}

export function rankLensPaths(paths: string[], lens: TaskLens, task?: string): string[] {
  const tokens = tokenize(task ?? '');
  return [...new Set(paths.map(normalizePath))]
    .map((path, index) => ({
      path,
      index,
      score: pathKindScore(path, lens) + tokenScore(path, tokens),
      fallback: fallbackPathRank(path),
    }))
    .sort((a, b) => b.score - a.score || a.fallback - b.fallback || a.index - b.index || a.path.localeCompare(b.path))
    .map(item => item.path);
}

export function lensPathCandidates(lens: TaskLens): string[] {
  switch (lens.id) {
    case 'release':
      return ['CHANGELOG.md', 'package.json', 'package-lock.json', '.github/workflows/ci.yml', '.github/workflows/test.yml', 'README.md'];
    case 'onboarding':
      return ['README.md', 'docs/README.md', 'docs/API_REFERENCE.md', 'package.json'];
    case 'docs':
      return ['README.md', 'README.zh-CN.md', 'docs/README.md', 'docs/API_REFERENCE.md', 'CHANGELOG.md'];
    case 'test':
    case 'bugfix':
      return ['tests', 'test'];
    default:
      return [];
  }
}

export function scoreLensSource(source: ProjectContextSource, lens: TaskLens, task?: string): number {
  const tokens = tokenize(task ?? '');
  const text = [source.title, source.type, source.path ?? '', source.symbol ?? ''].join('\n');
  return pathKindScore(source.path ?? '', lens) + tokenScore(text, tokens) + sourceTaskMatchScore(source, task);
}

export function rankLensSources<T extends ProjectContextSource>(sources: T[], lens: TaskLens, task?: string): T[] {
  return [...sources]
    .map((source, index) => ({
      source,
      index,
      score: scoreLensSource(source, lens, task),
    }))
    .sort((a, b) => b.score - a.score || a.source.observationId - b.source.observationId || a.index - b.index)
    .map(item => item.source);
}

export function lensVerificationHints(lens: TaskLens): string[] {
  switch (lens.id) {
    case 'bugfix':
      return [
        'run the smallest failing test or repro first',
        'inspect the changed code path before trusting old memory',
      ];
    case 'test':
      return [
        'run the exact focused test file or test name first',
        'inspect fixtures and harness setup before changing assertions',
      ];
    case 'release':
      return [
        'run build, tests, package smoke, and publish dry-run where available',
        'verify package metadata, changelog, and Git state before publishing',
      ];
    case 'onboarding':
      return [
        'read the docs/start files first, then inspect only the code paths needed for the task',
        'treat old implementation memories as leads until current code confirms them',
      ];
    case 'refactor':
      return [
        'inspect call sites and tests before editing shared code',
        'run the narrow affected test plus one regression smoke',
      ];
    case 'docs':
      return [
        'check headings, links, commands, and examples against current code',
        'run the smallest docs or package smoke available',
      ];
    case 'feature':
      return [
        'inspect the closest existing implementation pattern before adding new code',
        'run focused tests plus one user-flow smoke after changes',
      ];
    default:
      return [
        'inspect the Start here files before editing',
        'run the smallest relevant test or smoke command after changes',
      ];
  }
}

export function shouldShowLensSource(source: ProjectContextSource, lens: TaskLens, task?: string): boolean {
  if (lens.id === 'general') return true;
  const score = scoreLensSource(source, lens, task);
  if (lens.id === 'onboarding' || lens.id === 'release' || lens.id === 'docs') return score >= 40;
  return score > 0;
}
