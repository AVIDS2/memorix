import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_EXTERNAL_CODEGRAPH_OUTPUT_BYTES,
  getExternalCodeGraphContext,
  inspectExternalCodeGraph,
  type ExternalCodeGraphRunner,
} from '../../src/codegraph/external-provider.js';

let root: string | null = null;

function makeProject(): string {
  root = mkdtempSync(path.join(tmpdir(), 'memorix-external-codegraph-'));
  mkdirSync(path.join(root, '.codegraph'), { recursive: true });
  mkdirSync(path.join(root, 'src'), { recursive: true });
  writeFileSync(path.join(root, 'src', 'auth.ts'), [
    'export function validateToken(token: string) { return token.length > 0; }',
    'export function requireAuthenticatedUser(token: string) { return validateToken(token); }',
  ].join('\n'), 'utf8');
  return root;
}

function status(projectPath: string, overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    initialized: true,
    projectPath,
    fileCount: 1,
    nodeCount: 2,
    edgeCount: 1,
    languages: ['typescript'],
    pendingChanges: { added: 0, modified: 0, removed: 0 },
    worktreeMismatch: null,
    ...overrides,
  });
}

function outline(): string {
  return JSON.stringify({
    query: 'trace authentication',
    entryPoints: [{
      id: 'function:require-auth',
      kind: 'function',
      name: 'requireAuthenticatedUser',
      qualifiedName: 'requireAuthenticatedUser',
      filePath: 'src/auth.ts',
      language: 'typescript',
      startLine: 2,
      endLine: 2,
    }],
    nodes: [{
      id: 'function:validate-token',
      kind: 'function',
      name: 'validateToken',
      qualifiedName: 'validateToken',
      filePath: 'src/auth.ts',
      language: 'typescript',
      startLine: 1,
      endLine: 1,
    }],
    edges: [{
      source: 'function:require-auth',
      target: 'function:validate-token',
      kind: 'calls',
      line: 2,
    }],
    codeBlocks: [],
    relatedFiles: ['src/auth.ts'],
    stats: { nodeCount: 2, edgeCount: 1, fileCount: 1 },
  });
}

function runnerFor(projectRoot: string, context = outline(), statusPayload = status(projectRoot)): ExternalCodeGraphRunner & { run: ReturnType<typeof vi.fn> } {
  return {
    run: vi.fn(async ({ args }: { args: string[] }) => ({
      ok: true,
      stdout: args[0] === 'status' ? statusPayload : context,
    })),
  };
}

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = null;
});

describe('external CodeGraph provider', () => {
  it('adds only a bounded semantic outline from a healthy local graph', async () => {
    const projectRoot = makeProject();
    const runner = runnerFor(projectRoot);

    const result = await getExternalCodeGraphContext({
      projectRoot,
      task: 'trace authenticated user validation',
      runner,
    });

    expect(result.quality).toMatchObject({
      selected: 'external',
      selectedQuality: 'semantic',
      external: { state: 'ready' },
      lite: { capabilities: { resolvedRelations: false } },
    });
    expect(result.outline).toMatchObject({
      provider: 'external',
      relatedFiles: ['src/auth.ts'],
      relations: [{ kind: 'calls', from: { name: 'requireAuthenticatedUser' }, to: { name: 'validateToken' } }],
    });
    expect(runner.run).toHaveBeenCalledTimes(2);
    expect(runner.run.mock.calls[1][0].args).toEqual([
      'context', '--path', projectRoot, '--format', 'json', '--max-nodes', '8', '--no-code',
      'trace authenticated user validation',
    ]);
  });

  it('stays quiet when a project has not opted into a local CodeGraph index', async () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), 'memorix-no-external-codegraph-'));
    root = projectRoot;
    const runner = runnerFor(projectRoot);

    const result = await inspectExternalCodeGraph({ projectRoot, runner });

    expect(result.quality).toMatchObject({ selected: 'lite', external: { state: 'not-detected' } });
    expect(runner.run).not.toHaveBeenCalled();
  });

  it('falls back when the external index has pending changes', async () => {
    const projectRoot = makeProject();
    const runner = runnerFor(projectRoot, outline(), status(projectRoot, {
      pendingChanges: { added: 0, modified: 1, removed: 0 },
    }));

    const result = await getExternalCodeGraphContext({ projectRoot, task: 'trace auth', runner });

    expect(result.quality).toMatchObject({ selected: 'lite', external: { state: 'stale' } });
    expect(result.outline).toBeUndefined();
    expect(result.caution).toContain('using Lite structural evidence');
    expect(runner.run).toHaveBeenCalledTimes(1);
  });

  it('recognizes CodeGraph\'s minimal pre-index status without adding prompt noise', async () => {
    const projectRoot = makeProject();
    const runner = runnerFor(projectRoot, outline(), JSON.stringify({ initialized: false, projectPath: projectRoot }));

    const result = await getExternalCodeGraphContext({ projectRoot, task: 'trace auth', runner });

    expect(result.quality).toMatchObject({ selected: 'lite', external: { state: 'not-initialized' } });
    expect(result.caution).toBeUndefined();
    expect(runner.run).toHaveBeenCalledTimes(1);
  });

  it('rejects a status payload for another project root', async () => {
    const projectRoot = makeProject();
    const runner = runnerFor(projectRoot, outline(), status(path.join(projectRoot, 'other')));

    const result = await inspectExternalCodeGraph({ projectRoot, runner });

    expect(result.quality).toMatchObject({ selected: 'lite', external: { state: 'invalid' } });
  });

  it('rejects raw code blocks and keeps them out of the normalized outline', async () => {
    const projectRoot = makeProject();
    const unsafe = JSON.stringify({
      ...JSON.parse(outline()),
      codeBlocks: [{ content: 'const secret = "do-not-copy";' }],
    });
    const runner = runnerFor(projectRoot, unsafe);

    const result = await getExternalCodeGraphContext({ projectRoot, task: 'trace auth', runner });

    expect(result.outline).toBeUndefined();
    expect(result.quality).toMatchObject({ selected: 'lite', external: { state: 'invalid' } });
  });

  it('rejects oversized or timed-out external responses without throwing', async () => {
    const projectRoot = makeProject();
    const oversized = runnerFor(projectRoot, 'x'.repeat(MAX_EXTERNAL_CODEGRAPH_OUTPUT_BYTES + 1));
    const largeResult = await getExternalCodeGraphContext({ projectRoot, task: 'trace auth', runner: oversized });
    expect(largeResult.quality).toMatchObject({ selected: 'lite', external: { state: 'invalid' } });

    const timeout: ExternalCodeGraphRunner = {
      run: vi.fn(async ({ args }: { args: string[] }) => args[0] === 'status'
        ? { ok: true, stdout: status(projectRoot) }
        : { ok: false, stdout: '', timedOut: true }),
    };
    const timeoutResult = await getExternalCodeGraphContext({ projectRoot, task: 'trace auth', runner: timeout });
    expect(timeoutResult.quality).toMatchObject({ selected: 'lite', external: { state: 'timed-out' } });
    expect(timeoutResult.caution).toContain('timed-out');
  });
});
