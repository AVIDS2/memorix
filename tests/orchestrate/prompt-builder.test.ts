/**
 * Prompt Builder tests — Phase 4c prompt construction.
 */

import { describe, it, expect } from 'vitest';
import { buildAgentPrompt } from '../../src/orchestrate/prompt-builder.js';
import type { TeamTaskRow } from '../../src/team/team-store.js';

function makeTask(overrides?: Partial<TeamTaskRow>): TeamTaskRow {
  return {
    task_id: 'task-001',
    project_id: 'proj1',
    description: 'Implement feature X',
    status: 'pending',
    assignee_agent_id: null,
    result: null,
    metadata: null,
    created_by: null,
    created_at: Date.now(),
    updated_at: Date.now(),
    ...overrides,
  };
}

describe('buildAgentPrompt', () => {
  it('should include task description and coordinator ID (not as worker identity)', () => {
    const prompt = buildAgentPrompt({
      task: makeTask(),
      handoffs: [],
      agentId: 'agent-abc',
      projectId: 'proj1',
      projectDir: '/home/user/project',
    });

    expect(prompt).toContain('task-001');
    expect(prompt).toContain('Implement feature X');
    expect(prompt).toContain('agent-abc');
    expect(prompt).toContain('proj1');
    expect(prompt).toContain('/home/user/project');
    // Must NOT present orchestrator agentId as worker's own identity
    expect(prompt).not.toContain('Your agent ID is');
    expect(prompt).toContain('Coordinator agent ID');
    expect(prompt).toContain('NOT your identity');
  });

  it('should include handoff context when provided', () => {
    const prompt = buildAgentPrompt({
      task: makeTask(),
      handoffs: [
        {
          fromAgent: 'agent-prev',
          summary: 'Built the API layer',
          context: 'All endpoints passing tests',
          filesModified: ['src/api.ts', 'tests/api.test.ts'],
        },
      ],
      agentId: 'agent-abc',
      projectId: 'proj1',
      projectDir: '/tmp/proj',
    });

    expect(prompt).toContain('agent-prev');
    expect(prompt).toContain('Built the API layer');
    expect(prompt).toContain('All endpoints passing tests');
    expect(prompt).toContain('src/api.ts');
  });

  it('should not include handoff section when no handoffs', () => {
    const prompt = buildAgentPrompt({
      task: makeTask(),
      handoffs: [],
      agentId: 'agent-abc',
      projectId: 'proj1',
      projectDir: '/tmp/proj',
    });

    expect(prompt).not.toContain('Context from Previous Agents');
  });

  it('should include memorix tool instructions (方案 A: no team_task)', () => {
    const prompt = buildAgentPrompt({
      task: makeTask(),
      handoffs: [],
      agentId: 'agent-abc',
      projectId: 'proj1',
      projectDir: '/tmp/proj',
    });

    expect(prompt).toContain('memorix_session_start');
    expect(prompt).toContain('memorix_poll');
    // 方案 A: agent must NOT call team_task — orchestrator manages lifecycle
    expect(prompt).toContain('Do NOT call `team_task`');
    expect(prompt).toContain('orchestrator manages task state');
  });

  it('should include exit-code-based completion criteria', () => {
    const prompt = buildAgentPrompt({
      task: makeTask(),
      handoffs: [],
      agentId: 'agent-abc',
      projectId: 'proj1',
      projectDir: '/tmp/proj',
    });

    expect(prompt).toContain('Completion Criteria');
    expect(prompt).toContain('Exit with code 0');
    expect(prompt).toContain('non-zero code');
    expect(prompt).toContain('orchestrator will determine');
  });

  it('should instruct worker to use session_start agentId, not orchestrator ID (identity contract)', () => {
    const prompt = buildAgentPrompt({
      task: makeTask(),
      handoffs: [],
      agentId: 'orch-id-123',
      projectId: 'proj1',
      projectDir: '/tmp/proj',
    });

    // Worker must derive identity from session_start
    expect(prompt).toContain('agentId returned by `memorix_session_start`');
    expect(prompt).toContain('YOUR identity');
    // Orchestrator ID is present but clearly labeled as NOT the worker's
    expect(prompt).toContain('orch-id-123');
    expect(prompt).toContain('belongs to the orchestrator, not to you');
  });

  it('should NOT instruct agent to call team_task complete or fail (方案 A contract)', () => {
    const prompt = buildAgentPrompt({
      task: makeTask(),
      handoffs: [],
      agentId: 'agent-abc',
      projectId: 'proj1',
      projectDir: '/tmp/proj',
    });

    // These are the old (broken) instructions — must not appear
    expect(prompt).not.toContain('action "complete"');
    expect(prompt).not.toContain('action "fail"');
    expect(prompt).not.toMatch(/call.*team_task.*complete/);
  });
});
