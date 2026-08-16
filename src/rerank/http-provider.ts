/**
 * Optional HTTP rerank client.
 *
 * Posts a Cohere-compatible `{model, query, documents}` body to
 * `{base_url}/rerank` (or an explicit `/rerank` path). Compatible with
 * Cohere, Jina, TEI, vLLM, and other `/rerank` endpoints. The model id is
 * whatever the user configured — Memorix does not rewrite it.
 */

export type NeuralRerankProviderName = 'http';

export interface NeuralRerankRequestConfig {
  provider: NeuralRerankProviderName;
  model?: string;
  baseUrl: string;
  apiKey?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export interface RerankedDocument {
  index: number;
  score: number;
}

/**
 * Join a provider base URL with `/rerank`, leaving an explicit path intact.
 */
export function buildRerankUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  if (trimmed.endsWith('/rerank')) return trimmed;
  return `${trimmed}/rerank`;
}

/**
 * Accept Cohere/Jina `{results:[{index,relevance_score}]}` and TEI `[{index,score}]`.
 */
export function parseRerankResponse(payload: unknown): RerankedDocument[] {
  const rows = extractRows(payload);
  if (rows.length === 0) {
    throw new Error('Neural rerank response contained no ranked results');
  }
  return rows.sort((a, b) => b.score - a.score);
}

function extractRows(payload: unknown): RerankedDocument[] {
  if (Array.isArray(payload)) {
    return payload.map(rowFromUnknown).filter((row): row is RerankedDocument => row !== null);
  }
  if (payload && typeof payload === 'object' && 'results' in payload) {
    const results = (payload as { results: unknown }).results;
    if (Array.isArray(results)) {
      return results.map(rowFromUnknown).filter((row): row is RerankedDocument => row !== null);
    }
  }
  throw new Error('Neural rerank response was not Cohere or TEI shaped');
}

function rowFromUnknown(value: unknown): RerankedDocument | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as { index?: unknown; relevance_score?: unknown; score?: unknown };
  if (typeof row.index !== 'number' || !Number.isFinite(row.index)) return null;
  const score = typeof row.relevance_score === 'number'
    ? row.relevance_score
    : typeof row.score === 'number'
      ? row.score
      : null;
  if (score === null || !Number.isFinite(score)) return null;
  return { index: row.index, score };
}

function buildRerankBody(query: string, documents: string[], model?: string): Record<string, unknown> {
  const body: Record<string, unknown> = {
    query,
    documents,
    top_n: documents.length,
    return_documents: false,
  };
  const trimmed = model?.trim();
  if (trimmed) body.model = trimmed;
  return body;
}

/**
 * POST query + documents to a compatible `/rerank` endpoint and return ranked indexes.
 */
export async function rerankViaHttp(
  query: string,
  documents: string[],
  config: NeuralRerankRequestConfig,
): Promise<RerankedDocument[]> {
  if (documents.length === 0) return [];

  const url = buildRerankUrl(config.baseUrl);
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };
  if (config.apiKey) {
    headers.authorization = `Bearer ${config.apiKey}`;
  }

  const controller = new AbortController();
  const timeoutMs = config.timeoutMs && config.timeoutMs > 0 ? config.timeoutMs : 5000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const fetchImpl = config.fetchImpl ?? fetch;
    const response = await fetchImpl(url, {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify(buildRerankBody(query, documents, config.model)),
    });

    if (!response.ok) {
      throw new Error(`Neural rerank HTTP ${response.status} from ${url}`);
    }

    return parseRerankResponse(await response.json());
  } finally {
    clearTimeout(timer);
  }
}
