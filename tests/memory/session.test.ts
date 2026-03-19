/**
 * Session Lifecycle Tests
 *
 * Tests session start/end, context injection, and cross-session awareness.
 * Inspired by Engram's session management pattern.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../src/embedding/provider.js', () => ({
  getEmbeddingProvider: async () => null,
  isVectorSearchAvailable: async () => false,
  resetProvider: () => {},
}));

import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { startSession, endSession, getSessionContext, listSessions, getActiveSession } from '../../src/memory/session.js';
import { storeObservation, initObservations, resolveObservations } from '../../src/memory/observations.js';
import { resetDb } from '../../src/store/orama-store.js';

let testDir: string;
const PROJECT_ID = 'test/session-lifecycle';

beforeEach(async () => {
  testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memorix-session-'));
  await resetDb();
  await initObservations(testDir);
});

describe('Session Lifecycle', () => {
  describe('startSession', () => {
    it('should create a new session with auto-generated ID', async () => {
      const result = await startSession(testDir, PROJECT_ID);

      expect(result.session.id).toMatch(/^sess-/);
      expect(result.session.projectId).toBe(PROJECT_ID);
      expect(result.session.status).toBe('active');
      expect(result.session.startedAt).toBeTruthy();
    });

    it('should use custom session ID when provided', async () => {
      const result = await startSession(testDir, PROJECT_ID, { sessionId: 'custom-123' });

      expect(result.session.id).toBe('custom-123');
    });

    it('should record agent name', async () => {
      const result = await startSession(testDir, PROJECT_ID, { agent: 'windsurf' });

      expect(result.session.agent).toBe('windsurf');
    });

    it('should auto-close previous active sessions', async () => {
      await startSession(testDir, PROJECT_ID, { sessionId: 'first' });
      await startSession(testDir, PROJECT_ID, { sessionId: 'second' });

      const sessions = await listSessions(testDir, PROJECT_ID);
      const first = sessions.find(s => s.id === 'first');
      const second = sessions.find(s => s.id === 'second');

      expect(first?.status).toBe('completed');
      expect(first?.endedAt).toBeTruthy();
      expect(second?.status).toBe('active');
    });

    it('should return empty context for fresh project', async () => {
      const result = await startSession(testDir, PROJECT_ID);

      expect(result.previousContext).toBe('');
    });

    it('should persist session to disk', async () => {
      await startSession(testDir, PROJECT_ID, { sessionId: 'persist-test' });

      const sessions = await listSessions(testDir, PROJECT_ID);
      expect(sessions).toHaveLength(1);
      expect(sessions[0].id).toBe('persist-test');
    });
  });

  describe('endSession', () => {
    it('should mark session as completed', async () => {
      await startSession(testDir, PROJECT_ID, { sessionId: 'end-test' });
      const ended = await endSession(testDir, 'end-test', '## Goal\nTest session end');

      expect(ended).not.toBeNull();
      expect(ended!.status).toBe('completed');
      expect(ended!.endedAt).toBeTruthy();
      expect(ended!.summary).toBe('## Goal\nTest session end');
    });

    it('should return null for non-existent session', async () => {
      const result = await endSession(testDir, 'nonexistent');

      expect(result).toBeNull();
    });

    it('should work without summary', async () => {
      await startSession(testDir, PROJECT_ID, { sessionId: 'no-summary' });
      const ended = await endSession(testDir, 'no-summary');

      expect(ended).not.toBeNull();
      expect(ended!.status).toBe('completed');
      expect(ended!.summary).toBeUndefined();
    });
  });

  describe('getSessionContext', () => {
    it('should return previous session summary in context', async () => {
      // Create and end a session with summary
      await startSession(testDir, PROJECT_ID, { sessionId: 'ctx-test', agent: 'cursor' });
      await endSession(testDir, 'ctx-test', '## Goal\nImplement auth module\n\n## Accomplished\n- ✅ JWT middleware');

      // Get context for new session
      const context = await getSessionContext(testDir, PROJECT_ID);

      expect(context).toContain('Previous Session');
      expect(context).toContain('Implement auth module');
      expect(context).toContain('JWT middleware');
    });

    it('should include key observations in context', async () => {
      // Store some priority observations
      await storeObservation({
        entityName: 'auth',
        type: 'gotcha',
        title: 'JWT tokens expire silently',
        narrative: 'Tokens expire without notification',
        facts: ['Expiry: 24h'],
        projectId: PROJECT_ID,
      });

      await storeObservation({
        entityName: 'deploy',
        type: 'decision',
        title: 'Use Docker for deployment',
        narrative: 'Chose Docker over bare metal',
        projectId: PROJECT_ID,
      });

      const context = await getSessionContext(testDir, PROJECT_ID);

      expect(context).toContain('Key Memories');
      expect(context).toContain('JWT tokens expire silently');
      expect(context).toContain('Use Docker for deployment');
    });

    it('should prefer relevant project memories over newer noisy demo records', async () => {
      await storeObservation({
        entityName: 'deploy',
        type: 'decision',
        title: 'Use blue-green deploys for my_status',
        narrative: 'my_status should keep the deployment switch safe',
        facts: ['my_status deploy switch uses blue-green rollout'],
        projectId: PROJECT_ID,
        filesModified: ['E:/code/test/session-lifecycle/my_status/deploy.ts'],
      });

      await storeObservation({
        entityName: 'memorix-demo',
        type: 'discovery',
        title: 'Memorix 全能力展示 - Antigravity IDE',
        narrative: '这是一个演示记录，不应该默认注入到新会话',
        facts: ['demo-only'],
        projectId: PROJECT_ID,
        filesModified: ['E:/code/for_memmcp_test/demo.ts'],
      });

      const context = await getSessionContext(testDir, PROJECT_ID);

      expect(context).toContain('Use blue-green deploys for my_status');
      expect(context).not.toContain('Memorix 全能力展示 - Antigravity IDE');
    });

    it('should ignore resolved observations during context injection', async () => {
      const { observation: resolvedObservation } = await storeObservation({
        entityName: 'auth',
        type: 'gotcha',
        title: 'Old gotcha should stay resolved',
        narrative: 'This was fixed already and should not be injected again',
        facts: ['resolved memory'],
        projectId: PROJECT_ID,
      });
      await resolveObservations([resolvedObservation.id], 'resolved');

      await storeObservation({
        entityName: 'auth',
        type: 'problem-solution',
        title: 'Current auth fix',
        narrative: 'This is the still-active memory the session should see',
        facts: ['active memory'],
        projectId: PROJECT_ID,
      });

      const context = await getSessionContext(testDir, PROJECT_ID);

      expect(context).toContain('Current auth fix');
      expect(context).not.toContain('Old gotcha should stay resolved');
    });

    it('should show session history for multiple sessions', async () => {
      // Create 3 sessions
      await startSession(testDir, PROJECT_ID, { sessionId: 'hist-1' });
      await endSession(testDir, 'hist-1', '## Goal\nFirst session');

      await startSession(testDir, PROJECT_ID, { sessionId: 'hist-2' });
      await endSession(testDir, 'hist-2', '## Goal\nSecond session');

      await startSession(testDir, PROJECT_ID, { sessionId: 'hist-3' });
      await endSession(testDir, 'hist-3', '## Goal\nThird session');

      const context = await getSessionContext(testDir, PROJECT_ID, 3);

      expect(context).toContain('Session History');
    });

    it('should return empty string for project with no sessions or observations', async () => {
      const context = await getSessionContext(testDir, 'empty-project');

      expect(context).toBe('');
    });
  });

  describe('listSessions', () => {
    it('should list all sessions for a project', async () => {
      await startSession(testDir, PROJECT_ID, { sessionId: 's1' });
      await startSession(testDir, PROJECT_ID, { sessionId: 's2' });
      await startSession(testDir, 'other-project', { sessionId: 's3' });

      const projectSessions = await listSessions(testDir, PROJECT_ID);
      const allSessions = await listSessions(testDir);

      expect(projectSessions).toHaveLength(2);
      expect(allSessions).toHaveLength(3);
    });
  });

  describe('getActiveSession', () => {
    it('should return the active session', async () => {
      await startSession(testDir, PROJECT_ID, { sessionId: 'active-test' });

      const active = await getActiveSession(testDir, PROJECT_ID);

      expect(active).not.toBeNull();
      expect(active!.id).toBe('active-test');
      expect(active!.status).toBe('active');
    });

    it('should return null when no active session', async () => {
      await startSession(testDir, PROJECT_ID, { sessionId: 'ended' });
      await endSession(testDir, 'ended');

      const active = await getActiveSession(testDir, PROJECT_ID);

      expect(active).toBeNull();
    });
  });

  describe('cross-agent alias resolution', () => {
    const ALIAS_A = 'local/my-project';
    const ALIAS_B = 'github.com/user/my-project';

    async function registerTestAliases() {
      const { initAliasRegistry, registerAlias } = await import('../../src/project/aliases.js');
      initAliasRegistry(testDir);
      await registerAlias({ id: ALIAS_A, name: 'my-project', rootPath: '/tmp/a' });
      await registerAlias({ id: ALIAS_B, name: 'my-project', rootPath: '/tmp/a', gitRemote: 'https://github.com/user/my-project.git' });
    }

    it('should find sessions stored under a different alias', async () => {
      await registerTestAliases();

      // Agent A stores session under ALIAS_A
      await startSession(testDir, ALIAS_A, { sessionId: 'alias-sess', agent: 'windsurf' });
      await endSession(testDir, 'alias-sess', '## Goal\nCross-agent test');

      // Agent B queries under ALIAS_B — should still find it
      const sessions = await listSessions(testDir, ALIAS_B);
      expect(sessions.length).toBeGreaterThanOrEqual(1);
      expect(sessions.some(s => s.id === 'alias-sess')).toBe(true);
    });

    it('should inject context from aliased sessions', async () => {
      await registerTestAliases();

      // Store session + observation under ALIAS_A
      await startSession(testDir, ALIAS_A, { sessionId: 'ctx-alias', agent: 'cursor' });
      await endSession(testDir, 'ctx-alias', '## Goal\nAlias context test');

      await storeObservation({
        entityName: 'auth',
        type: 'gotcha',
        title: 'Cross-agent gotcha',
        narrative: 'Found via alias',
        projectId: ALIAS_A,
      });

      // Query context under ALIAS_B
      const context = await getSessionContext(testDir, ALIAS_B);
      expect(context).toContain('Alias context test');
      expect(context).toContain('Cross-agent gotcha');
    });

    it('should auto-close aliased active sessions on new start', async () => {
      await registerTestAliases();

      // Agent A starts session under ALIAS_A
      await startSession(testDir, ALIAS_A, { sessionId: 'old-active' });

      // Agent B starts new session under ALIAS_B — should close old one
      await startSession(testDir, ALIAS_B, { sessionId: 'new-active' });

      const sessions = await listSessions(testDir);
      const old = sessions.find(s => s.id === 'old-active');
      const fresh = sessions.find(s => s.id === 'new-active');

      expect(old?.status).toBe('completed');
      expect(fresh?.status).toBe('active');
    });

    it('should find active session via alias', async () => {
      await registerTestAliases();

      await startSession(testDir, ALIAS_A, { sessionId: 'active-alias' });

      const active = await getActiveSession(testDir, ALIAS_B);
      expect(active).not.toBeNull();
      expect(active!.id).toBe('active-alias');
    });
  });

  describe('Noise filtering in session injection', () => {
    it('should exclude demo/test observations from session context', async () => {
      // Store a legitimate observation
      await storeObservation({
        entityName: 'blog-deploy',
        type: 'decision',
        title: 'Deploy blog to Vercel',
        narrative: 'Chose Vercel for blog deployment due to zero-config Next.js support',
        facts: ['Vercel auto-deploys on push'],
        filesModified: [],
        concepts: ['deployment'],
        projectId: PROJECT_ID,
      });

      // Store a demo pollution observation
      await storeObservation({
        entityName: 'memorix-demo',
        type: 'discovery',
        title: 'Memorix 全能力展示 - Antigravity IDE',
        narrative: 'Complete demo of all 22 tools',
        facts: ['Tested all tools'],
        filesModified: [],
        concepts: ['memorix', 'demo'],
        projectId: PROJECT_ID,
      });

      // Store a test pollution observation
      await storeObservation({
        entityName: 'for_memmcp_test',
        type: 'gotcha',
        title: '[测试] Memorix 兼容性检测',
        narrative: 'Testing compat with memmcp',
        facts: ['compat verified'],
        filesModified: [],
        concepts: ['testing'],
        projectId: PROJECT_ID,
      });

      const context = await getSessionContext(testDir, PROJECT_ID);

      // Legitimate observation should appear
      expect(context).toContain('Deploy blog to Vercel');
      // Demo/test observations should NOT appear
      expect(context).not.toContain('全能力展示');
      expect(context).not.toContain('兼容性检测');
      expect(context).not.toContain('memorix-demo');
      expect(context).not.toContain('for_memmcp_test');
    });

    it('should exclude system-self observations about Memorix runtime/injection', async () => {
      await storeObservation({
        entityName: 'my-status-feature',
        type: 'decision',
        title: 'Use React Query for data fetching',
        narrative: 'Chose React Query over SWR for caching',
        facts: ['Better cache invalidation'],
        filesModified: ['src/hooks/useData.ts'],
        concepts: ['react-query'],
        projectId: PROJECT_ID,
      });

      await storeObservation({
        entityName: 'memorix-runtime',
        type: 'discovery',
        title: 'Different users need different Memorix runtime modes',
        narrative: 'Session injection now filters noisy context for control-plane',
        facts: ['Runtime mode affects injection'],
        filesModified: [],
        concepts: ['memorix', 'runtime'],
        projectId: PROJECT_ID,
      });

      const context = await getSessionContext(testDir, PROJECT_ID);

      expect(context).toContain('React Query');
      expect(context).not.toContain('Memorix runtime modes');
      expect(context).not.toContain('Session injection');
    });
  });
});
