import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { closeAllDatabases } from '../../src/store/sqlite-db.js';
import { McpBindingStore } from '../../src/server/mcp-binding-store.js';

let tempDir = '';

afterEach(async () => {
  closeAllDatabases();
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  tempDir = '';
});

describe('stateless MCP project handles', () => {
  it('survives reopening the control-plane database and expires explicitly', async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'memorix-mcp-handle-'));
    const first = new McpBindingStore();
    await first.init(tempDir);
    const binding = first.create({ projectId: 'org/project', projectRoot: 'C:/repo', dataDir: 'C:/data' });
    expect(binding.handleId).toMatch(/^mxh_/);
    closeAllDatabases();
    const reopened = new McpBindingStore();
    await reopened.init(tempDir);
    expect(reopened.get(binding.handleId)?.projectId).toBe('org/project');
    expect(reopened.touch(binding.handleId)?.lastUsedAt).toBeTruthy();
    const expiring = reopened.create({ projectId: 'org/old', projectRoot: 'C:/old', dataDir: 'C:/old-data', ttlMs: 50 });
    expect(reopened.get(expiring.handleId)).toBeDefined();
    await new Promise(resolve => setTimeout(resolve, 75));
    expect(reopened.get(expiring.handleId)).toBeUndefined();
  });
});
