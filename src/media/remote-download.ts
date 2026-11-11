import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const DEFAULT_DOWNLOAD_TIMEOUT_MS = 60_000;

export interface DownloadProviderMediaInput {
  url: string;
  maxBytes: number;
  timeoutMs?: number;
}

export interface ProviderMediaDownloadDependencies {
  fetch?: typeof fetch;
  resolveHost?: (hostname: string) => Promise<string[]>;
}

function blockedAddress(address: string): boolean {
  const normalized = address.replace(/^\[|\]$/g, '').toLowerCase();
  if (!isIP(normalized)) return true;
  if (normalized === '::' || normalized === '::1' || normalized.startsWith('fe80:') || /^f[cd][0-9a-f:]*$/i.test(normalized)) {
    return true;
  }
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(normalized)) return false;
  const [first, second] = normalized.split('.').map(Number);
  return first === 0
    || first === 10
    || first === 127
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168)
    || first >= 224;
}

function parseProviderUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Provider returned an invalid media download URL');
  }
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error('Provider returned an unsafe media download URL');
  }
  return url;
}

async function defaultResolveHost(hostname: string): Promise<string[]> {
  const results = await lookup(hostname, { all: true, verbatim: true });
  return results.map((item) => item.address);
}

async function readBoundedBody(response: Response, maxBytes: number): Promise<Buffer> {
  const contentLength = response.headers.get('content-length');
  if (contentLength && (!/^\d+$/.test(contentLength) || Number(contentLength) > maxBytes)) {
    throw new Error(`Provider media download exceeds the ${maxBytes}-byte limit`);
  }
  if (!response.body) throw new Error('Provider media download returned an empty response');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) throw new Error(`Provider media download exceeds the ${maxBytes}-byte limit`);
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (total === 0) throw new Error('Provider media download returned an empty response');
  return Buffer.concat(chunks);
}

/**
 * Fetches a temporary provider result without ever accepting arbitrary user
 * URLs. DNS and literal address checks are intentionally fail-closed, and
 * redirect following is disabled so a signed result cannot become an SSRF hop.
 */
export async function downloadProviderMedia(
  input: DownloadProviderMediaInput,
  dependencies: ProviderMediaDownloadDependencies = {},
): Promise<Buffer> {
  if (!Number.isSafeInteger(input.maxBytes) || input.maxBytes < 1) {
    throw new Error('Media download maxBytes must be a positive integer');
  }
  const url = parseProviderUrl(input.url);
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(hostname)
    ? [hostname]
    : await (dependencies.resolveHost ?? defaultResolveHost)(hostname);
  if (addresses.length === 0 || addresses.some(blockedAddress)) {
    throw new Error('Provider media download URL resolved to a private or invalid address');
  }

  const timeoutMs = input.timeoutMs ?? DEFAULT_DOWNLOAD_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 5 * 60_000) {
    throw new Error('Media download timeout must be between 1000 and 300000 milliseconds');
  }
  const response = await (dependencies.fetch ?? fetch)(url, {
    redirect: 'error',
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`Provider media download failed with HTTP ${response.status}`);
  return readBoundedBody(response, input.maxBytes);
}
