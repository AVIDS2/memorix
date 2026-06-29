import { evaluateCodeRefFreshness } from './freshness.js';
import type { CodeFile, CodeRefStatus, CodeSymbol, ObservationCodeRef } from './types.js';
import type { CodeGraphStore } from './store.js';

export interface ContextPackMemory {
  id: number;
  title: string;
  type: string;
  status: CodeRefStatus | 'unbound';
  reason: string;
}

export interface ContextPackCodeFact {
  path: string;
  symbol?: string;
  kind?: string;
  line?: number;
}

export interface ContextPackWarning {
  id: number;
  title: string;
  status: CodeRefStatus;
  reason: string;
}

export interface ContextPack {
  task: string;
  memories: ContextPackMemory[];
  codeFacts: ContextPackCodeFact[];
  warnings: ContextPackWarning[];
  suggestedReads: string[];
  suggestedVerification: string[];
}

export interface ContextPackObservation {
  id: number;
  title: string;
  type: string;
  narrative?: string;
  facts?: string[];
  filesModified?: string[];
  concepts?: string[];
  createdAt?: string;
  updatedAt?: string;
}

export interface AssembleContextPackInput {
  task: string;
  observations: ContextPackObservation[];
  refs: ObservationCodeRef[];
  files: CodeFile[];
  symbols: CodeSymbol[];
  suggestedVerification?: string[];
}

function uniq<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9_./-]+|[\u4e00-\u9fff]+/g) ?? [])
    .map(token => token.trim())
    .filter(token => token.length > 1);
}

function timestampOf(observation: ContextPackObservation): number {
  return Date.parse(observation.updatedAt ?? observation.createdAt ?? '') || 0;
}

function relevanceScore(observation: ContextPackObservation, taskTokens: string[]): number {
  if (taskTokens.length === 0) return 0;
  const title = observation.title.toLowerCase();
  const files = (observation.filesModified ?? []).join('\n').toLowerCase();
  const concepts = (observation.concepts ?? []).join('\n').toLowerCase();
  const body = [
    observation.narrative ?? '',
    ...(observation.facts ?? []),
  ].join('\n').toLowerCase();

  let score = 0;
  for (const token of taskTokens) {
    if (title.includes(token)) score += 5;
    if (files.includes(token)) score += 4;
    if (concepts.includes(token)) score += 3;
    if (body.includes(token)) score += 2;
  }
  return score;
}

export function selectRelevantObservations<T extends ContextPackObservation>(
  observations: T[],
  task: string,
  limit: number,
): T[] {
  const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 20;
  const taskTokens = tokenize(task);
  const ranked = observations.map((observation, index) => ({
    observation,
    index,
    score: relevanceScore(observation, taskTokens),
    time: timestampOf(observation),
  }));

  const positives = ranked.filter(item => item.score > 0);
  const pool = positives.length > 0 ? positives : ranked;
  return pool
    .sort((a, b) => b.score - a.score || b.time - a.time || b.index - a.index)
    .slice(0, safeLimit)
    .map(item => item.observation);
}

export function assembleContextPackForTask(input: {
  store: CodeGraphStore;
  projectId: string;
  task: string;
  observations: ContextPackObservation[];
  limit?: number;
  suggestedVerification?: string[];
}): ContextPack {
  const selected = selectRelevantObservations(input.observations, input.task, input.limit ?? 20);
  const refs = selected.flatMap(obs => input.store.listObservationRefs(input.projectId, obs.id));
  const fileIds = new Set(refs.map(ref => ref.fileId).filter(Boolean));
  const files = input.store.listFiles(input.projectId).filter(file => fileIds.has(file.id));
  const symbols = files.flatMap(file => input.store.listSymbolsForFile(file.id));

  return assembleContextPack({
    task: input.task,
    observations: selected,
    refs,
    files,
    symbols,
    suggestedVerification: input.suggestedVerification,
  });
}

export function assembleContextPack(input: AssembleContextPackInput): ContextPack {
  const observations = new Map(input.observations.map((obs) => [obs.id, obs]));
  const files = new Map(input.files.map((file) => [file.id, file]));
  const symbols = new Map(input.symbols.map((symbol) => [symbol.id, symbol]));
  const memories: ContextPackMemory[] = [];
  const codeFacts: ContextPackCodeFact[] = [];
  const warnings: ContextPackWarning[] = [];
  const suggestedReads: string[] = [];
  const memoryKeys = new Set<string>();

  for (const ref of input.refs) {
    const observation = observations.get(ref.observationId);
    if (!observation) continue;

    const file = ref.fileId ? files.get(ref.fileId) : undefined;
    const symbol = ref.symbolId ? symbols.get(ref.symbolId) : undefined;
    const freshness = evaluateCodeRefFreshness(ref, file, symbol);

    if (freshness.status === 'current') {
      const memoryKey = `${observation.id}:${freshness.status}:${freshness.reason}`;
      if (!memoryKeys.has(memoryKey)) {
        memoryKeys.add(memoryKey);
        memories.push({
          id: observation.id,
          title: observation.title,
          type: observation.type,
          status: freshness.status,
          reason: freshness.reason,
        });
      }
      if (file) suggestedReads.push(file.path);
      if (file) {
        codeFacts.push({
          path: file.path,
          ...(symbol ? { symbol: symbol.name, kind: symbol.kind, line: symbol.startLine } : {}),
        });
      }
    } else {
      warnings.push({
        id: observation.id,
        title: observation.title,
        status: freshness.status,
        reason: freshness.reason,
      });
    }
  }

  return {
    task: input.task,
    memories,
    codeFacts,
    warnings,
    suggestedReads: uniq(suggestedReads),
    suggestedVerification: input.suggestedVerification ?? [],
  };
}

export function buildContextPackPrompt(pack: ContextPack): string {
  const lines: string[] = ['## Task', pack.task, '', '## Relevant Memories'];

  if (pack.memories.length === 0) lines.push('- none');
  for (const memory of pack.memories) {
    lines.push(`- #${memory.id} ${memory.status}: [${memory.type}] ${memory.title} (${memory.reason})`);
  }

  lines.push('', '## Current Code Facts');
  if (pack.codeFacts.length === 0) lines.push('- none');
  for (const fact of pack.codeFacts) {
    const location = fact.line ? `${fact.path}:${fact.line}` : fact.path;
    const symbol = fact.symbol ? ` ${fact.symbol}${fact.kind ? ` (${fact.kind})` : ''}` : '';
    lines.push(`- ${location}${symbol}`);
  }

  lines.push('', '## Freshness Warnings');
  if (pack.warnings.length === 0) lines.push('- none');
  for (const warning of pack.warnings) {
    lines.push(`- #${warning.id} ${warning.status}: ${warning.title} (${warning.reason})`);
  }

  lines.push('', '## Suggested Next Reads');
  if (pack.suggestedReads.length === 0) lines.push('- none');
  pack.suggestedReads.forEach((path, index) => lines.push(`${index + 1}. ${path}`));

  lines.push('', '## Suggested Verification');
  if (pack.suggestedVerification.length === 0) lines.push('- none');
  for (const command of pack.suggestedVerification) lines.push(`- ${command}`);

  return lines.join('\n');
}
