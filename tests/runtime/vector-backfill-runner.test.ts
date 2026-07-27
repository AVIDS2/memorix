import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

import {
  launchDetachedVectorBackfill,
  parseVectorBackfillRequest,
  resolveVectorBackfillRunnerPath,
} from '../../src/runtime/vector-backfill-runner.js';

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
    expect(spawn).toHaveBeenCalledWith(
      process.execPath,
      ['E:/pkg/dist/vector-backfill-runner.js'],
      expect.objectContaining({
        cwd: request.projectRoot,
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
        env: expect.objectContaining({
          MEMORIX_VECTOR_BACKFILL_REQUEST: JSON.stringify(request),
        }),
      }),
    );
    expect(unref).toHaveBeenCalledOnce();
  });
});
