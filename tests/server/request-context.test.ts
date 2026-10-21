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

  it('exposes a privacy-safe binding receipt without raw paths', () => {
    const projectRoot = path.resolve('receipt-project');
    const dataDir = path.resolve('receipt-data');
    const binding = createProjectBindingController(projectRoot);
    binding.recordResolvedProject('owner/receipt-project', projectRoot);

    const receipt = binding.receipt({ dataDir, transport: 'legacy-http' });

    expect(receipt).toMatchObject({
      version: '1',
      state: 'resolved',
      source: 'startup-cwd',
      explicit: false,
      projectId: 'owner/receipt-project',
      transport: 'legacy-http',
    });
    expect(receipt.projectRootHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(receipt.dataDirHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(JSON.stringify(receipt)).not.toContain(projectRoot);
    expect(JSON.stringify(receipt)).not.toContain(dataDir);
  });
});
