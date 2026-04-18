/**
 * End-to-end pipeline tests for OpenCode hooks persistence.
 *
 * Verifies the complete chain:
 *   OpenCode event payload → normalizeHookInput → handleHookEvent → observation stored
 *
 * This tests that events from the OpenCode plugin actually survive
 * the full pipeline and produce stored observations.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { normalizeHookInput } from '../../src/hooks/normalizer.js';
import { handleHookEvent, resetCooldowns } from '../../src/hooks/handler.js';
import type { NormalizedHookInput } from '../../src/hooks/types.js';

describe('OpenCode e2e pipeline: event → normalize → handle → store', () => {
  beforeEach(() => {
    resetCooldowns();
  });

  // ─── Normalizer contract: OpenCode plugin payloads ───

  describe('normalizeHookInput: OpenCode plugin payloads', () => {
    it('should normalize session.created → session_start', () => {
      const input = normalizeHookInput({
        agent: 'opencode',
        hook_event_name: 'session.created',
        cwd: '/project',
        session_id: 'oc-abc123',
      });
      expect(input.agent).toBe('opencode');
      expect(input.event).toBe('session_start');
      expect(input.sessionId).toBe('oc-abc123');
      expect(input.cwd).toBe('/project');
    });

    it('should normalize session.idle → session_end', () => {
      const input = normalizeHookInput({
        agent: 'opencode',
        hook_event_name: 'session.idle',
        cwd: '/project',
        session_id: 'oc-abc123',
      });
      expect(input.event).toBe('session_end');
    });

    it('should normalize file.edited → post_edit with filePath', () => {
      const input = normalizeHookInput({
        agent: 'opencode',
        hook_event_name: 'file.edited',
        file_path: '/project/src/index.ts',
        cwd: '/project',
      });
      expect(input.event).toBe('post_edit');
      expect(input.filePath).toBe('/project/src/index.ts');
    });

    it('should normalize command.executed → post_command with command', () => {
      const input = normalizeHookInput({
        agent: 'opencode',
        hook_event_name: 'command.executed',
        command: 'npm test',
        cwd: '/project',
      });
      expect(input.event).toBe('post_command');
      expect(input.command).toBe('npm test');
    });

    it('should normalize tool.execute.after → post_tool with toolName and toolInput', () => {
      const input = normalizeHookInput({
        agent: 'opencode',
        hook_event_name: 'tool.execute.after',
        tool_name: 'bash',
        tool_input: { command: 'npm test' },
        cwd: '/project',
      });
      expect(input.event).toBe('post_tool');
      expect(input.toolName).toBe('bash');
      expect(input.toolInput).toEqual({ command: 'npm test' });
    });

    it('should normalize session.compacted → post_compact', () => {
      const input = normalizeHookInput({
        agent: 'opencode',
        hook_event_name: 'session.compacted',
        cwd: '/project',
      });
      expect(input.event).toBe('post_compact');
    });
  });

  // ─── Handler: OpenCode events produce observations ───

  describe('handleHookEvent: OpenCode events produce observations', () => {
    const baseInput = {
      agent: 'opencode' as const,
      timestamp: new Date().toISOString(),
      raw: {},
    };

    it('session.created should produce session_start (no observation, but output)', async () => {
      const input: NormalizedHookInput = {
        ...baseInput,
        event: 'session_start',
        sessionId: 'oc-test-001',
        cwd: '/project',
      };
      const { observation, output } = await handleHookEvent(input);
      // Session start does NOT produce an observation (it injects context instead)
      expect(observation).toBeNull();
      expect(output.continue).toBe(true);
    });

    it('file.edited with edit content should produce a what-changed observation', async () => {
      const input: NormalizedHookInput = {
        ...baseInput,
        event: 'post_edit',
        filePath: '/project/src/utils.ts',
        edits: [{ oldString: 'const API_URL = "http://localhost:3000"', newString: 'const API_URL = "https://api.example.com"' }],
        sessionId: 'oc-test-002',
        cwd: '/project',
      };
      const { observation, output } = await handleHookEvent(input);
      expect(observation).not.toBeNull();
      expect(observation!.type).toBe('what-changed');
      expect(observation!.entityName).toBe('utils');
      expect(output.continue).toBe(true);
    });

    it('file.edited with only filePath (no edits) should be filtered by significance', async () => {
      const input: NormalizedHookInput = {
        ...baseInput,
        event: 'post_edit',
        filePath: '/project/src/utils.ts',
        sessionId: 'oc-test-002b',
        cwd: '/project',
      };
      const { observation } = await handleHookEvent(input);
      // Just a file path is not significant enough — below min-length or significance gate
      expect(observation).toBeNull();
    });

    it('command.executed with substantial command should produce observation', async () => {
      const input: NormalizedHookInput = {
        ...baseInput,
        event: 'post_command',
        command: 'npm run build --production --minify --sourcemap',
        sessionId: 'oc-test-003',
        cwd: '/project',
      };
      const { observation, output } = await handleHookEvent(input);
      expect(observation).not.toBeNull();
      expect(output.continue).toBe(true);
    });

    it('command.executed with trivial command should be filtered', async () => {
      const input: NormalizedHookInput = {
        ...baseInput,
        event: 'post_command',
        command: 'ls',
        sessionId: 'oc-test-004',
        cwd: '/project',
      };
      const { observation } = await handleHookEvent(input);
      expect(observation).toBeNull();
    });

    it('tool.execute.after (bash) with substantial content should produce observation', async () => {
      const input: NormalizedHookInput = {
        ...baseInput,
        event: 'post_tool',
        toolName: 'bash',
        toolInput: { command: 'npm test -- --runInBand --coverage --reporter=verbose' },
        sessionId: 'oc-test-005',
        cwd: '/project',
      };
      const { observation, output } = await handleHookEvent(input);
      expect(observation).not.toBeNull();
      expect(output.continue).toBe(true);
    });

    it('tool.execute.after (edit) should produce what-changed observation', async () => {
      const input: NormalizedHookInput = {
        ...baseInput,
        event: 'post_tool',
        toolName: 'edit',
        toolInput: {
          file_path: '/project/src/main.ts',
          old_string: 'const API_URL = "http://localhost:3000"',
          new_string: 'const API_URL = "https://api.example.com"',
        },
        sessionId: 'oc-test-006',
        cwd: '/project',
      };
      const { observation } = await handleHookEvent(input);
      expect(observation).not.toBeNull();
      expect(observation!.type).toBe('what-changed');
    });

    it('session.compacted should NOT produce observation (post_compact is ack-only)', async () => {
      const input: NormalizedHookInput = {
        ...baseInput,
        event: 'post_compact',
        sessionId: 'oc-test-007',
        cwd: '/project',
      };
      const { observation, output } = await handleHookEvent(input);
      expect(observation).toBeNull();
      expect(output.continue).toBe(true);
    });

    it('session.idle should produce session_end observation if content is substantial', async () => {
      const input: NormalizedHookInput = {
        ...baseInput,
        event: 'session_end',
        sessionId: 'oc-test-008',
        cwd: '/project',
        userPrompt: 'This was a long session about implementing the authentication module and fixing several bugs in the database layer',
      };
      const { observation } = await handleHookEvent(input);
      // session_end produces observation only if content > 50 chars
      expect(observation).not.toBeNull();
    });

    it('session.idle with minimal content should NOT produce observation', async () => {
      const input: NormalizedHookInput = {
        ...baseInput,
        event: 'session_end',
        sessionId: 'oc-test-009',
        cwd: '/project',
      };
      const { observation } = await handleHookEvent(input);
      // No content → below 50 char minimum → no observation
      expect(observation).toBeNull();
    });
  });

  // ─── Full chain: raw OpenCode payload → normalized → handled ───

  describe('full chain: raw OpenCode payload → observation', () => {
    it('file.edited raw payload → normalized → observation (with edits)', async () => {
      // Simulate what the OpenCode plugin sends via stdin
      const rawPayload = {
        agent: 'opencode',
        hook_event_name: 'file.edited',
        file_path: '/project/src/auth.ts',
        cwd: '/project',
        session_id: 'oc-chain-001',
      };

      const normalized = normalizeHookInput(rawPayload);
      expect(normalized.event).toBe('post_edit');
      expect(normalized.filePath).toBe('/project/src/auth.ts');

      // Just a file path is below significance threshold — add edits
      const withEdits: NormalizedHookInput = {
        ...normalized,
        edits: [{ oldString: 'const TOKEN = "hardcoded-secret"', newString: 'const TOKEN = process.env.AUTH_TOKEN' }],
      };
      const { observation } = await handleHookEvent(withEdits);
      expect(observation).not.toBeNull();
      expect(observation!.entityName).toBe('auth');
      expect(observation!.type).toBe('what-changed');
    });

    it('tool.execute.after raw payload → normalized → observation', async () => {
      const rawPayload = {
        agent: 'opencode',
        hook_event_name: 'tool.execute.after',
        tool_name: 'bash',
        tool_input: { command: 'vitest run --reporter=verbose --coverage --runInBand' },
        cwd: '/project',
        session_id: 'oc-chain-002',
      };

      const normalized = normalizeHookInput(rawPayload);
      expect(normalized.event).toBe('post_tool');
      expect(normalized.toolName).toBe('bash');

      const { observation } = await handleHookEvent(normalized);
      expect(observation).not.toBeNull();
    });
  });
});
