/**
 * End-to-end tests for Hook Handler with REAL Claude Code payloads.
 *
 * These tests simulate the exact JSON that Claude Code pipes to `memorix hook` via stdin,
 * verifying that handleHookEvent produces non-null observations for all major tool events.
 *
 * This directly validates the fix for: "hooks never auto-store during development"
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { normalizeHookInput } from '../../src/hooks/normalizer.js';
import { handleHookEvent, resetCooldowns } from '../../src/hooks/handler.js';

describe('Claude Code Hook Handler E2E', () => {
  // Each `memorix hook` call is a separate process in production,
  // so cooldowns never persist. Reset between tests to simulate this.
  beforeEach(() => {
    resetCooldowns();
  });
  // ─── PostToolUse: Write (most common during development) ───
  it('should auto-store for Write tool (file creation)', async () => {
    const payload = {
      hook_event_name: 'PostToolUse',
      session_id: 'sess-claude-1',
      cwd: '/home/user/project',
      tool_name: 'Write',
      tool_input: {
        file_path: '/home/user/project/src/auth.ts',
        content: `import jwt from 'jsonwebtoken';
export function generateToken(userId: string) {
  return jwt.sign({ sub: userId }, process.env.JWT_SECRET!, { expiresIn: '15m' });
}
export function verifyToken(token: string) {
  return jwt.verify(token, process.env.JWT_SECRET!);
}`,
      },
      tool_response: 'File written successfully',
    };

    const input = normalizeHookInput(payload);
    expect(input.agent).toBe('claude');
    expect(input.event).toBe('post_tool');
    expect(input.toolName).toBe('Write');
    expect(input.filePath).toBe('/home/user/project/src/auth.ts');

    const { observation } = await handleHookEvent(input);
    expect(observation).not.toBeNull();
    expect(observation!.entityName).toBe('auth');
    expect(observation!.narrative.length).toBeGreaterThan(50);
  });

  // ─── PostToolUse: Edit (code modifications) ───
  it('should auto-store for Edit tool (code modification)', async () => {
    const payload = {
      hook_event_name: 'PostToolUse',
      session_id: 'sess-claude-2',
      cwd: '/home/user/project',
      tool_name: 'Edit',
      tool_input: {
        file_path: '/home/user/project/src/config.ts',
        old_string: 'const PORT = 3000;',
        new_string: 'const PORT = parseInt(process.env.PORT || "3000", 10);',
      },
      tool_response: 'Successfully edited file',
    };

    const input = normalizeHookInput(payload);
    expect(input.event).toBe('post_tool');
    expect(input.filePath).toBe('/home/user/project/src/config.ts');

    const { observation } = await handleHookEvent(input);
    expect(observation).not.toBeNull();
    expect(observation!.narrative).toContain('PORT');
  });

  // ─── PostToolUse: Bash (npm install, test, build) ───
  it('should auto-store for Bash tool with meaningful output', async () => {
    const payload = {
      hook_event_name: 'PostToolUse',
      session_id: 'sess-claude-3',
      cwd: '/home/user/project',
      tool_name: 'Bash',
      tool_input: {
        command: 'npm test',
      },
      tool_response: `> project@1.0.0 test
> vitest run

 ✓ tests/auth.test.ts (5 tests) 234ms
 ✓ tests/api.test.ts (12 tests) 567ms
 
 Test Files  2 passed (2)
      Tests  17 passed (17)`,
    };

    const input = normalizeHookInput(payload);
    expect(input.command).toBe('npm test');

    const { observation } = await handleHookEvent(input);
    expect(observation).not.toBeNull();
    expect(observation!.narrative).toContain('npm test');
  });

  // ─── PostToolUse: Bash with SHORT output (edge case) ───
  it('should auto-store for Bash even with short output if command is meaningful', async () => {
    const payload = {
      hook_event_name: 'PostToolUse',
      session_id: 'sess-claude-4',
      cwd: '/home/user/project',
      tool_name: 'Bash',
      tool_input: {
        command: 'npm install jsonwebtoken @types/jsonwebtoken',
      },
      tool_response: 'added 15 packages in 2.3s',
    };

    const input = normalizeHookInput(payload);
    // Debug: verify normalization extracts command
    expect(input.agent).toBe('claude');
    expect(input.event).toBe('post_tool');
    expect(input.toolName).toBe('Bash');
    expect(input.command).toBe('npm install jsonwebtoken @types/jsonwebtoken');
    expect(input.toolResult).toBe('added 15 packages in 2.3s');

    const { observation } = await handleHookEvent(input);
    // Short output but command is meaningful → should store
    expect(observation).not.toBeNull();
  });

  // ─── UserPromptSubmit ───
  it('should auto-store for user prompt (>= 20 chars)', async () => {
    const payload = {
      hook_event_name: 'UserPromptSubmit',
      session_id: 'sess-claude-5',
      cwd: '/home/user/project',
      prompt: 'Add JWT authentication with refresh tokens and 15-minute expiry',
    };

    const input = normalizeHookInput(payload);
    expect(input.event).toBe('user_prompt');
    expect(input.userPrompt).toBe('Add JWT authentication with refresh tokens and 15-minute expiry');

    const { observation } = await handleHookEvent(input);
    expect(observation).not.toBeNull();
    expect(observation!.narrative).toContain('JWT');
  });

  // ─── UserPromptSubmit: SHORT prompt (edge case) ───
  it('should SKIP very short user prompts (< 20 chars)', async () => {
    const payload = {
      hook_event_name: 'UserPromptSubmit',
      session_id: 'sess-claude-6',
      cwd: '/home/user/project',
      prompt: 'fix it',
    };

    const input = normalizeHookInput(payload);
    const { observation } = await handleHookEvent(input);
    // "fix it" is only 6 chars < 20 → correctly skipped
    expect(observation).toBeNull();
  });

  // ─── SessionStart ───
  it('should inject context on SessionStart (no observation stored)', async () => {
    const payload = {
      hook_event_name: 'SessionStart',
      session_id: 'sess-claude-7',
      cwd: '/home/user/project',
    };

    const input = normalizeHookInput(payload);
    expect(input.event).toBe('session_start');

    const { observation, output } = await handleHookEvent(input);
    // SessionStart injects context, doesn't store
    expect(observation).toBeNull();
    expect(output.systemMessage).toContain('Memorix is active');
  });

  // ─── Stop (session end) ───
  it('should always store on Stop event', async () => {
    const payload = {
      hook_event_name: 'Stop',
      session_id: 'sess-claude-8',
      cwd: '/home/user/project',
    };

    const input = normalizeHookInput(payload);
    expect(input.event).toBe('session_end');

    const { observation } = await handleHookEvent(input);
    // session_end always stores (no length check)
    expect(observation).not.toBeNull();
  });

  // ─── PreCompact ───
  it('should always store on PreCompact event', async () => {
    const payload = {
      hook_event_name: 'PreCompact',
      session_id: 'sess-claude-9',
      cwd: '/home/user/project',
    };

    const input = normalizeHookInput(payload);
    expect(input.event).toBe('pre_compact');

    const { observation } = await handleHookEvent(input);
    // pre_compact always stores
    expect(observation).not.toBeNull();
  });

  // ─── Skip memorix's own tools ───
  it('should skip memorix_store to avoid recursion', async () => {
    const payload = {
      hook_event_name: 'PostToolUse',
      session_id: 'sess-claude-10',
      cwd: '/home/user/project',
      tool_name: 'memorix_store',
      tool_input: { entityName: 'auth', type: 'decision', title: 'test', narrative: 'test' },
      tool_response: '{"observation":{"id":1}}',
    };

    const input = normalizeHookInput(payload);
    const { observation } = await handleHookEvent(input);
    expect(observation).toBeNull();
  });

  it('should skip memorix_search to avoid recursion', async () => {
    const payload = {
      hook_event_name: 'PostToolUse',
      session_id: 'sess-claude-11',
      cwd: '/home/user/project',
      tool_name: 'memorix_search',
      tool_input: { query: 'auth' },
      tool_response: '{"results":[]}',
    };

    const input = normalizeHookInput(payload);
    const { observation } = await handleHookEvent(input);
    expect(observation).toBeNull();
  });

  // ─── Noise: Read tool with trivial content ───
  it('should skip Read tool with very short file content', async () => {
    const payload = {
      hook_event_name: 'PostToolUse',
      session_id: 'sess-claude-12',
      cwd: '/home/user/project',
      tool_name: 'Read',
      tool_input: { file_path: '/home/user/project/.gitignore' },
      tool_response: 'node_modules\ndist\n.env',
    };

    const input = normalizeHookInput(payload);
    const { observation } = await handleHookEvent(input);
    // Content: "Tool: Read\nFile: .gitignore\nnode_modules\ndist\n.env" = ~50 chars
    // < 100 MIN_STORE_LENGTH → null (correctly skipped, reading .gitignore isn't memorable)
    expect(observation).toBeNull();
  });
});
