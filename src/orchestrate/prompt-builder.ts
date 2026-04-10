/**
 * Prompt Builder — Constructs agent prompts for orchestrated task execution.
 *
 * Builds a structured prompt that includes:
 * 1. Role and task description
 * 2. Handoff context from previous agents (if any)
 * 3. Memorix tool usage instructions
 * 4. Completion criteria
 */

import type { TeamTaskRow } from '../team/team-store.js';

export interface HandoffContext {
  fromAgent: string;
  summary: string;
  context: string;
  filesModified?: string[];
}

export interface PromptInput {
  task: TeamTaskRow;
  handoffs: HandoffContext[];
  agentId: string;
  projectId: string;
  projectDir: string;
}

export function buildAgentPrompt(input: PromptInput): string {
  const sections: string[] = [];

  // 1. Role assignment
  sections.push([
    `You are an autonomous coding agent working on project "${input.projectId}".`,
    `Coordinator agent ID (for reference only, NOT your identity): ${input.agentId}`,
    `Working directory: ${input.projectDir}`,
  ].join('\n'));

  // 2. Task description
  sections.push([
    '## Your Task',
    '',
    `Task ID: ${input.task.task_id}`,
    `Description: ${input.task.description}`,
    input.task.metadata ? `Metadata: ${input.task.metadata}` : '',
  ].filter(Boolean).join('\n'));

  // 3. Handoff context from previous agents
  if (input.handoffs.length > 0) {
    const handoffLines = input.handoffs.map((h, i) => [
      `### Handoff ${i + 1} (from ${h.fromAgent})`,
      `Summary: ${h.summary}`,
      `Context: ${h.context}`,
      h.filesModified?.length ? `Files modified: ${h.filesModified.join(', ')}` : '',
    ].filter(Boolean).join('\n'));

    sections.push([
      '## Context from Previous Agents',
      '',
      'The following handoff artifacts were left by agents who worked on related tasks.',
      'Use this context to avoid re-doing work and to understand the current state.',
      '',
      ...handoffLines,
    ].join('\n'));
  }

  // 4. Memorix tool instructions
  sections.push([
    '## Instructions',
    '',
    '1. Start by calling `memorix_session_start` to bind to this project.',
    '2. Use the agentId returned by `memorix_session_start` as YOUR identity for any identity-bearing calls (e.g. `memorix_handoff` fromAgentId). Do NOT use the coordinator agent ID above — that belongs to the orchestrator, not to you.',
    '3. Call `memorix_poll` to check for any additional context or messages.',
    `4. Work on the task described above. The task is already claimed and managed by the orchestrator.`,
    '5. Focus on completing the work. Do NOT call `team_task` — the orchestrator manages task state.',
    '6. If you want to leave context for the next agent, call `memorix_handoff` with a summary of what you did.',
    '7. Use `memorix_store` to save any important discoveries, decisions, or gotchas.',
    '8. Do NOT create new tasks unless the original task explicitly requires subtask decomposition.',
  ].join('\n'));

  // 5. Completion criteria
  sections.push([
    '## Completion Criteria',
    '',
    '- Exit with code 0 when the task is successfully completed.',
    '- Exit with a non-zero code if you cannot complete the task.',
    '- The orchestrator will determine task success/failure based on your exit code.',
    '- You do NOT need to mark the task as completed or failed — that is handled automatically.',
  ].join('\n'));

  return sections.join('\n\n');
}
