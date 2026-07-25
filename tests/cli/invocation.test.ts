import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { normalizeCliInvocation } from '../../src/cli/invocation.js';

describe('CLI invocation normalization', () => {
  const originalArgv = process.argv;
  const originalCwd = process.cwd();
  const originalProjectRoot = process.env.MEMORIX_CLI_PROJECT_ROOT;
  const originalActorId = process.env.MEMORIX_CLI_ACTOR_ID;
  const cleanupRoots: string[] = [];

  afterEach(() => {
    process.argv = originalArgv;
    process.chdir(originalCwd);
    if (originalProjectRoot === undefined) delete process.env.MEMORIX_CLI_PROJECT_ROOT;
    else process.env.MEMORIX_CLI_PROJECT_ROOT = originalProjectRoot;
    if (originalActorId === undefined) delete process.env.MEMORIX_CLI_ACTOR_ID;
    else process.env.MEMORIX_CLI_ACTOR_ID = originalActorId;
    for (const root of cleanupRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('binds a common project root and normalizes shell-native flag spellings before command parsing', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'memorix-cli-invocation-'));
    cleanupRoots.push(root);
    const invocation = normalizeCliInvocation([
      'node',
      'memorix',
      'session',
      'start',
      '--cwd',
      root,
      '--as',
      'agent-123',
      '--agent-type',
      'codex',
      '--join-team',
      '--instance-id=local-terminal',
    ]);

    expect(invocation).toEqual({ projectRoot: root, actorId: 'agent-123' });
    expect(process.cwd()).toBe(root);
    expect(process.env.MEMORIX_CLI_PROJECT_ROOT).toBe(root);
    expect(process.env.MEMORIX_CLI_ACTOR_ID).toBe('agent-123');
    expect(process.argv.slice(2)).toEqual([
      'session',
      'start',
      '--agentType',
      'codex',
      '--joinTeam',
      '--instanceId=local-terminal',
    ]);
  });

  it('rejects a nonexistent --cwd before a command can run', () => {
    expect(() => normalizeCliInvocation([
      'node',
      'memorix',
      'memory',
      'search',
      '--cwd',
      path.join(tmpdir(), 'memorix-path-does-not-exist'),
    ])).toThrow('CLI project directory does not exist');
  });

  it('preserves command-owned dashed flags instead of rewriting their meaning globally', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'memorix-cli-invocation-'));
    cleanupRoots.push(root);
    normalizeCliInvocation([
      'node',
      'memorix',
      'uninstall',
      '--cwd',
      root,
      '--dry-run',
    ]);

    expect(process.argv.slice(2)).toEqual(['uninstall', '--dry-run']);
  });
});
