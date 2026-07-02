/**
 * End-to-end tests for Hook Handler with REAL Claude Code payloads.
 *
 * These tests simulate the exact JSON that Claude Code pipes to `memorix hook` via stdin,
 * verifying that handleHookEvent produces non-null observations for all major tool events.
 *
 * This directly validates the fix for: "hooks never auto-store during development"
 */

import { afterEach, describe, it, expect, beforeEach, vi } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { normalizeHookInput } from '../../src/hooks/normalizer.js';
import { handleHookEvent, resetCooldowns } from '../../src/hooks/handler.js';
import { initObservations, storeObservation } from '../../src/memory/observations.js';
import { closeAllDatabases } from '../../src/store/sqlite-db.js';
import { resetObservationStore } from '../../src/store/obs-store.js';
import { resetDb } from '../../src/store/orama-store.js';
import { resetSessionStore } from '../../src/store/session-store.js';
import { resetTeamStore } from '../../src/team/team-store.js';

describe('Claude Code Hook Handler E2E', () => {
  const originalCwd = process.cwd();
  const originalDataDir = process.env.MEMORIX_DATA_DIR;
  const originalEmbedding = process.env.MEMORIX_EMBEDDING;

  // Each `memorix hook` call is a separate process in production,
  // so cooldowns never persist. Reset between tests to simulate this.
  beforeEach(() => {
    resetCooldowns();
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    if (originalDataDir === undefined) {
      delete process.env.MEMORIX_DATA_DIR;
    } else {
      process.env.MEMORIX_DATA_DIR = originalDataDir;
    }
    if (originalEmbedding === undefined) {
      delete process.env.MEMORIX_EMBEDDING;
    } else {
      process.env.MEMORIX_EMBEDDING = originalEmbedding;
    }
    vi.doUnmock('../../src/config/behavior.js');
    resetObservationStore();
    resetSessionStore();
    resetTeamStore();
    await resetDb();
    closeAllDatabases();
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
    expect(output.systemMessage).toContain('Previous session context may be available');
    expect(output.systemMessage).toContain('Use memorix_search when prior project context would materially help');
  });

  it('should inject auto project context on SessionStart when full injection is enabled', async () => {
    const sandboxRoot = mkdtempSync(path.join(tmpdir(), 'memorix-hook-auto-context-'));
    const repoDir = path.join(sandboxRoot, 'repo');
    const dataDir = path.join(sandboxRoot, 'data');
    try {
      mkdirSync(path.join(repoDir, 'src'), { recursive: true });
      writeFileSync(path.join(repoDir, 'src', 'auth.ts'), 'export function authMiddleware(token: string) { return token.length > 0; }\n', 'utf8');
      writeFileSync(path.join(repoDir, 'src', 'worker.py'), 'def dispatch_job(name: str):\n    return name.upper()\n', 'utf8');
      execSync('git init', { cwd: repoDir, stdio: 'ignore' });
      process.chdir(repoDir);
      process.env.MEMORIX_DATA_DIR = dataDir;
      process.env.MEMORIX_EMBEDDING = 'off';
      vi.doMock('../../src/config/behavior.js', () => ({
        getBehaviorConfig: () => ({
          sessionInject: 'full',
          syncAdvisory: true,
          autoCleanup: true,
          formationMode: 'active',
        }),
      }));
      await initObservations(dataDir);
      await storeObservation({
        entityName: 'auth',
        type: 'decision',
        title: 'authMiddleware owns token verification',
        narrative: 'When editing login behavior, start with src/auth.ts.',
        filesModified: ['src/auth.ts'],
        projectId: 'local/repo',
      });

      const input = normalizeHookInput({
        hook_event_name: 'SessionStart',
        session_id: 'sess-claude-auto-context',
        cwd: repoDir,
      });
      const { observation, output } = await handleHookEvent(input);

      expect(observation).toBeNull();
      expect(output.systemMessage).toContain('Memorix Autopilot Brief for repo');
      expect(output.systemMessage).toContain('Start here');
      expect(output.systemMessage).toContain('src/auth.ts');
      expect(output.systemMessage).toContain('python 1');
      expect(output.systemMessage).not.toContain('SQLite');
    } finally {
      process.chdir(originalCwd);
      closeAllDatabases();
      rmSync(sandboxRoot, { recursive: true, force: true });
    }
  });

  // ─── Stop (session end) ───
  it('should SKIP empty Stop event (no content worth storing)', async () => {
    const payload = {
      hook_event_name: 'Stop',
      session_id: 'sess-claude-8',
      cwd: '/home/user/project',
    };

    const input = normalizeHookInput(payload);
    expect(input.event).toBe('session_end');

    const { observation } = await handleHookEvent(input);
    // Empty session_end has no content worth remembering
    expect(observation).toBeNull();
  });

  it('should store Stop event with substantial content', async () => {
    const payload = {
      hook_event_name: 'Stop',
      session_id: 'sess-claude-8b',
      cwd: '/home/user/project',
      prompt: 'Completed refactoring the authentication module with JWT tokens and bcrypt password hashing',
    };

    const input = normalizeHookInput(payload);
    const { observation } = await handleHookEvent(input);
    expect(observation).not.toBeNull();
  });

  // ─── PreCompact ───
  it('should SKIP empty PreCompact (no content to save)', async () => {
    const payload = {
      hook_event_name: 'PreCompact',
      session_id: 'sess-claude-9',
      cwd: '/home/user/project',
    };

    const input = normalizeHookInput(payload);
    expect(input.event).toBe('pre_compact');

    const { observation } = await handleHookEvent(input);
    // Empty PreCompact has no content → should be filtered out
    expect(observation).toBeNull();
  });

  it('should store PreCompact with substantial content', async () => {
    const payload = {
      hook_event_name: 'PreCompact',
      session_id: 'sess-claude-9b',
      cwd: '/home/user/project',
      prompt: 'We discussed the authentication architecture and decided to use JWT with refresh tokens. The main concern was session invalidation, which we solved with a Redis-backed blacklist.',
    };

    const input = normalizeHookInput(payload);
    const { observation } = await handleHookEvent(input);
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

  // ─── File-modifying tools always store (no pattern needed) ───
  it('should store Write tool even without pattern keywords', async () => {
    const payload = {
      hook_event_name: 'PostToolUse',
      session_id: 'sess-claude-13',
      cwd: '/home/user/project',
      tool_name: 'Write',
      tool_input: {
        file_path: '/home/user/project/src/utils.ts',
        content: `export function formatDate(d: Date): string {
  return d.toISOString().split('T')[0];
}
export function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}`,
      },
      tool_response: 'File written successfully',
    };

    const input = normalizeHookInput(payload);
    const { observation } = await handleHookEvent(input);
    // No pattern keywords in the content, but Write is a file-modifying tool → always store
    expect(observation).not.toBeNull();
    expect(observation!.type).toBe('what-changed');
  });

  // ─── Critical fix: cd prefix should NOT cause filtering ───
  it('should store Bash with cd prefix (not filtered as noise)', async () => {
    const payload = {
      hook_event_name: 'PostToolUse',
      session_id: 'sess-claude-14',
      cwd: '/home/user/project',
      tool_name: 'Bash',
      tool_input: { command: 'cd /home/user/project && npm test 2>&1' },
      tool_response: { stdout: '> my-app@1.0.0 test\n> node test.js\n\nTest 1: passed\nTest 2: passed\nAll tests passed!' },
    };

    const input = normalizeHookInput(payload);
    const { observation } = await handleHookEvent(input);
    // cd prefix is stripped → real command is "npm test 2>&1" → not noise → stored
    expect(observation).not.toBeNull();
    expect(observation!.title).toContain('npm test');
  });

  it('should skip standalone cd command (still noise)', async () => {
    const payload = {
      hook_event_name: 'PostToolUse',
      session_id: 'sess-claude-15',
      cwd: '/home/user/project',
      tool_name: 'Bash',
      tool_input: { command: 'cd /home/user/project' },
      tool_response: '',
    };

    const input = normalizeHookInput(payload);
    const { observation } = await handleHookEvent(input);
    // Standalone cd with no output → too short (< 30 chars minLength for command) → null
    expect(observation).toBeNull();
  });

  it('should skip self-referential commands (inspecting memorix data)', async () => {
    const payload = {
      hook_event_name: 'PostToolUse',
      session_id: 'sess-claude-16',
      cwd: '/home/user/project',
      tool_name: 'Bash',
      tool_input: { command: 'node -e "const fs=require(\'fs\');const d=JSON.parse(fs.readFileSync(os.homedir()+\'/.memorix/data/observations.json\'))"' },
      tool_response: 'Total: 235',
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
