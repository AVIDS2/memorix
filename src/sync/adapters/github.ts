import type { ChangeBatch, SyncCompactReport, SyncPullPage, SyncRemote } from '../types.js';
import { comparePageKey, decodePageCursor, encodePageCursor } from '../paging.js';
import { isSafeSyncDeviceId } from '../namespace.js';

interface GitHubRemoteOptions {
  repo: string;
  token: string;
  branch: string;
  namespace: string;
  apiBaseUrl: string;
}

interface GitHubTreeEntry {
  path?: string;
  type?: string;
  sha?: string;
}

interface GitHubTreeResponse {
  tree?: GitHubTreeEntry[];
  truncated?: boolean;
}

interface GitHubRefResponse {
  object?: { sha?: string };
}

interface GitHubCommitResponse {
  tree?: { sha?: string };
}

interface GitHubContentResponse {
  content?: string;
  encoding?: string;
}

/**
 * GitHub is an event relay only. It never receives memorix.db or a WAL file.
 * Each batch is an immutable JSONL blob under one project/device namespace.
 */
export class GitHubRemote implements SyncRemote {
  readonly kind = 'github';
  readonly namespace: string;
  private branchExists = false;

  constructor(private readonly options: GitHubRemoteOptions) {
    this.namespace = options.namespace;
  }

  async init(options: { create?: boolean } = {}): Promise<void> {
    this.branchExists = false;
    const repository = await this.request<{ default_branch?: string }>(`/repos/${this.options.repo}`);
    const branch = encodeURIComponent(this.options.branch);
    try {
      const ref = await this.request<GitHubRefResponse>(`/repos/${this.options.repo}/git/ref/heads/${branch}`);
      if (!ref.object?.sha) throw new Error('[memorix] GitHub relay returned a branch without a commit');
      this.branchExists = true;
    } catch (error) {
      if (!isStatus(error, 404) || !repository.default_branch) throw error;
      if (options.create === false) return;
      const base = await this.request<{ object?: { sha?: string } }>(
        `/repos/${this.options.repo}/git/ref/heads/${encodeURIComponent(repository.default_branch)}`,
      );
      if (!base.object?.sha) throw new Error('[memorix] GitHub relay could not resolve the default branch');
      await this.request(`/repos/${this.options.repo}/git/refs`, {
        method: 'POST',
        body: JSON.stringify({ ref: `refs/heads/${this.options.branch}`, sha: base.object.sha }),
      });
      this.branchExists = true;
    }
  }

  async push(batch: ChangeBatch): Promise<void> {
    assertBatchNamespace(batch, this.namespace);
    if (!this.branchExists) throw new Error('[memorix] GitHub sync remote is not initialized for writes');
    const path = `events/${this.namespace}/${encodeURIComponent(batch.deviceId)}/${String(batch.sequence).padStart(20, '0')}.jsonl`;
    const body = Buffer.from(`${JSON.stringify(batch)}\n`, 'utf8').toString('base64');
    const apiPath = `/repos/${this.options.repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}`;
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await this.request(apiPath, {
          method: 'PUT',
          body: JSON.stringify({
            message: `memorix sync ${this.namespace}/${batch.deviceId}/${batch.sequence}`,
            content: body,
            branch: this.options.branch,
          }),
        });
        return;
      } catch (error) {
        lastError = error;
        if (!isStatus(error, 409) && !isStatus(error, 422)) throw error;
        // A previous process may have committed the immutable event before a
        // network retry reached us. Treat an identical existing blob as a
        // successful idempotent write; reject a different payload.
        const existing = await this.request<GitHubContentResponse>(`${apiPath}?ref=${encodeURIComponent(this.options.branch)}`);
        if (existing.encoding === 'base64' && normalizeBase64(existing.content) === normalizeBase64(body)) return;
        throw new Error('[memorix] GitHub relay event path already contains a different payload');
      }
    }
    throw lastError instanceof Error ? lastError : new Error('[memorix] GitHub relay push failed');
  }

  async pull(since: Record<string, number>, limit: number, pageToken?: string): Promise<SyncPullPage> {
    assertLimit(limit);
    if (!this.branchExists) return { batches: [], hasMore: false };
    const tree = await this.getTree();
    if (tree.truncated) throw new Error('[memorix] GitHub relay tree is too large; compact the sync repository first');

    const objects = (tree.tree ?? [])
      .filter((entry): entry is { path: string; type: 'blob'; sha?: string } => typeof entry.path === 'string' && entry.type === 'blob')
      .map((entry) => {
        const prefix = `events/${this.namespace}/`;
        if (!entry.path.startsWith(prefix)) return undefined;
        const match = new RegExp(`^events/${escapeRegExp(this.namespace)}/([^/]+)/(\\d+)\\.jsonl$`).exec(entry.path);
        if (!match) return undefined;
        return { path: entry.path, sha: entry.sha, deviceId: decodeURIComponent(match[1]), sequence: Number(match[2]) };
      })
      .filter((entry): entry is { path: string; sha: string | undefined; deviceId: string; sequence: number } => entry !== undefined)
      .filter((entry) => Number.isSafeInteger(entry.sequence) && entry.sequence > (since[entry.deviceId] ?? 0))
      .sort((left, right) => left.deviceId === right.deviceId
        ? left.sequence - right.sequence
        : left.deviceId < right.deviceId ? -1 : 1);

    const after = decodePageCursor(pageToken);
    const visibleObjects = objects.filter((object) => !after || comparePageKey(object, after) > 0);
    const pageObjects = visibleObjects.slice(0, limit);
    const batches: ChangeBatch[] = [];
    for (const object of pageObjects) {
      const path = object.path.split('/').map(encodeURIComponent).join('/');
      const content = await this.request<GitHubContentResponse>(
        `/repos/${this.options.repo}/contents/${path}?ref=${encodeURIComponent(this.options.branch)}`,
      );
      if (content.encoding !== 'base64' || typeof content.content !== 'string') {
        throw new Error('[memorix] GitHub relay returned a non-base64 event object');
      }
      const text = Buffer.from(content.content.replace(/\s/g, ''), 'base64').toString('utf8');
      for (const line of text.split(/\r?\n/).filter(Boolean)) batches.push(JSON.parse(line) as ChangeBatch);
    }
    const hasMore = visibleObjects.length > pageObjects.length;
    return {
      batches,
      hasMore,
      nextPageToken: hasMore && pageObjects.length > 0
        ? encodePageCursor(pageObjects[pageObjects.length - 1])
        : undefined,
    };
  }

  async compact(through: Record<string, number>, options: { dryRun?: boolean } = {}): Promise<SyncCompactReport> {
    if (!this.branchExists) return { candidates: 0, deleted: 0 };
    const tree = await this.getTree();
    const objects = (tree.tree ?? []).flatMap((entry) => {
      if (!entry.path || !entry.sha) return [];
      const match = new RegExp(`^events/${escapeRegExp(this.namespace)}/([^/]+)/(\\d+)\\.jsonl$`).exec(entry.path);
      if (!match) return [];
      const sequence = Number(match[2]);
      return sequence <= (through[decodeURIComponent(match[1])] ?? -1) ? [{ path: entry.path, sha: entry.sha }] : [];
    });
    if (!options.dryRun) {
      for (const object of objects) {
        const path = object.path.split('/').map(encodeURIComponent).join('/');
        await this.request(`/repos/${this.options.repo}/contents/${path}`, {
          method: 'DELETE',
          body: JSON.stringify({ message: `memorix compact ${this.namespace}`, sha: object.sha, branch: this.options.branch }),
        });
      }
    }
    return { candidates: objects.length, deleted: options.dryRun ? 0 : objects.length };
  }

  async close(): Promise<void> {}

  private async getTree(): Promise<GitHubTreeResponse> {
    if (!this.branchExists) return { tree: [] };
    const ref = await this.request<GitHubRefResponse>(
      `/repos/${this.options.repo}/git/ref/heads/${encodeURIComponent(this.options.branch)}`,
    );
    const commitSha = ref.object?.sha;
    if (!commitSha) throw new Error('[memorix] GitHub relay returned a branch without a commit');
    const commit = await this.request<GitHubCommitResponse>(
      `/repos/${this.options.repo}/git/commits/${encodeURIComponent(commitSha)}`,
    );
    if (!commit.tree?.sha) throw new Error('[memorix] GitHub relay could not resolve the branch tree');
    return this.request<GitHubTreeResponse>(
      `/repos/${this.options.repo}/git/trees/${encodeURIComponent(commit.tree.sha)}?recursive=1`,
    );
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${this.options.apiBaseUrl}${path}`, {
      ...init,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${this.options.token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      const error = new Error(`[memorix] GitHub relay HTTP ${response.status}${detail ? `: ${detail.slice(0, 240)}` : ''}`);
      Object.assign(error, { status: response.status });
      throw error;
    }
    return await response.json() as T;
  }
}

function assertBatchNamespace(batch: ChangeBatch, namespace: string): void {
  if (batch.namespace !== namespace) {
    throw new Error('[memorix] sync batch namespace does not match the GitHub relay');
  }
  if (!isSafeSyncDeviceId(batch.deviceId)) {
    throw new Error('[memorix] sync batch has an invalid device id');
  }
}

function assertLimit(limit: number): void {
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new Error('[memorix] sync pull limit must be a positive integer');
  }
}

export function createGitHubRemote(
  namespace: string,
  env: NodeJS.ProcessEnv = process.env,
): GitHubRemote {
  const repo = required(env, 'MEMORIX_SYNC_GITHUB_REPO');
  if (!/^[^/]+\/[^/]+$/.test(repo)) throw new Error('MEMORIX_SYNC_GITHUB_REPO must be owner/repository');
  return new GitHubRemote({
    namespace,
    repo,
    token: required(env, 'MEMORIX_SYNC_GITHUB_TOKEN'),
    branch: env.MEMORIX_SYNC_GITHUB_BRANCH?.trim() || 'memorix-sync',
    apiBaseUrl: env.MEMORIX_SYNC_GITHUB_API_URL?.trim() || 'https://api.github.com',
  });
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`[memorix] GitHub sync requires ${name}`);
  return value;
}

function isStatus(error: unknown, status: number): boolean {
  return typeof error === 'object' && error !== null && (error as { status?: unknown }).status === status;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeBase64(value: string | undefined): string {
  return (value ?? '').replace(/\s/g, '');
}
