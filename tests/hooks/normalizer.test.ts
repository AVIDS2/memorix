/**
 * Tests for Hook Normalizer
 */

import { describe, it, expect } from 'vitest';
import { normalizeHookInput } from '../../src/hooks/normalizer.js';

describe('Hook Normalizer', () => {
  describe('agent detection', () => {
    it('should detect Windsurf from agent_action_name', () => {
      const input = normalizeHookInput({
        agent_action_name: 'post_write_code',
        trajectory_id: 'traj-123',
        tool_info: { file_path: '/src/app.ts' },
      });
      expect(input.agent).toBe('windsurf');
      expect(input.event).toBe('post_edit');
      expect(input.filePath).toBe('/src/app.ts');
    });

    it('should detect Cursor from conversation_id + hook_event_name', () => {
      const input = normalizeHookInput({
        hook_event_name: 'afterFileEdit',
        conversation_id: 'conv-456',
        generation_id: 'gen-789',
        file_path: '/src/main.ts',
        workspace_roots: ['/home/user/project'],
      });
      expect(input.agent).toBe('cursor');
      expect(input.event).toBe('post_edit');
      expect(input.filePath).toBe('/src/main.ts');
    });

    it('should detect Claude Code from hook_event_name + session_id', () => {
      const input = normalizeHookInput({
        hook_event_name: 'PostToolUse',
        session_id: 'sess-001',
        cwd: '/project',
        tool_name: 'write',
        tool_input: { file_path: '/src/index.ts' },
      });
      expect(input.agent).toBe('claude');
      expect(input.event).toBe('post_tool');
      expect(input.toolName).toBe('write');
    });

    it('should detect Copilot from toolName (camelCase)', () => {
      const input = normalizeHookInput({
        toolName: 'read_file',
        toolResult: { textResultForLlm: 'file contents' },
      });
      expect(input.agent).toBe('copilot');
      expect(input.event).toBe('post_tool');
      expect(input.toolName).toBe('read_file');
    });

    it('should detect Antigravity/Gemini CLI from gemini_session_id', () => {
      const input = normalizeHookInput({
        hook_event_name: 'AfterTool',
        gemini_session_id: 'gem-123',
        gemini_project_dir: '/project',
        tool_name: 'write_file',
      });
      expect(input.agent).toBe('antigravity');
      expect(input.event).toBe('post_tool');
      expect(input.toolName).toBe('write_file');
    });
  });

  describe('event normalization', () => {
    it('should normalize Windsurf post_run_command → post_command', () => {
      const input = normalizeHookInput({
        agent_action_name: 'post_run_command',
        trajectory_id: 'traj-1',
        tool_info: { command_line: 'npm test', cwd: '/project' },
      });
      expect(input.event).toBe('post_command');
      expect(input.command).toBe('npm test');
    });

    it('should normalize Cursor beforeSubmitPrompt → user_prompt', () => {
      const input = normalizeHookInput({
        hook_event_name: 'beforeSubmitPrompt',
        conversation_id: 'c1',
        generation_id: 'g1',
        prompt: 'fix the bug in auth.ts',
        workspace_roots: ['/project'],
      });
      expect(input.event).toBe('user_prompt');
      expect(input.userPrompt).toBe('fix the bug in auth.ts');
    });

    it('should normalize Claude SessionStart → session_start', () => {
      const input = normalizeHookInput({
        hook_event_name: 'SessionStart',
        session_id: 'sess-1',
        cwd: '/project',
      });
      expect(input.event).toBe('session_start');
    });

    it('should normalize Copilot sessionStart from initialPrompt', () => {
      const input = normalizeHookInput({
        source: 'copilot',
        initialPrompt: 'fix the bug',
      });
      expect(input.agent).toBe('copilot');
      expect(input.event).toBe('session_start');
      expect(input.userPrompt).toBe('fix the bug');
    });

    it('should normalize Copilot postToolUse with toolResult', () => {
      const input = normalizeHookInput({
        toolName: 'edit_file',
        toolArgs: '{"file_path":"/src/app.ts"}',
        toolResult: { textResultForLlm: 'File edited successfully' },
      });
      expect(input.agent).toBe('copilot');
      expect(input.event).toBe('post_tool');
      expect(input.toolName).toBe('edit_file');
      expect(input.toolResult).toBe('File edited successfully');
    });

    it('should normalize Gemini CLI AfterAgent → post_response', () => {
      const input = normalizeHookInput({
        hook_event_name: 'AfterAgent',
        gemini_session_id: 'gem-1',
        cwd: '/project',
      });
      expect(input.agent).toBe('antigravity');
      expect(input.event).toBe('post_response');
    });

    it('should normalize Gemini CLI PreCompress → pre_compact', () => {
      const input = normalizeHookInput({
        hook_event_name: 'PreCompress',
        gemini_session_id: 'gem-2',
      });
      expect(input.agent).toBe('antigravity');
      expect(input.event).toBe('pre_compact');
    });

    it('should normalize Windsurf post_cascade_response → post_response', () => {
      const input = normalizeHookInput({
        agent_action_name: 'post_cascade_response',
        trajectory_id: 'traj-1',
        tool_info: { response: 'I fixed the bug by...' },
      });
      expect(input.event).toBe('post_response');
      expect(input.aiResponse).toBe('I fixed the bug by...');
    });

    it('should normalize Windsurf MCP tool use', () => {
      const input = normalizeHookInput({
        agent_action_name: 'post_mcp_tool_use',
        trajectory_id: 'traj-1',
        tool_info: {
          mcp_server_name: 'github',
          mcp_tool_name: 'create_issue',
          mcp_tool_arguments: { title: 'Bug report' },
          mcp_result: 'Issue created',
        },
      });
      expect(input.event).toBe('post_tool');
      expect(input.toolName).toBe('create_issue');
      expect(input.toolResult).toBe('Issue created');
    });
  });

  describe('preserves raw payload', () => {
    it('should store the original payload in raw field', () => {
      const original = {
        agent_action_name: 'post_write_code',
        trajectory_id: 'traj-1',
        execution_id: 'exec-1',
        custom_field: 'custom_value',
        tool_info: { file_path: '/src/app.ts' },
      };
      const input = normalizeHookInput(original);
      expect(input.raw).toBe(original);
    });
  });
});
