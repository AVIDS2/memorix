import type { ProjectInfo } from '../types.js';
import { evaluateCodeRefFreshness } from './freshness.js';
import type { CodeFile, CodeRefStatus, CodeSymbol, ObservationCodeRef } from './types.js';
import type { CodeGraphStore } from './store.js';
import { isCodeGraphExcludedPath } from './exclude.js';

export interface ProjectContextObservation {
  id: number;
  projectId: string;
  title: string;
  type: string;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface LanguageSummary {
  language: string;
  files: number;
}

export interface ProjectContextOverview {
  project: Pick<ProjectInfo, 'id' | 'name' | 'rootPath'>;
  code: {
    provider: string;
    files: number;
    symbols: number;
    edges: number;
    refs: number;
    indexedAt?: string;
    languages: LanguageSummary[];
  };
  memory: {
    total: number;
    active: number;
  };
  freshness: {
    current: number;
    suspect: number;
    stale: number;
    unbound: number;
  };
  suggestedReads: string[];
}

export interface ProjectContextSource {
  observationId: number;
  title: string;
  type: string;
  path?: string;
  symbol?: string;
  status: CodeRefStatus;
  reason: string;
}

export interface ProjectContextExplain {
  project: Pick<ProjectInfo, 'id' | 'name' | 'rootPath'>;
  sources: ProjectContextSource[];
  overview: ProjectContextOverview;
}

function uniq<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function activeObservations(observations: ProjectContextObservation[], projectId: string): ProjectContextObservation[] {
  return observations.filter(obs => obs.projectId === projectId && (obs.status ?? 'active') === 'active');
}

function countLanguages(files: CodeFile[]): LanguageSummary[] {
  const counts = new Map<string, number>();
  for (const file of files) {
    const language = file.language ?? 'unknown';
    counts.set(language, (counts.get(language) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([language, files]) => ({ language, files }))
    .sort((a, b) => a.language.localeCompare(b.language));
}

function suggestedReadRank(path: string): number {
  const normalized = path.replace(/\\/g, '/');
  if (normalized.startsWith('src/')) return 0;
  if (normalized.startsWith('tests/') || normalized.startsWith('test/')) return 0;
  if (normalized.startsWith('packages/') && normalized.includes('/src/')) return 2;
  return 3;
}

function compactSuggestedReads(paths: string[], limit = 8, exclude?: string[]): string[] {
  return uniq(paths)
    .filter(path => !isCodeGraphExcludedPath(path, exclude))
    .sort((a, b) => suggestedReadRank(a) - suggestedReadRank(b))
    .slice(0, limit);
}

function collectGraph(
  store: CodeGraphStore,
  projectId: string,
  observations: ProjectContextObservation[],
  exclude?: string[],
): {
  files: CodeFile[];
  symbols: CodeSymbol[];
  refs: ObservationCodeRef[];
  freshness: ProjectContextOverview['freshness'];
  sources: ProjectContextSource[];
  suggestedReads: string[];
} {
  const files = store.listFiles(projectId);
  const symbols = files.flatMap(file => store.listSymbolsForFile(file.id));
  const filesById = new Map(files.map(file => [file.id, file]));
  const symbolsById = new Map(symbols.map(symbol => [symbol.id, symbol]));
  const observationsById = new Map(observations.map(obs => [obs.id, obs]));
  const refs = observations.flatMap(obs => store.listObservationRefs(projectId, obs.id));
  const freshness: ProjectContextOverview['freshness'] = {
    current: 0,
    suspect: 0,
    stale: 0,
    unbound: 0,
  };
  const sources: ProjectContextSource[] = [];
  const suggestedReads: string[] = [];

  for (const ref of refs) {
    const file = ref.fileId ? filesById.get(ref.fileId) : undefined;
    const symbol = ref.symbolId ? symbolsById.get(ref.symbolId) : undefined;
    const result = evaluateCodeRefFreshness(ref, file, symbol);
    freshness[result.status] += 1;

    const observation = observationsById.get(ref.observationId);
    if (!observation) continue;
    const excluded = file ? isCodeGraphExcludedPath(file.path, exclude) : false;
    if (result.status === 'current' && file && !excluded) suggestedReads.push(file.path);
    if (excluded) continue;
    sources.push({
      observationId: observation.id,
      title: observation.title,
      type: observation.type,
      ...(file ? { path: file.path } : {}),
      ...(symbol ? { symbol: symbol.name } : {}),
      status: result.status,
      reason: result.reason,
    });
  }

  return {
    files,
    symbols,
    refs,
    freshness,
    sources,
    suggestedReads: compactSuggestedReads(suggestedReads, 8, exclude),
  };
}

export function buildProjectContextOverview(input: {
  project: Pick<ProjectInfo, 'id' | 'name' | 'rootPath'>;
  store: CodeGraphStore;
  observations: ProjectContextObservation[];
  exclude?: string[];
}): ProjectContextOverview {
  const active = activeObservations(input.observations, input.project.id);
  const graph = collectGraph(input.store, input.project.id, active, input.exclude);
  const status = input.store.status(input.project.id);

  return {
    project: input.project,
    code: {
      provider: status.provider,
      files: status.files,
      symbols: status.symbols,
      edges: status.edges,
      refs: status.refs,
      ...(status.indexedAt ? { indexedAt: status.indexedAt } : {}),
      languages: countLanguages(graph.files),
    },
    memory: {
      total: input.observations.filter(obs => obs.projectId === input.project.id).length,
      active: active.length,
    },
    freshness: graph.freshness,
    suggestedReads: graph.suggestedReads,
  };
}

export function buildProjectContextExplain(input: {
  project: Pick<ProjectInfo, 'id' | 'name' | 'rootPath'>;
  store: CodeGraphStore;
  observations: ProjectContextObservation[];
  exclude?: string[];
}): ProjectContextExplain {
  const overview = buildProjectContextOverview(input);
  const active = activeObservations(input.observations, input.project.id);
  const graph = collectGraph(input.store, input.project.id, active, input.exclude);
  return {
    project: input.project,
    sources: graph.sources.sort((a, b) => a.observationId - b.observationId || (a.path ?? '').localeCompare(b.path ?? '')),
    overview,
  };
}

function plural(count: number, singular: string, pluralText = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralText}`;
}

export function formatProjectContextOverview(overview: ProjectContextOverview): string {
  const languages = overview.code.languages.length > 0
    ? overview.code.languages.map(item => `${item.language} ${item.files}`).join(', ')
    : 'none indexed yet';
  const lines = [
    `Project context for ${overview.project.name}`,
    `- Code memory: ${plural(overview.code.files, 'code file')} / ${plural(overview.code.symbols, 'symbol')} / ${plural(overview.code.edges, 'relationship')}`,
    `- Languages: ${languages}`,
    `- Memories: ${overview.memory.active} active / ${overview.memory.total} total`,
    `- Links: ${overview.freshness.current} current, ${plural(overview.freshness.suspect, 'suspect memory link')}, ${plural(overview.freshness.stale, 'stale memory link')}`,
    overview.code.indexedAt ? `- Last project scan: ${overview.code.indexedAt}` : '- Last project scan: never',
    '',
    'Suggested reads',
  ];

  if (overview.suggestedReads.length === 0) {
    lines.push('- none yet');
  } else {
    overview.suggestedReads.slice(0, 8).forEach((path, index) => lines.push(`${index + 1}. ${path}`));
  }

  return lines.join('\n');
}

export function formatProjectContextExplain(explain: ProjectContextExplain): string {
  const lines = [
    `Context sources for ${explain.project.name}`,
    `- Project: ${explain.project.id}`,
    `- Root: ${explain.project.rootPath}`,
    '',
    'Sources',
  ];

  if (explain.sources.length === 0) {
    lines.push('- no code-bound memories yet');
  } else {
    for (const source of explain.sources.slice(0, 20)) {
      const location = source.path ? `${source.path}${source.symbol ? `#${source.symbol}` : ''}` : 'missing code location';
      lines.push(`- #${source.observationId} ${source.type}: ${source.title}`);
      lines.push(`  location: ${location}`);
      lines.push(`  status: ${source.status} (${source.reason})`);
    }
  }

  return lines.join('\n');
}
