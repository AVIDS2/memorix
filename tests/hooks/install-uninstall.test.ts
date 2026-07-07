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

  it('should include memory usage guidance in generated AGENTS.md (codex)', async () => {
    const agentsMd = path.join(tmpDir, 'AGENTS.md');

    await installHooks('codex', tmpDir);

    const content = await fs.readFile(agentsMd, 'utf-8');
    expect(content).toContain('When to search memory');
    expect(content).toContain('memorix_project_context');
    expect(content).toContain('task-lensed brief');
    expect(content).toContain('memorix context --task "<task>"');
    expect(content).toContain('MCP is unavailable, disabled, or not discoverable');
    expect(content).toContain('memorix_search');
    expect(content).toContain('When to store memory');
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

  it('should write official Antigravity hooks.json for project installs', async () => {
    const result = await installHooks('antigravity', tmpDir);
    const hooksPath = path.join(tmpDir, '.agents', 'hooks.json');
    const config = JSON.parse(await fs.readFile(hooksPath, 'utf-8'));

    expect(result.configPath).toBe(hooksPath);
    expect(config.memorix.PreInvocation[0].command).toContain('--event PreInvocation');
    expect(config.memorix.PreToolUse[0].hooks[0].command).toContain('--event PreToolUse');
    expect(config.memorix.PostToolUse[0].hooks[0].command).toContain('--event PostToolUse');
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

  it('should refresh existing Memorix block while preserving user content when audit is empty', async () => {
    const agentsMd = path.join(tmpDir, 'AGENTS.md');

    // Pre-create AGENTS.md with older Memorix content (simulating a previous install)
    const memorixContent = [
      '# My Project',
      '',
      'Keep these user instructions.',
      '',
      '# Memorix — Automatic Memory Rules',
      '',
      'Some old rules here.',
      '',
      '# After Memorix',
      '',
      'Keep this section too.',
      '',
    ].join('\n');
    await fs.writeFile(agentsMd, memorixContent, 'utf-8');

    // Verify audit is empty (no entries for this file)
    const beforeInstall = await getProjectFiles(tmpDir);
    expect(beforeInstall.find(e => e.path === agentsMd)).toBeUndefined();

    // Install codex hooks — should refresh the Memorix block and record audit
    await installHooks('codex', tmpDir);

    // User content should remain, stale Memorix content should be replaced
    const afterInstall = await fs.readFile(agentsMd, 'utf-8');
    expect(afterInstall).toContain('# My Project');
    expect(afterInstall).toContain('Keep these user instructions.');
    expect(afterInstall).toContain('# After Memorix');
    expect(afterInstall).toContain('Keep this section too.');
    expect(afterInstall).toContain('memorix_project_context');
    expect(afterInstall).toContain('task-lensed brief');
    expect(afterInstall).toContain('memorix context --task "<task>"');
    expect(afterInstall).toContain('MCP is unavailable, disabled, or not discoverable');
    expect(afterInstall).not.toContain('Some old rules here.');

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

  it('should not install fallback hooks for package-owned hook agents', async () => {
    const result = await installHooks('openclaw', tmpDir);

    expect(result.events).toEqual([]);
    expect(String((result.generated as Record<string, unknown>).note)).toContain('setup --agent openclaw');
    expect(String((result.generated as Record<string, unknown>).note)).toContain('OpenClaw-compatible bundle');
    await expect(fs.access(path.join(tmpDir, '.memorix', 'hooks.json'))).rejects.toThrow();
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
