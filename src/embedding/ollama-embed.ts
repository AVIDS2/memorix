/**
 * Ollama's OpenAI-compatible `/v1/embeddings` route does not honor `keep_alive`,
 * so the embedding model inherits the process-wide `OLLAMA_KEEP_ALIVE`. The
 * native `/api/embed` route honors the field. Recognition is the origin's
 * `GET /api/version` payload, not a port number.
 */

export const OLLAMA_EMBED_KEEP_ALIVE = '5m';

const ollamaOrigins = new Map<string, boolean>();

export type OllamaProbeOptions = {
  signal?: AbortSignal;
  /** Max time for `GET /api/version`; capped by caller embedding timeout when provided. */
  probeTimeoutMs?: number;
};

export function clearOllamaOriginCache(): void {
  ollamaOrigins.clear();
}

export async function routeOllamaEmbedding(
  url: string,
  body: Record<string, unknown>,
  fetchImpl: typeof fetch = fetch,
  probeOptions?: OllamaProbeOptions,
): Promise<{ url: string; body: Record<string, unknown>; rewritten: boolean }> {
  const parsed = parseUrl(url);
  if (!parsed) return { url, body, rewritten: false };
  const openAIRoute = parsed.pathname.endsWith('/v1/embeddings');
  const nativeRoute = parsed.pathname.endsWith('/api/embed');
  if (!openAIRoute && !nativeRoute) return { url, body, rewritten: false };
  if (!await originServesOllama(parsed.origin, fetchImpl, probeOptions)) return { url, body, rewritten: false };
  if (nativeRoute) return { url, body, rewritten: true };
  parsed.pathname = parsed.pathname.replace(/\/v1\/embeddings$/, '/api/embed');
  return { url: parsed.toString(), body: withEmbeddingKeepAlive(body), rewritten: true };
}

export async function originServesOllama(
  origin: string,
  fetchImpl: typeof fetch = fetch,
  probeOptions?: OllamaProbeOptions,
): Promise<boolean> {
  const cached = ollamaOrigins.get(origin);
  if (cached != null) return cached;
  if (probeOptions?.signal?.aborted) return false;
  try {
    const response = await fetchImpl(`${origin}/api/version`, {
      method: 'GET',
      signal: buildProbeSignal(probeOptions),
    });
    if (!response.ok) {
      ollamaOrigins.set(origin, false);
      return false;
    }
    const detected = isOllamaVersionPayload(await response.json());
    ollamaOrigins.set(origin, detected);
    return detected;
  } catch (err: unknown) {
    if (isAbortError(err) || probeOptions?.signal?.aborted) return false;
    ollamaOrigins.set(origin, false);
    return false;
  }
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

function withEmbeddingKeepAlive(body: Record<string, unknown>): Record<string, unknown> {
  if (body.keep_alive != null && body.keep_alive !== '') return body;
  return { ...body, keep_alive: OLLAMA_EMBED_KEEP_ALIVE };
}

function isOllamaVersionPayload(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') return false;
  const version = (payload as { version?: unknown }).version;
  return typeof version === 'string' && /^\d+\.\d+\.\d+/.test(version);
}

function parseUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

function buildProbeSignal(probeOptions?: OllamaProbeOptions): AbortSignal {
  const timeoutMs = Math.max(
    1,
    Math.min(
      typeof probeOptions?.probeTimeoutMs === 'number' && Number.isFinite(probeOptions.probeTimeoutMs)
        ? Math.floor(probeOptions.probeTimeoutMs)
        : 1000,
      60_000,
    ),
  );
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  if (probeOptions?.signal) return AbortSignal.any([probeOptions.signal, timeoutSignal]);
  return timeoutSignal;
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}
