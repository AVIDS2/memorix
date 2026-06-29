import type { CodeRefStatus } from './types.js';

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
