/**
 * Ollama's OpenAI-compatible `/v1/embeddings` route does not reliably honor
 * `keep_alive`. The native `/api/embed` route does. Callers keep the OpenAI
 * base URL and the OpenAI response shape; only port 11434 is rewritten.
 */

export const OLLAMA_EMBED_KEEP_ALIVE = '5m';

export function adaptOllamaEmbeddingRequest(
  url: string,
  body: Record<string, unknown>,
): { url: string; body: Record<string, unknown> } {
  const parsed = parseUrl(url);
  if (!parsed || !isOllamaEmbeddingsUrl(parsed)) return { url, body };
  parsed.pathname = parsed.pathname.replace(/\/v1\/embeddings$/, '/api/embed');
  const nextBody = { ...body };
  if (nextBody.keep_alive == null || nextBody.keep_alive === '') {
    nextBody.keep_alive = OLLAMA_EMBED_KEEP_ALIVE;
  }
  return { url: parsed.toString(), body: nextBody };
}

export function shouldMapOllamaEmbeddingResponse(url: string): boolean {
  const parsed = parseUrl(url);
  return parsed != null && parsed.port === '11434' && parsed.pathname.endsWith('/api/embed');
}

export function mapOllamaEmbeddingResponse<T>(payload: T): T {
  if (!payload || typeof payload !== 'object') return payload;
  const record = payload as Record<string, unknown>;
  if (Array.isArray(record.data) || !Array.isArray(record.embeddings)) return payload;
  const embeddings = record.embeddings.filter((item): item is number[] => Array.isArray(item));
  return {
    ...record,
    object: 'list',
    data: embeddings.map((embedding, index) => ({
      object: 'embedding',
      index,
      embedding,
    })),
  } as T;
}

function parseUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

function isOllamaEmbeddingsUrl(url: URL): boolean {
  return url.port === '11434' && url.pathname.endsWith('/v1/embeddings');
}
