import { evaluateCodeRefFreshness } from './freshness.js';
import type { CodeFile, CodeRefStatus, CodeSymbol, ObservationCodeRef } from './types.js';

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

export function assembleContextPack(input: AssembleContextPackInput): ContextPack {
  const observations = new Map(input.observations.map((obs) => [obs.id, obs]));
  const files = new Map(input.files.map((file) => [file.id, file]));
  const symbols = new Map(input.symbols.map((symbol) => [symbol.id, symbol]));
  const memories: ContextPackMemory[] = [];
  const codeFacts: ContextPackCodeFact[] = [];
  const warnings: ContextPackWarning[] = [];
  const suggestedReads: string[] = [];

  for (const ref of input.refs) {
    const observation = observations.get(ref.observationId);
    if (!observation) continue;

    const file = ref.fileId ? files.get(ref.fileId) : undefined;
    const symbol = ref.symbolId ? symbols.get(ref.symbolId) : undefined;
    const freshness = evaluateCodeRefFreshness(ref, file, symbol);

    if (freshness.status === 'current') {
      memories.push({
        id: observation.id,
        title: observation.title,
        type: observation.type,
        status: freshness.status,
        reason: freshness.reason,
      });
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
