import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_EXTERNAL_CODEGRAPH_TIMEOUT_MS,
  MAX_EXTERNAL_CODEGRAPH_OUTPUT_BYTES,
  EXTERNAL_CODEGRAPH_LIFECYCLE_TIMEOUT_MS,
  getExternalCodeGraphContext,
  inspectExternalCodeGraph,
  runExternalCodeGraphLifecycle,
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

function exploreText(): string {
  return [
    '## Code Context',
    '',
    '### Entry Points',
    '',
    '- **requireAuthenticatedUser** (function) - src/auth.ts:2',
    '',
    '### Related Symbols',
    '',
    '- src/auth.ts: validateToken:1',
    '',
    '**Relationships**',
    '',
    '**calls:**',
    '- requireAuthenticatedUser \u2192 validateToken',
  ].join('\n');
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

  it('accepts a bounded SCIP JSON result through the same external outline boundary', async () => {
    const projectRoot = makeProject();
    const runner = runnerFor(projectRoot, JSON.stringify({
      documents: [
        {
          relativePath: 'src/auth.ts',
          language: 'TypeScript',
          symbols: [
            {
              symbol: 'scip auth/requireAuthenticatedUser.',
              displayName: 'requireAuthenticatedUser',
              kind: 'function',
              relationships: [{ symbol: 'scip auth/validateToken.', isReference: true }],
            },
          ],
          occurrences: [{ symbol: 'scip auth/requireAuthenticatedUser.', isDefinition: true, range: [1, 0, 1, 10] }],
        },
        {
          relativePath: 'src/validate.ts',
          language: 'TypeScript',
          symbols: [{ symbol: 'scip auth/validateToken.', displayName: 'validateToken', kind: 'function' }],
        },
      ],
    }));

    const result = await getExternalCodeGraphContext({
      projectRoot,
      task: 'trace authentication',
      runner,
    });

    expect(result.outline).toMatchObject({
      provider: 'external',
      relatedFiles: expect.arrayContaining(['src/auth.ts', 'src/validate.ts']),
      relations: [{ kind: 'references', line: 2 }],
    });
  });

  it('falls back from an unknown context command to the official explore command', async () => {
    const projectRoot = makeProject();
    const runner: ExternalCodeGraphRunner & { run: ReturnType<typeof vi.fn> } = {
      run: vi.fn(async ({ args }: { args: string[] }) => {
        if (args[0] === 'status') return { ok: true, stdout: status(projectRoot) };
        if (args[0] === 'context') return { ok: false, stdout: '', stderr: 'unknown command: context', exitCode: 1 };
        return { ok: true, stdout: exploreText() };
      }),
    };

    const result = await getExternalCodeGraphContext({
      projectRoot,
      task: 'trace authenticated user validation',
      runner,
    });

    expect(result.quality).toMatchObject({ selected: 'external', selectedQuality: 'semantic' });
    expect(result.outline).toMatchObject({
      provider: 'external',
      relatedFiles: ['src/auth.ts'],
      relations: [{ kind: 'calls' }],
    });
    expect(result.diagnostics).toMatchObject({
      context: { outcome: 'failed' },
      explore: { outcome: 'success' },
    });
    expect(runner.run.mock.calls[2][0]).toMatchObject({
      args: ['explore', '--path', projectRoot, '--max-files', '4', 'trace authenticated user validation'],
      cwd: projectRoot,
    });
  });

  it('reports separate context and explore failures without claiming external readiness', async () => {
    const projectRoot = makeProject();
    const runner: ExternalCodeGraphRunner = {
      run: vi.fn(async ({ args }: { args: string[] }) => {
        if (args[0] === 'status') return { ok: true, stdout: status(projectRoot) };
        return { ok: false, stdout: '', stderr: `failed ${args[0]}`, exitCode: 1 };
      }),
    };

    const result = await getExternalCodeGraphContext({ projectRoot, task: 'trace auth', runner });

    expect(result.quality).toMatchObject({ selected: 'lite', external: { state: 'unavailable' } });
    expect(result.outline).toBeUndefined();
    expect(result.diagnostics).toMatchObject({
      context: { outcome: 'failed' },
      explore: { outcome: 'failed' },
    });
    expect(result.caution).toContain('context');
    expect(result.caution).toContain('explore');
  });

  it('keeps timeout and output-limit diagnostics bounded for both context paths', async () => {
    const projectRoot = makeProject();
    const timeout: ExternalCodeGraphRunner = {
      run: vi.fn(async ({ args }: { args: string[] }) => args[0] === 'status'
        ? { ok: true, stdout: status(projectRoot) }
        : { ok: false, stdout: '', timedOut: true }),
    };
    const timeoutResult = await getExternalCodeGraphContext({ projectRoot, task: 'trace auth', runner: timeout });
    expect(timeoutResult.diagnostics).toMatchObject({
      context: { outcome: 'timed-out' },
      explore: { outcome: 'timed-out' },
    });
    expect(timeoutResult.quality.external.state).toBe('timed-out');

    const outputLimited: ExternalCodeGraphRunner = {
      run: vi.fn(async ({ args }: { args: string[] }) => args[0] === 'status'
        ? { ok: true, stdout: status(projectRoot) }
        : { ok: false, stdout: '', outputLimited: true }),
    };
    const limitedResult = await getExternalCodeGraphContext({ projectRoot, task: 'trace auth', runner: outputLimited });
    expect(limitedResult.diagnostics).toMatchObject({
      context: { outcome: 'output-limited' },
      explore: { outcome: 'output-limited' },
    });
    expect(limitedResult.quality.external.state).toBe('invalid');
    expect(DEFAULT_EXTERNAL_CODEGRAPH_TIMEOUT_MS).toBeGreaterThan(1_200);
    expect(DEFAULT_EXTERNAL_CODEGRAPH_TIMEOUT_MS).toBeLessThanOrEqual(5_000);
  });

  it('rejects unsafe paths and relations from an explore fallback', async () => {
    const projectRoot = makeProject();
    const unsafe = JSON.stringify({
      ...JSON.parse(outline()),
      entryPoints: [{
        ...JSON.parse(outline()).entryPoints[0],
        filePath: '../outside.ts',
      }],
    });
    const runner: ExternalCodeGraphRunner = {
      run: vi.fn(async ({ args }: { args: string[] }) => {
        if (args[0] === 'status') return { ok: true, stdout: status(projectRoot) };
        if (args[0] === 'context') return { ok: false, stdout: '', stderr: 'unknown command', exitCode: 1 };
        return { ok: true, stdout: unsafe };
      }),
    };

    const result = await getExternalCodeGraphContext({ projectRoot, task: 'trace auth', runner });

    expect(result.outline).toBeUndefined();
    expect(result.quality).toMatchObject({ selected: 'lite', external: { state: 'invalid' } });
    expect(result.diagnostics).toMatchObject({ explore: { outcome: 'invalid-output' } });
    expect(result.caution).toContain('Lite structural evidence');
  });

  it('stays quiet when a project has not opted into a local CodeGraph index', async () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), 'memorix-no-external-codegraph-'));
    root = projectRoot;
    const runner = runnerFor(projectRoot);

    const result = await inspectExternalCodeGraph({ projectRoot, runner });

    expect(result.quality).toMatchObject({ selected: 'lite', external: { state: 'not-detected' } });
    expect(runner.run).not.toHaveBeenCalled();
  });

  it('requires explicit initialization before sync and never invokes agent installation', async () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), 'memorix-external-codegraph-lifecycle-'));
    root = projectRoot;
    const runner: ExternalCodeGraphRunner & { run: ReturnType<typeof vi.fn> } = {
      run: vi.fn(async () => ({ ok: true, stdout: '' })),
    };

    const sync = await runExternalCodeGraphLifecycle({ projectRoot, action: 'sync', runner });
    expect(sync).toMatchObject({ action: 'sync', performed: false, health: { state: 'not-detected' } });
    expect(runner.run).not.toHaveBeenCalled();

    const init = await runExternalCodeGraphLifecycle({ projectRoot, action: 'init', runner });
    expect(init.action).toBe('init');
    expect(init.performed).toBe(true);
    expect(runner.run.mock.calls[0][0].args).toEqual(['init', projectRoot]);
    expect(runner.run.mock.calls[0][0].timeoutMs).toBe(EXTERNAL_CODEGRAPH_LIFECYCLE_TIMEOUT_MS);
    expect(runner.run.mock.calls.flatMap(call => call[0].args)).not.toContain('install');
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
