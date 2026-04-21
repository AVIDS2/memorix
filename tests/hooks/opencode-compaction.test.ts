/**
 * Tests for Issue #45: OpenCode compaction — normalizer mapping,
 * installer events list, and compaction prompt text.
 *
 * Also tests Issue #80 fix: plugin uses individual event-name keys
 * (session.created, file.edited, etc.) instead of invalid catch-all `event` handler.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { normalizeHookInput } from '../../src/hooks/normalizer.js';
import { installHooks, uninstallHooks, getHookStatus } from '../../src/hooks/installers/index.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

describe('Issue #45: OpenCode compaction', () => {
  // ─── Normalizer ───

  describe('normalizer: session.compacted → post_compact', () => {
    it('should normalize OpenCode session.compacted → post_compact', () => {
      const input = normalizeHookInput({
        agent: 'opencode',
        hook_event_name: 'session.compacted',
        cwd: '/project',
      });
      expect(input.agent).toBe('opencode');
      expect(input.event).toBe('post_compact');
    });

    it('should NOT map session.compacted to pre_compact', () => {
      const input = normalizeHookInput({
        agent: 'opencode',
        hook_event_name: 'session.compacted',
        cwd: '/project',
      });
      expect(input.event).not.toBe('pre_compact');
    });
  });

  // ─── Installer ───

  describe('installer: OpenCode events list and plugin content', () => {
    let tmpDir: string;

    beforeEach(async () => {
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memorix-oc-test-'));
      // installHooks needs a .git dir to detect project
      await fs.mkdir(path.join(tmpDir, '.git'), { recursive: true });
    });

    afterEach(async () => {
      await fs.rm(tmpDir, { recursive: true, force: true });
    });

    it('should include post_compact in returned events list', async () => {
      const result = await installHooks('opencode', tmpDir);
      expect(result.events).toContain('post_compact');
    });

    it('should NOT include pre_compact in returned events list', async () => {
      const result = await installHooks('opencode', tmpDir);
      expect(result.events).not.toContain('pre_compact');
    });

    it('should write plugin file with session.compacted as direct event key (not catch-all event handler)', async () => {
      await installHooks('opencode', tmpDir);
      const pluginPath = path.join(tmpDir, '.opencode', 'plugins', 'memorix.js');
      const content = await fs.readFile(pluginPath, 'utf-8');
      // v4+ uses individual event-name keys, NOT catch-all `event` handler
      expect(content).toContain("'session.compacted'");
      expect(content).toContain("hook_event_name: 'session.compacted'");
      // Must NOT contain the old catch-all event handler pattern
      expect(content).not.toContain("event: async ({ event }) =>");
      expect(content).not.toContain("event.type === 'session.compacted'");
    });

    it('compaction prompt should NOT promise memorix_store auto-invocation', async () => {
      await installHooks('opencode', tmpDir);
      const pluginPath = path.join(tmpDir, '.opencode', 'plugins', 'memorix.js');
      const content = await fs.readFile(pluginPath, 'utf-8');
      expect(content).not.toContain('memorix_store');
      expect(content).not.toContain('memorix_session_start');
    });

    it('compaction prompt should use structured continuation format', async () => {
      await installHooks('opencode', tmpDir);
      const pluginPath = path.join(tmpDir, '.opencode', 'plugins', 'memorix.js');
      const content = await fs.readFile(pluginPath, 'utf-8');
      expect(content).toContain('Continuation Context (Memorix)');
      expect(content).toContain('Current task');
      expect(content).toContain('Key decisions');
      expect(content).toContain('Next steps');
    });
  });
});

describe('Issue #80: OpenCode plugin must use correct event keys', () => {
  let tmpDir: string;
  let auditFile: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memorix-oc80-'));
    await fs.mkdir(path.join(tmpDir, '.git'), { recursive: true });
    auditFile = path.join(tmpDir, '.memorix', 'audit.json');
    process.env.MEMORIX_AUDIT_FILE = auditFile;
  });

  afterEach(async () => {
    delete process.env.MEMORIX_AUDIT_FILE;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // ─── Plugin structure: individual event keys ───

  it('should use session.created as direct hook key (not catch-all event handler)', async () => {
    await installHooks('opencode', tmpDir);
    const pluginPath = path.join(tmpDir, '.opencode', 'plugins', 'memorix.js');
    const content = await fs.readFile(pluginPath, 'utf-8');
    expect(content).toContain("'session.created':");
    expect(content).not.toContain("event.type === 'session.created'");
  });

  it('should use file.edited as direct hook key', async () => {
    await installHooks('opencode', tmpDir);
    const pluginPath = path.join(tmpDir, '.opencode', 'plugins', 'memorix.js');
    const content = await fs.readFile(pluginPath, 'utf-8');
    expect(content).toContain("'file.edited':");
    expect(content).not.toContain("event.type === 'file.edited'");
  });

  it('should use command.executed as direct hook key', async () => {
    await installHooks('opencode', tmpDir);
    const pluginPath = path.join(tmpDir, '.opencode', 'plugins', 'memorix.js');
    const content = await fs.readFile(pluginPath, 'utf-8');
    expect(content).toContain("'command.executed':");
    expect(content).not.toContain("event.type === 'command.executed'");
  });

  it('should use session.idle as direct hook key', async () => {
    await installHooks('opencode', tmpDir);
    const pluginPath = path.join(tmpDir, '.opencode', 'plugins', 'memorix.js');
    const content = await fs.readFile(pluginPath, 'utf-8');
    expect(content).toContain("'session.idle':");
    expect(content).not.toContain("event.type === 'session.idle'");
  });

  it('should use tool.execute.after as direct hook key', async () => {
    await installHooks('opencode', tmpDir);
    const pluginPath = path.join(tmpDir, '.opencode', 'plugins', 'memorix.js');
    const content = await fs.readFile(pluginPath, 'utf-8');
    expect(content).toContain("'tool.execute.after':");
  });

  it('should NOT contain catch-all event handler', async () => {
    await installHooks('opencode', tmpDir);
    const pluginPath = path.join(tmpDir, '.opencode', 'plugins', 'memorix.js');
    const content = await fs.readFile(pluginPath, 'utf-8');
    // The old v3 plugin had: event: async ({ event }) => { if (event.type === ...) }
    expect(content).not.toMatch(/\bevent:\s*async\s*\(\s*\{\s*event\s*\}\s*\)/);
  });

  // ─── Invocation method: child_process.spawnSync instead of cat pipe ───

  it('should use child_process.spawnSync for hook invocation (cross-runtime)', async () => {
    await installHooks('opencode', tmpDir);
    const pluginPath = path.join(tmpDir, '.opencode', 'plugins', 'memorix.js');
    const content = await fs.readFile(pluginPath, 'utf-8');
    expect(content).toContain('spawnSync');
    expect(content).toContain("import { spawnSync } from 'node:child_process'");
    // Should NOT use Bun.spawn as an actual call (only in comments is OK)
    expect(content).not.toMatch(/Bun\.spawn\s*\(/);
    // Should NOT contain the old cat-pipe invocation pattern
    expect(content).not.toContain("await $");
    expect(content).not.toContain('Bun.write(tmpPath');
  });

  it('should use memorix.cmd on Windows', async () => {
    await installHooks('opencode', tmpDir);
    const pluginPath = path.join(tmpDir, '.opencode', 'plugins', 'memorix.js');
    const content = await fs.readFile(pluginPath, 'utf-8');
    expect(content).toContain("process.platform === 'win32' ? 'memorix.cmd' : 'memorix'");
  });

  it('should include diagnostic logging on failure (not silent swallow)', async () => {
    await installHooks('opencode', tmpDir);
    const pluginPath = path.join(tmpDir, '.opencode', 'plugins', 'memorix.js');
    const content = await fs.readFile(pluginPath, 'utf-8');
    expect(content).toContain('[memorix-plugin]');
    expect(content).toContain('console.error');
  });

  // ─── Plugin version ───

  it('should generate version 5 plugin (spawnSync, cross-runtime)', async () => {
    await installHooks('opencode', tmpDir);
    const pluginPath = path.join(tmpDir, '.opencode', 'plugins', 'memorix.js');
    const content = await fs.readFile(pluginPath, 'utf-8');
    expect(content).toContain('@generated-version 5');
  });

  // ─── Hooks status: verified field ───

  it('should report OpenCode as installed but unverified', async () => {
    await installHooks('opencode', tmpDir);
    const statuses = await getHookStatus(tmpDir);
    const oc = statuses.find(s => s.agent === 'opencode');
    expect(oc).toBeDefined();
    expect(oc!.installed).toBe(true);
    expect(oc!.verified).toBe(false); // OpenCode is plugin-based, can't verify runtime load
  });

  it('should report config-based agents as verified when installed', async () => {
    // Install Claude Code hooks (config-based)
    await installHooks('claude', tmpDir);
    const statuses = await getHookStatus(tmpDir);
    const claude = statuses.find(s => s.agent === 'claude');
    expect(claude).toBeDefined();
    expect(claude!.installed).toBe(true);
    expect(claude!.verified).toBe(true); // Config-based, file existence = verified
  });

  it('should detect outdated v3 OpenCode plugin (catch-all event handler)', async () => {
    // Write a v3-style plugin manually
    const pluginDir = path.join(tmpDir, '.opencode', 'plugins');
    await fs.mkdir(pluginDir, { recursive: true });
    const pluginPath = path.join(pluginDir, 'memorix.js');
    await fs.writeFile(pluginPath, `// @generated-version 3\nexport const MemorixPlugin = async (ctx) => { return { event: async ({ event }) => {} } };`, 'utf-8');

    const statuses = await getHookStatus(tmpDir);
    const oc = statuses.find(s => s.agent === 'opencode');
    expect(oc!.installed).toBe(true);
    expect(oc!.outdated).toBe(true); // v3 < v5
  });

  // ─── Install paths ───

  it('should install plugin to .opencode/plugins/memorix.js (project level)', async () => {
    await installHooks('opencode', tmpDir);
    const pluginPath = path.join(tmpDir, '.opencode', 'plugins', 'memorix.js');
    const stat = await fs.stat(pluginPath);
    expect(stat.isFile()).toBe(true);
  });

  it('should install plugin to ~/.config/opencode/plugins/memorix.js (global level)', async () => {
    const result = await installHooks('opencode', tmpDir, true);
    // Global path should be under ~/.config/opencode/plugins/
    expect(result.configPath).toContain('opencode');
    expect(result.configPath).toContain('plugins');
    expect(result.configPath).toContain('memorix.js');
  });

  // ─── Uninstall ───

  it('should uninstall OpenCode plugin completely', async () => {
    await installHooks('opencode', tmpDir);
    const pluginPath = path.join(tmpDir, '.opencode', 'plugins', 'memorix.js');
    await fs.access(pluginPath); // exists

    const uninstalled = await uninstallHooks('opencode', tmpDir);
    expect(uninstalled).toBe(true);

    // Plugin file should be gone
    await expect(fs.access(pluginPath)).rejects.toThrow();
  });

  it('should uninstall OpenCode plugin even if the audit ledger is missing', async () => {
    await installHooks('opencode', tmpDir);
    const pluginPath = path.join(tmpDir, '.opencode', 'plugins', 'memorix.js');
    await fs.access(pluginPath);
    await fs.rm(auditFile, { force: true });

    const uninstalled = await uninstallHooks('opencode', tmpDir);
    expect(uninstalled).toBe(true);
    await expect(fs.access(pluginPath)).rejects.toThrow();
  });

  // ─── Reinstall ───

  it('should reinstall after uninstall with correct v5 format', async () => {
    await installHooks('opencode', tmpDir);
    await uninstallHooks('opencode', tmpDir);
    await installHooks('opencode', tmpDir);

    const pluginPath = path.join(tmpDir, '.opencode', 'plugins', 'memorix.js');
    const content = await fs.readFile(pluginPath, 'utf-8');
    expect(content).toContain('@generated-version 5');
    expect(content).toContain("'session.created':");
    expect(content).toContain('spawnSync');
  });
});
