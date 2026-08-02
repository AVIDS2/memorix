import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseMediaVideoRunnerRequest } from '../../src/runtime/media-video-runner.js';

describe('media video runner request', () => {
  it('accepts a fully bound local project request', () => {
    const request = parseMediaVideoRunnerRequest(JSON.stringify({
      projectId: 'test/project',
      projectRoot: path.resolve('project'),
      dataDir: path.resolve('data'),
      mediaJobId: 'job-1',
    }));
    expect(request).toMatchObject({ projectId: 'test/project', mediaJobId: 'job-1' });
  });

  it('rejects relative paths and malformed payloads', () => {
    expect(() => parseMediaVideoRunnerRequest('{}')).toThrow('invalid request');
    expect(() => parseMediaVideoRunnerRequest(JSON.stringify({
      projectId: 'test/project',
      projectRoot: 'relative-project',
      dataDir: 'relative-data',
      mediaJobId: 'job-1',
    }))).toThrow('invalid request');
  });
});
