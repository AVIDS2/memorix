import { describe, expect, it, vi } from 'vitest';

import { downloadProviderMedia } from '../../src/media/remote-download.js';

describe('provider media downloads', () => {
  it('refuses private literal URLs before a network request', async () => {
    const fetchMock = vi.fn();
    await expect(downloadProviderMedia({
      url: 'https://127.0.0.1/private-video.mp4',
      maxBytes: 1_024,
    }, { fetch: fetchMock as typeof fetch })).rejects.toThrow(/private|invalid/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('downloads bounded provider bytes only after a public address resolution', async () => {
    const fetchMock = vi.fn(async () => new Response(Buffer.from('safe bytes'), {
      status: 200,
      headers: { 'content-length': '10' },
    }));
    const result = await downloadProviderMedia({
      url: 'https://cdn.example.test/video.mp4?temporary=1',
      maxBytes: 1_024,
    }, {
      fetch: fetchMock as typeof fetch,
      resolveHost: async () => ['203.0.113.10'],
    });
    expect(result.toString()).toBe('safe bytes');
    expect(fetchMock).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({ redirect: 'error' }));
  });

  it('rejects a response whose declared size exceeds the caller limit', async () => {
    await expect(downloadProviderMedia({
      url: 'https://cdn.example.test/video.mp4',
      maxBytes: 10,
    }, {
      fetch: (async () => new Response(Buffer.alloc(1), {
        status: 200,
        headers: { 'content-length': '11' },
      })) as typeof fetch,
      resolveHost: async () => ['203.0.113.10'],
    })).rejects.toThrow(/exceeds/i);
  });
});
