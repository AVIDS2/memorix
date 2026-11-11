import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGitHubRemote } from '../../src/sync/adapters/github.js';
import type { ChangeBatch } from '../../src/sync/types.js';

function batch(sequence: number): ChangeBatch {
  return {
    formatVersion: 3,
    namespace: 'project-test',
    projectId: 'p',
    deviceId: 'device-a',
    sequence,
    producedAt: `2026-09-07T00:00:0${sequence}.000Z`,
    entries: [],
  };
}

describe('GitHub JSONL relay', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('creates a relay branch, writes JSONL event blobs, and paginates pulls', async () => {
    const objects = new Map<string, string>();
    const calls: string[] = [];
    let relayBranchExists = false;
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      calls.push(`${method} ${url}`);
      if (url.endsWith('/repos/acme/memory')) return new Response(JSON.stringify({ default_branch: 'main' }), { status: 200 });
      if (url.includes('/git/ref/heads/memorix-sync')) {
        return relayBranchExists
          ? new Response(JSON.stringify({ object: { sha: 'head' } }), { status: 200 })
          : new Response('{}', { status: 404 });
      }
      if (url.includes('/git/ref/heads/main')) return new Response(JSON.stringify({ object: { sha: 'base' } }), { status: 200 });
      if (url.endsWith('/git/refs')) {
        relayBranchExists = true;
        return new Response('{}', { status: 201 });
      }
      if (method === 'PUT' && url.includes('/contents/events/')) {
        const body = JSON.parse(String(init?.body)) as { content: string };
        const path = new URL(url).pathname.split('/contents/')[1];
        objects.set(path, body.content);
        return new Response(JSON.stringify({}), { status: 201 });
      }
      if (url.includes('/git/commits/head')) {
        return new Response(JSON.stringify({ tree: { sha: 'tree' } }), { status: 200 });
      }
      if (url.includes('/git/trees/')) {
        return new Response(JSON.stringify({ tree: [...objects.keys()].map((path) => ({ path, type: 'blob', sha: `sha-${path}` })) }), { status: 200 });
      }
      if (url.includes('/contents/')) {
        const path = new URL(url).pathname.split('/contents/')[1];
        return new Response(JSON.stringify({ encoding: 'base64', content: objects.get(path) }), { status: 200 });
      }
      return new Response('{}', { status: 404 });
    }));

    const remote = createGitHubRemote('project-test', {
      MEMORIX_SYNC_GITHUB_REPO: 'acme/memory',
      MEMORIX_SYNC_GITHUB_TOKEN: 'test-token',
      MEMORIX_SYNC_GITHUB_BRANCH: 'memorix-sync',
      MEMORIX_SYNC_GITHUB_API_URL: 'https://api.github.test',
    });
    await remote.init();
    await remote.push(batch(1));
    await remote.push(batch(2));

    const first = await remote.pull({}, 1);
    expect(first.batches.map((item) => item.sequence)).toEqual([1]);
    expect(first.hasMore).toBe(true);
    const second = await remote.pull({}, 1, first.nextPageToken);
    expect(second.batches.map((item) => item.sequence)).toEqual([2]);
    expect(second.hasMore).toBe(false);
    expect(calls.some((call) => call.includes('memorix.db'))).toBe(false);
  });

  it('requires explicit repository credentials', () => {
    expect(() => createGitHubRemote('project-test', {})).toThrow(/MEMORIX_SYNC_GITHUB_REPO/);
  });
});
