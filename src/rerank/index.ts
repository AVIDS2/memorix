/**
 * Optional HTTP rerank lane. LLM fallback lives in quality.ts.
 */

import { getResolvedRerankLane, type ResolvedLaneOptions } from '../config/resolved-config.js';
import { rerankViaHttp } from './http-provider.js';

/** Minimal search hit the HTTP reranker can reorder. */
export interface NeuralRerankCandidate {
  id: string;
  title: string;
  type: string;
  score: number;
  narrative?: string;
}

const MAX_RERANK = 10;

/**
 * True when an HTTP `/rerank` endpoint is configured.
 */
export function isNeuralRerankEnabled(options: ResolvedLaneOptions = {}): boolean {
  const lane = getResolvedRerankLane(options);
  return lane.provider === 'http' && Boolean(lane.baseUrl);
}

/**
 * Reorder search candidates via the configured remote reranker.
 * Returns null when the provider is off or the HTTP call cannot be used.
 */
export async function neuralRerankCandidates(
  query: string,
  candidates: NeuralRerankCandidate[],
  options: ResolvedLaneOptions = {},
): Promise<NeuralRerankCandidate[] | null> {
  if (!isNeuralRerankEnabled(options) || candidates.length === 0) return null;

  const lane = getResolvedRerankLane(options);
  const toRerank = candidates.slice(0, MAX_RERANK);
  const rest = candidates.slice(MAX_RERANK);
  const documents = toRerank.map((candidate) => candidateText(candidate));

  const ranked = await rerankViaHttp(query, documents, {
    provider: 'http',
    model: lane.model,
    baseUrl: lane.baseUrl!,
    apiKey: lane.apiKey,
  });

  const seen = new Set<number>();
  const reranked: NeuralRerankCandidate[] = [];
  for (const row of ranked) {
    const candidate = toRerank[row.index];
    if (!candidate || seen.has(row.index)) continue;
    reranked.push(candidate);
    seen.add(row.index);
  }
  for (const [index, candidate] of toRerank.entries()) {
    if (!seen.has(index)) reranked.push(candidate);
  }
  reranked.push(...rest);
  return reranked;
}

function candidateText(candidate: NeuralRerankCandidate): string {
  const narrative = candidate.narrative?.trim();
  if (narrative) return `${candidate.title} — ${narrative.slice(0, 200)}`;
  return candidate.title;
}
