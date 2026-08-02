import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { createProjectBindingController } from '../../src/server/request-context.js';

describe('ProjectBindingController', () => {
  it('keeps MCP transport identity out of the product binding', () => {
    const binding = createProjectBindingController(path.resolve('startup'));
    binding.recordResolvedProject('owner/startup', path.resolve('startup-project'));

    expect(binding.requestContext('agent-1')).toEqual({
      projectRoot: path.resolve('startup-project'),
      source: 'startup-cwd',
      explicit: false,
      projectId: 'owner/startup',
      actorId: 'agent-1',
    });
  });

  it('allows Roots discovery until an explicit project root wins', () => {
    const binding = createProjectBindingController(path.resolve('startup'));
    expect(binding.bindFromRoots(path.resolve('roots-project'))).toBe(true);
    expect(binding.snapshot()).toMatchObject({ source: 'mcp-roots', explicit: false });

    binding.bindExplicit(path.resolve('explicit-project'));
    expect(binding.bindFromRoots(path.resolve('later-roots-project'))).toBe(false);
    expect(binding.snapshot()).toMatchObject({
      projectRoot: path.resolve('explicit-project'),
      source: 'explicit-project-root',
      explicit: true,
    });
  });
});
