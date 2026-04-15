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
import { isPlannerTask } from './planner.js';

export interface HandoffContext {
  fromAgent: string;
  fromTaskId?: string;
  fromRole?: string;
  summary: string;
  context: string;
  outputFiles?: string[];
  keyDecisions?: string[];
  openQuestions?: string[];
  /** @deprecated Use outputFiles instead */
  filesModified?: string[];
}

export interface PromptInput {
  task: TeamTaskRow;
  handoffs: HandoffContext[];
  agentId: string;
  projectId: string;
  projectDir: string;
  /** Phase 6d: Ledger context for pipeline progress */
  ledgerContext?: string;
  /** Phase 6d: Task position in pipeline (0-indexed) */
  taskIndex?: number;
  /** Phase 6d: Total tasks in pipeline */
  totalTasks?: number;
  /** Phase 7: Lesson context from Memorix (advisory) */
  lessonContext?: string;
  /** Phase 7: Goal verification — acceptance criteria for this task */
  goals?: string[];
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

  // 3. Ledger context (Phase 6d — pipeline progress)
  if (input.ledgerContext) {
    sections.push(input.ledgerContext);
  }

  // Phase 7: Lesson injection (advisory)
  if (input.lessonContext) {
    sections.push(input.lessonContext);
  }

  // Phase 7: Goal verification — acceptance criteria
  if (input.goals && input.goals.length > 0) {
    sections.push([
      '## Acceptance Criteria',
      '',
      'Your work will be verified against these goals:',
      ...input.goals.map((g, i) => `${i + 1}. ${g}`),
      '',
      'Ensure ALL criteria are satisfied before finishing.',
    ].join('\n'));
  }

  // 4. Handoff context from previous agents
  if (input.handoffs.length > 0) {
    const handoffLines = input.handoffs.map((h, i) => {
      const lines = [
        `### Handoff ${i + 1} (from ${h.fromAgent}${h.fromRole ? ` [${h.fromRole}]` : ''})`,
        `Summary: ${h.summary}`,
        `Context: ${h.context}`,
      ];
      const files = h.outputFiles ?? h.filesModified;
      if (files?.length) lines.push(`Files: ${files.join(', ')}`);
      if (h.keyDecisions?.length) lines.push(`Key decisions: ${h.keyDecisions.join('; ')}`);
      if (h.openQuestions?.length) lines.push(`Open questions: ${h.openQuestions.join('; ')}`);
      return lines.filter(Boolean).join('\n');
    });

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
  const plannerMeta = isPlannerTask(input.task.metadata);
  const isAutonomous = !!plannerMeta;

  const taskInstruction = isAutonomous
    ? '5. You have FULL ACCESS to `team_task action="create"` for creating subtasks. Follow the instructions in your task description.'
    : '5. Focus on completing the work. Do NOT call `team_task` — the orchestrator manages task state.';

  const creationRule = isAutonomous
    ? '8. Create tasks as instructed in your task description. Respect the task budget and include proper dependencies.'
    : '8. Do NOT create new tasks unless the original task explicitly requires subtask decomposition.';

  sections.push([
    '## Instructions',
    '',
    '1. Start by calling `memorix_session_start` to bind to this project.',
    '2. Use the agentId returned by `memorix_session_start` as YOUR identity for any identity-bearing calls (e.g. `memorix_handoff` fromAgentId). Do NOT use the coordinator agent ID above — that belongs to the orchestrator, not to you.',
    '3. Call `memorix_poll` to check for any additional context or messages.',
    `4. Work on the task described above. The task is already claimed and managed by the orchestrator.`,
    taskInstruction,
    '6. If you want to leave context for the next agent, call `memorix_handoff` with a summary of what you did.',
    '7. Use `memorix_store` to save any important discoveries, decisions, or gotchas.',
    creationRule,
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
