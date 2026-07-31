import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

import {
  launchDetachedVectorBackfill,
  parseVectorBackfillRequest,
  resolveVectorBackfillRunnerPath,
} from '../../src/runtime/vector-backfill-runner.js';

type SpawnOptions = {
  cwd?: string;
  detached?: boolean;
  stdio?: unknown;
  windowsHide?: boolean;
  env?: NodeJS.ProcessEnv;
};

describe('detached vector backfill runner', () => {
  const request = {
    projectId: 'AVIDS2/memorix',
    projectRoot: path.resolve('work', 'memorix'),
    dataDir: path.resolve('data', 'memorix'),
  };

  it('resolves the compiled worker beside both library and CLI bundles', () => {
    const distDir = path.resolve('pkg', 'dist');
    const expected = path.join(distDir, 'vector-backfill-runner.js');

    expect(resolveVectorBackfillRunnerPath(pathToFileURL(path.join(distDir, 'index.js')).href)).toBe(expected);
    expect(resolveVectorBackfillRunnerPath(pathToFileURL(path.join(distDir, 'cli', 'index.js')).href)).toBe(expected);
  });

  it('accepts only complete local worker requests', () => {
    expect(parseVectorBackfillRequest(JSON.stringify(request))).toEqual(request);
    expect(() => parseVectorBackfillRequest('{"projectId":"missing-paths"}')).toThrow(/invalid/i);
    expect(() => parseVectorBackfillRequest('not json')).toThrow(/invalid json/i);
  });

  it('detaches the worker so a short-lived CLI never waits on an embedding request', () => {
    const unref = vi.fn();
    const spawn = vi.fn(() => ({ unref }));

    const started = launchDetachedVectorBackfill(request, {
      runnerPath: 'E:/pkg/dist/vector-backfill-runner.js',
      exists: () => true,
      spawn: spawn as never,
    });

    expect(started).toBe(true);
    expect(spawn).toHaveBeenCalledOnce();
    const [command, args, rawOptions] = spawn.mock.calls[0]!;
    const options = rawOptions as SpawnOptions;
    expect(command).toBe(process.execPath);
    expect(args).toEqual(['E:/pkg/dist/vector-backfill-runner.js']);
    expect(options.cwd).toBe(request.projectRoot);
    expect(options.detached).toBe(process.platform !== 'win32');
    expect(options.stdio).toBe('ignore');
    expect(options.windowsHide).toBe(true);
    expect(options.env?.MEMORIX_VECTOR_BACKFILL_REQUEST).toBe(JSON.stringify(request));
    expect(unref).toHaveBeenCalledOnce();
  });

  it('does not create a detached Windows console for a recoverable backfill job', () => {
    const platform = Object.getOwnPropertyDescriptor(process, 'platform');
    const unref = vi.fn();
    const spawn = vi.fn(() => ({ unref }));

    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    try {
      const started = launchDetachedVectorBackfill(request, {
        runnerPath: 'E:/pkg/dist/vector-backfill-runner.js',
        exists: () => true,
        spawn: spawn as never,
      });

      expect(started).toBe(true);
      expect(spawn).toHaveBeenCalledOnce();
      const [command, args, rawOptions] = spawn.mock.calls[0]!;
      const options = rawOptions as SpawnOptions;
      expect(command).toBe(process.execPath);
      expect(args).toEqual(['E:/pkg/dist/vector-backfill-runner.js']);
      expect(options.detached).toBe(false);
      expect(options.stdio).toBe('ignore');
      expect(options.windowsHide).toBe(true);
      expect(unref).toHaveBeenCalledOnce();
    } finally {
      Object.defineProperty(process, 'platform', platform!);
    }
  });
});
