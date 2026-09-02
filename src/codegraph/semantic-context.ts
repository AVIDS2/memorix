import type { CodeGraphOutline, CodeGraphProviderQuality, CodeGraphStatus, CodeSymbol } from './types.js';
import type { CodeGraphStore } from './store.js';

interface SemanticContextInput {
  store: CodeGraphStore;
  projectId: string;
  task: string;
  preferredPaths?: string[];
  maxNodes?: number;
  maxEdges?: number;
}

function tokens(text: string): string[] {
  return [...new Set((text.toLowerCase().match(/[a-z0-9_$./-]+|[\u4e00-\u9fff]+/g) ?? [])
    .filter(token => token.length > 1))];
}

function scoreSymbol(symbol: CodeSymbol, taskTokens: string[], preferred: Set<string>): number {
  const name = `${symbol.name} ${symbol.qualifiedName} ${symbol.path}`.toLowerCase();
  let score = preferred.has(symbol.path) ? 100 : 0;
  for (const token of taskTokens) {
    if (symbol.name.toLowerCase() === token) score += 20;
    else if (name.includes(token)) score += 6;
  }
  if (score > 0 && (symbol.kind === 'function' || symbol.kind === 'method')) score += 1;
  return score;
}

/** Build a small internal semantic outline from the persisted compiler graph. */
export function buildSemanticContext(input: SemanticContextInput): CodeGraphOutline | undefined {
  const maxNodes = Math.max(2, Math.min(16, Math.floor(input.maxNodes ?? 8)));
  const maxEdges = Math.max(1, Math.min(24, Math.floor(input.maxEdges ?? 12)));
  const taskTokens = tokens(input.task);
  const preferred = new Set((input.preferredPaths ?? []).map(path => path.replace(/\\/g, '/')));
  const symbols = input.store.listSymbols(input.projectId)
    .filter(symbol => symbol.source === 'typescript-compiler' && !symbol.stale)
    .map((symbol, index) => ({ symbol, score: scoreSymbol(symbol, taskTokens, preferred), index }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || a.symbol.path.localeCompare(b.symbol.path) || a.symbol.startLine! - b.symbol.startLine! || a.index - b.index)
    .slice(0, maxNodes)
    .map(item => item.symbol);
  if (symbols.length === 0) return undefined;

  const byId = new Map(symbols.map(symbol => [symbol.id, symbol]));
  const edges = input.store.listEdges(input.projectId)
    .filter(edge => edge.source === 'typescript-compiler')
    .filter(edge => (edge.fromSymbolId && byId.has(edge.fromSymbolId)) || (edge.toSymbolId && byId.has(edge.toSymbolId)))
    .slice(0, maxEdges);
  const endpointIds = new Set<string>();
  for (const edge of edges) {
    if (edge.fromSymbolId) endpointIds.add(edge.fromSymbolId);
    if (edge.toSymbolId) endpointIds.add(edge.toSymbolId);
  }
  const endpointSymbols = input.store.listSymbols(input.projectId)
    .filter(symbol => symbol.source === 'typescript-compiler' && endpointIds.has(symbol.id));
  const allSymbols = [...symbols, ...endpointSymbols]
    .filter((symbol, index, items) => items.findIndex(item => item.id === symbol.id) === index)
    .slice(0, maxNodes + maxEdges);
  const allById = new Map(allSymbols.map(symbol => [symbol.id, symbol]));
  const relations = edges.flatMap(edge => {
    const from = edge.fromSymbolId ? allById.get(edge.fromSymbolId) : undefined;
    const to = edge.toSymbolId ? allById.get(edge.toSymbolId) : undefined;
    if (!from || !to) return [];
    return [{
      from: {
        id: from.id,
        name: from.name,
        qualifiedName: from.qualifiedName,
        kind: from.kind,
        path: from.path,
        ...(from.startLine ? { startLine: from.startLine } : {}),
        ...(from.endLine ? { endLine: from.endLine } : {}),
        language: 'typescript',
      },
      to: {
        id: to.id,
        name: to.name,
        qualifiedName: to.qualifiedName,
        kind: to.kind,
        path: to.path,
        ...(to.startLine ? { startLine: to.startLine } : {}),
        ...(to.endLine ? { endLine: to.endLine } : {}),
        language: 'typescript',
      },
      kind: edge.type,
      ...(edge.evidence?.match(/line (\d+)/)?.[1] ? { line: Number(edge.evidence.match(/line (\d+)/)![1]) } : {}),
    }];
  });
  const entryPoints = symbols.slice(0, Math.min(5, symbols.length)).map(symbol => ({
    id: symbol.id,
    name: symbol.name,
    qualifiedName: symbol.qualifiedName,
    kind: symbol.kind,
    path: symbol.path,
    ...(symbol.startLine ? { startLine: symbol.startLine } : {}),
    ...(symbol.endLine ? { endLine: symbol.endLine } : {}),
    language: 'typescript',
  }));
  const files = input.store.listFiles(input.projectId);
  const fileById = new Map(files.map(file => [file.id, file.path]));
  const relatedFiles = [...new Set([
    ...allSymbols.map(symbol => symbol.path),
    ...edges.flatMap(edge => [
      edge.fromFileId ? fileById.get(edge.fromFileId) : undefined,
      edge.toFileId ? fileById.get(edge.toFileId) : undefined,
    ]),
  ].filter((path): path is string => Boolean(path)))].slice(0, 8);
  return {
    provider: 'semantic',
    entryPoints,
    relations,
    relatedFiles,
    stats: {
      nodes: allSymbols.length,
      edges: relations.length,
      files: relatedFiles.length,
    },
  };
}

export function qualityWithPersistedSemantic(
  quality: CodeGraphProviderQuality,
  status: Pick<CodeGraphStatus, 'semanticSymbols' | 'semanticEdges' | 'parserErrors'>,
): CodeGraphProviderQuality {
  const hasSemantic = status.semanticSymbols > 0 || status.semanticEdges > 0;
  const semantic = {
    state: status.parserErrors > 0 ? 'partial' as const : !hasSemantic ? 'not-indexed' as const : 'ready' as const,
    symbols: status.semanticSymbols,
    edges: status.semanticEdges,
    parserErrors: status.parserErrors,
  };
  return {
    ...quality,
    semantic,
    ...(hasSemantic && quality.selected !== 'external'
      ? { selected: 'semantic' as const, selectedQuality: 'semantic' as const }
      : {}),
  };
}
