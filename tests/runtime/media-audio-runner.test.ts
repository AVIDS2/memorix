import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseMediaAudioRunnerRequest } from '../../src/runtime/media-audio-runner.js';

describe('media audio runner request', () => {
  it('accepts a fully bound local project request', () => {
    expect(parseMediaAudioRunnerRequest(JSON.stringify({
      projectId: 'test/project', projectRoot: path.resolve('project'), dataDir: path.resolve('data'), mediaJobId: 'job-1',
    }))).toMatchObject({ projectId: 'test/project', mediaJobId: 'job-1' });
  });

  it('rejects relative paths and malformed payloads', () => {
    expect(() => parseMediaAudioRunnerRequest('{}')).toThrow('invalid request');
    expect(() => parseMediaAudioRunnerRequest(JSON.stringify({
      projectId: 'test/project', projectRoot: 'relative', dataDir: 'relative', mediaJobId: 'job-1',
    }))).toThrow('invalid request');
  });
});
