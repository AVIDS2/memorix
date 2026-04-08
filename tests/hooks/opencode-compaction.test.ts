/**
 * Tests for Issue #45: OpenCode compaction — normalizer mapping,
 * installer events list, and compaction prompt text.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { normalizeHookInput } from '../../src/hooks/normalizer.js';
import { installHooks } from '../../src/hooks/installers/index.js';
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

    it('should write plugin file that handles session.compacted event', async () => {
      await installHooks('opencode', tmpDir);
      const pluginPath = path.join(tmpDir, '.opencode', 'plugins', 'memorix.js');
      const content = await fs.readFile(pluginPath, 'utf-8');
      expect(content).toContain("event.type === 'session.compacted'");
      expect(content).toContain("hook_event_name: 'session.compacted'");
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
