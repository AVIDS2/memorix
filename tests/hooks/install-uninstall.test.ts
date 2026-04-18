/**
 * Tests for hooks install + uninstall lifecycle.
 *
 * Verifies:
 * - installAgentRules records audit for new shared context files (AGENTS.md)
 * - uninstallHooks removes Memorix block from shared files (not the whole file)
 * - uninstallHooks deletes pure-Memorix shared files entirely
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { installHooks, uninstallHooks } from '../../src/hooks/installers/index.js';
import { getProjectFiles } from '../../src/audit/index.js';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import os from 'node:os';

function makeTmpDir(): string {
  return fsSync.mkdtempSync(path.join(os.tmpdir(), 'memorix-hooks-test-'));
}

async function cleanup(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true });
}

describe('Hooks install/uninstall lifecycle', () => {
  let tmpDir: string;
  let auditFile: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    auditFile = path.join(tmpDir, '.memorix', 'audit.json');
    process.env.MEMORIX_AUDIT_FILE = auditFile;
  });

  afterEach(async () => {
    delete process.env.MEMORIX_AUDIT_FILE;
    await cleanup(tmpDir);
  });

  it('should record audit entry when creating new AGENTS.md (codex)', async () => {
    const agentsMd = path.join(tmpDir, 'AGENTS.md');

    // Install codex hooks (creates AGENTS.md from scratch)
    await installHooks('codex', tmpDir);

    // File should exist
    const content = await fs.readFile(agentsMd, 'utf-8');
    expect(content).toContain('# Memorix');

    // Audit should have an entry for this file
    const files = await getProjectFiles(tmpDir);
    const agentsEntry = files.find(e => e.path === agentsMd);
    expect(agentsEntry).toBeDefined();
    expect(agentsEntry!.agent).toBe('codex');
    expect(agentsEntry!.type).toBe('rule');
  });

  it('should record audit entry when creating new GEMINI.md (gemini-cli)', async () => {
    const geminiMd = path.join(tmpDir, 'GEMINI.md');

    await installHooks('gemini-cli', tmpDir);

    const content = await fs.readFile(geminiMd, 'utf-8');
    expect(content).toContain('# Memorix');

    const files = await getProjectFiles(tmpDir);
    const entry = files.find(e => e.path === geminiMd);
    expect(entry).toBeDefined();
    expect(entry!.agent).toBe('gemini-cli');
  });

  it('should remove only Memorix block from shared file on uninstall', async () => {
    const agentsMd = path.join(tmpDir, 'AGENTS.md');

    // Pre-create AGENTS.md with user content
    await fs.writeFile(agentsMd, '# My Project\n\nSome user instructions here.\n\n', 'utf-8');

    // Install codex hooks (appends Memorix block)
    await installHooks('codex', tmpDir);

    const afterInstall = await fs.readFile(agentsMd, 'utf-8');
    expect(afterInstall).toContain('# My Project');
    expect(afterInstall).toContain('# Memorix');

    // Uninstall
    await uninstallHooks('codex', tmpDir);

    // User content should remain, Memorix block should be gone
    const afterUninstall = await fs.readFile(agentsMd, 'utf-8');
    expect(afterUninstall).toContain('# My Project');
    expect(afterUninstall).toContain('Some user instructions here');
    expect(afterUninstall).not.toContain('# Memorix');
  });

  it('should delete pure-Memorix shared file on uninstall', async () => {
    const agentsMd = path.join(tmpDir, 'AGENTS.md');

    // Install codex hooks (creates AGENTS.md with only Memorix content)
    await installHooks('codex', tmpDir);

    const afterInstall = await fs.readFile(agentsMd, 'utf-8');
    expect(afterInstall).toContain('# Memorix');

    // Uninstall
    await uninstallHooks('codex', tmpDir);

    // File should be deleted (only had Memorix content)
    await expect(fs.access(agentsMd)).rejects.toThrow();
  });

  it('should handle install → uninstall → install cycle for codex', async () => {
    const agentsMd = path.join(tmpDir, 'AGENTS.md');

    // First install
    await installHooks('codex', tmpDir);
    let content = await fs.readFile(agentsMd, 'utf-8');
    expect(content).toContain('# Memorix');

    // Uninstall
    await uninstallHooks('codex', tmpDir);
    await expect(fs.access(agentsMd)).rejects.toThrow();

    // Re-install (should create fresh file with audit entry)
    await installHooks('codex', tmpDir);
    content = await fs.readFile(agentsMd, 'utf-8');
    expect(content).toContain('# Memorix');

    // Audit should track the new file
    const files = await getProjectFiles(tmpDir);
    const entry = files.find(e => e.path === agentsMd);
    expect(entry).toBeDefined();
  });

  it('should record audit entry when AGENTS.md already contains Memorix and audit is empty', async () => {
    const agentsMd = path.join(tmpDir, 'AGENTS.md');

    // Pre-create AGENTS.md with Memorix content (simulating manual edit or previous install)
    const memorixContent = '# Memorix — Automatic Memory Rules\n\nSome rules here.\n';
    await fs.writeFile(agentsMd, memorixContent, 'utf-8');

    // Verify audit is empty (no entries for this file)
    const beforeInstall = await getProjectFiles(tmpDir);
    expect(beforeInstall.find(e => e.path === agentsMd)).toBeUndefined();

    // Install codex hooks — should NOT rewrite the file, but SHOULD record audit
    await installHooks('codex', tmpDir);

    // File content should be unchanged
    const afterInstall = await fs.readFile(agentsMd, 'utf-8');
    expect(afterInstall).toBe(memorixContent);

    // Audit should now have an entry
    const files = await getProjectFiles(tmpDir);
    const entry = files.find(e => e.path === agentsMd);
    expect(entry).toBeDefined();
    expect(entry!.agent).toBe('codex');
    expect(entry!.type).toBe('rule');
  });

  it('should return true when uninstalling codex (rules-only agent)', async () => {
    // Install codex hooks (creates AGENTS.md)
    await installHooks('codex', tmpDir);

    // Uninstall should return true (audit cleanup succeeded)
    const result = await uninstallHooks('codex', tmpDir);
    expect(result).toBe(true);
  });

  it('should return true when uninstalling gemini-cli (rules-only agent)', async () => {
    // Install gemini-cli hooks (creates GEMINI.md)
    await installHooks('gemini-cli', tmpDir);

    const result = await uninstallHooks('gemini-cli', tmpDir);
    expect(result).toBe(true);
  });

  it('should recover audit entry when ledger is lost and re-install is called (codex)', async () => {
    const agentsMd = path.join(tmpDir, 'AGENTS.md');

    // Install codex hooks (creates AGENTS.md + audit entry)
    await installHooks('codex', tmpDir);
    let content = await fs.readFile(agentsMd, 'utf-8');
    expect(content).toContain('# Memorix');

    // Verify audit has entry
    let files = await getProjectFiles(tmpDir);
    expect(files.find(e => e.path === agentsMd)).toBeDefined();

    // Corrupt the audit ledger by deleting it
    try { await fs.unlink(auditFile); } catch { /* may not exist at this path */ }

    // Re-install should recover the audit entry
    await installHooks('codex', tmpDir);

    // File should still have Memorix content
    content = await fs.readFile(agentsMd, 'utf-8');
    expect(content).toContain('# Memorix');

    // Audit should be recovered
    files = await getProjectFiles(tmpDir);
    const entry = files.find(e => e.path === agentsMd);
    expect(entry).toBeDefined();
    expect(entry!.agent).toBe('codex');
  });

  it('should install and uninstall claude hooks (non-shared-rules agent)', async () => {
    const settingsPath = path.join(tmpDir, '.claude', 'settings.local.json');

    // Install claude hooks
    await installHooks('claude', tmpDir);

    // Config file should exist
    const content = await fs.readFile(settingsPath, 'utf-8');
    const parsed = JSON.parse(content);
    expect(parsed).toBeDefined();

    // Audit should have entries
    const files = await getProjectFiles(tmpDir);
    expect(files.length).toBeGreaterThan(0);

    // Uninstall should succeed
    const result = await uninstallHooks('claude', tmpDir);
    expect(result).toBe(true);
  });
});
