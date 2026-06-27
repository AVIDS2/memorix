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

    it('should detect Antigravity from gemini_session_id', () => {
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

    it('should detect Gemini CLI from _memorix_agent override', () => {
      const input = normalizeHookInput({
        hook_event_name: 'AfterTool',
        cwd: '/project',
        tool_name: 'edit_file',
        _memorix_agent: 'gemini-cli',
      });
      expect(input.agent).toBe('gemini-cli');
      expect(input.event).toBe('post_tool');
      expect(input.toolName).toBe('edit_file');
    });

    it('_memorix_agent takes priority over all other detection heuristics', () => {
      // Even with gemini_session_id (which normally → antigravity), _memorix_agent wins
      const input = normalizeHookInput({
        hook_event_name: 'SessionStart',
        gemini_session_id: 'gem-999',
        _memorix_agent: 'gemini-cli',
      });
      expect(input.agent).toBe('gemini-cli');
    });

    it('should still detect Antigravity when _memorix_agent is not present', () => {
      const input = normalizeHookInput({
        hook_event_name: 'SessionStart',
        gemini_session_id: 'gem-999',
      });
      expect(input.agent).toBe('antigravity');
    });

    it('should detect Antigravity from generated plugin override and official payload fields', () => {
      const input = normalizeHookInput({
        _memorix_agent: 'antigravity',
        _memorix_event: 'PreToolUse',
        conversationId: 'ag-123',
        workspacePaths: ['/project'],
        transcriptPath: '/tmp/transcript.jsonl',
        toolCall: {
          name: 'run_command',
          args: { CommandLine: 'npm test' },
        },
      });

      expect(input.agent).toBe('antigravity');
      expect(input.event).toBe('post_tool');
      expect(input.sessionId).toBe('ag-123');
      expect(input.cwd).toBe('/project');
      expect(input.transcriptPath).toBe('/tmp/transcript.jsonl');
      expect(input.toolName).toBe('run_command');
      expect(input.toolInput).toEqual({ CommandLine: 'npm test' });
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

    it('should normalize Antigravity PreInvocation → session_start', () => {
      const input = normalizeHookInput({
        _memorix_agent: 'antigravity',
        _memorix_event: 'PreInvocation',
        conversationId: 'ag-2',
        workspacePaths: ['/project'],
      });

      expect(input.agent).toBe('antigravity');
      expect(input.event).toBe('session_start');
      expect(input.sessionId).toBe('ag-2');
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

    it('should normalize OpenCode message.updated → post_response with aiResponse', () => {
      const input = normalizeHookInput({
        agent: 'opencode',
        hook_event_name: 'message.updated',
        ai_response: 'Finished implementing the fix and updated the tests.',
        session_id: 'oc-1',
        cwd: '/project',
      });
      expect(input.agent).toBe('opencode');
      expect(input.event).toBe('post_response');
      expect(input.aiResponse).toBe('Finished implementing the fix and updated the tests.');
    });

    it('should normalize Pi package extension tool_result events', () => {
      const input = normalizeHookInput({
        agent: 'pi',
        hook_event_name: 'pi.tool_result',
        session_id: 'pi-1',
        cwd: '/project',
        tool_name: 'write',
        tool_input: { path: '/project/src/app.ts' },
        tool_result: { content: [{ type: 'text', text: 'wrote file' }] },
      });
      expect(input.agent).toBe('pi');
      expect(input.event).toBe('post_tool');
      expect(input.toolName).toBe('write');
      expect(input.filePath).toBe('/project/src/app.ts');
      expect(input.toolResult).toContain('wrote file');
    });

    it('should normalize Pi package extension prompt and response events', () => {
      const prompt = normalizeHookInput({
        agent: 'pi',
        hook_event_name: 'pi.before_agent_start',
        prompt: 'continue the plugin integration',
        cwd: '/project',
      });
      expect(prompt.event).toBe('user_prompt');
      expect(prompt.userPrompt).toBe('continue the plugin integration');

      const response = normalizeHookInput({
        agent: 'pi',
        hook_event_name: 'pi.agent_end',
        ai_response: 'Implemented the Pi package and verified setup.',
        cwd: '/project',
      });
      expect(response.event).toBe('post_response');
      expect(response.aiResponse).toBe('Implemented the Pi package and verified setup.');
    });

    it('should normalize Oh-my-Pi package extension events', () => {
      const input = normalizeHookInput({
        agent: 'omp',
        hook_event_name: 'omp.tool_result',
        session_id: 'omp-1',
        cwd: '/project',
        tool_name: 'write',
        tool_input: { path: '/project/src/omp.ts' },
        tool_result: { content: [{ type: 'text', text: 'wrote omp file' }] },
      });
      expect(input.agent).toBe('omp');
      expect(input.event).toBe('post_tool');
      expect(input.toolName).toBe('write');
      expect(input.filePath).toBe('/project/src/omp.ts');
      expect(input.toolResult).toContain('wrote omp file');
    });

    it('should normalize Hermes plugin hook wrapper events', () => {
      const prompt = normalizeHookInput({
        agent: 'hermes',
        hook_event_name: 'hermes.pre_llm_call',
        session_id: 'hermes-1',
        payload: {
          kwargs: {
            cwd: '/project',
            prompt: 'load relevant memorix context',
          },
        },
      });
      expect(prompt.agent).toBe('hermes');
      expect(prompt.event).toBe('user_prompt');
      expect(prompt.cwd).toBe('/project');
      expect(prompt.userPrompt).toBe('load relevant memorix context');

      const response = normalizeHookInput({
        agent: 'hermes',
        hook_event_name: 'hermes.post_llm_call',
        payload: {
          kwargs: {
            ai_response: 'Hermes plugin captured the response.',
          },
        },
      });
      expect(response.event).toBe('post_response');
      expect(response.aiResponse).toBe('Hermes plugin captured the response.');
    });

    it('should normalize OpenClaw hook-pack lifecycle events', () => {
      const bootstrap = normalizeHookInput({
        agent: 'openclaw',
        hook_event_name: 'openclaw.agent:bootstrap',
        session_id: 'oclaw-1',
        openclaw_event: {
          sessionKey: 'session-key',
          context: {
            cwd: '/project',
          },
        },
      });
      expect(bootstrap.agent).toBe('openclaw');
      expect(bootstrap.event).toBe('session_start');
      expect(bootstrap.sessionId).toBe('oclaw-1');
      expect(bootstrap.cwd).toBe('/project');

      const compact = normalizeHookInput({
        agent: 'openclaw',
        hook_event_name: 'openclaw.session:compact:before',
        openclaw_event: {
          sessionKey: 'session-key',
        },
      });
      expect(compact.event).toBe('pre_compact');
      expect(compact.sessionId).toBe('session-key');
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
