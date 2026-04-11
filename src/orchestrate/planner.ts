/**
 * Planner — Phase 5: Autonomous goal→tasks decomposition.
 *
 * Seeds a "planning" meta-task that instructs an agent to break a high-level
 * goal into concrete team tasks (via team_task MCP tool).  The existing
 * coordinator loop then executes those tasks naturally.
 *
 * Review tasks include a quality-gate: the reviewer checks completed work
 * and may spawn fix tasks + a follow-up review, up to maxIterations.
 *
 * Key insight: NO changes to the coordinator loop are needed.  Planning and
 * review tasks are regular tasks whose descriptions instruct the agent to
 * call team_task create.  Dependencies handle ordering.  The coordinator's
 * SQLite poll picks up newly-created tasks automatically.
 */

import { randomUUID } from 'node:crypto';
import type { TeamStore } from '../team/team-store.js';

// ── Types ──────────────────────────────────────────────────────────

export interface PlannerConfig {
  goal: string;
  /** Max review→fix cycles (default 3) */
  maxIterations?: number;
  /** Max total tasks the pipeline may create (default 15) */
  taskBudget?: number;
}

export interface PlannerMeta {
  plannerType: 'plan' | 'review';
  pipelineId: string;
  goal: string;
  iteration: number;
  maxIterations: number;
  taskBudget: number;
}

// ── Helpers ────────────────────────────────────────────────────────

/**
 * Parse task metadata to determine if a task is a planner/review task.
 * Returns null for regular worker tasks.
 */
export function isPlannerTask(metadata?: string | null): PlannerMeta | null {
  if (!metadata) return null;
  try {
    const parsed = JSON.parse(metadata);
    if (parsed?.plannerType === 'plan' || parsed?.plannerType === 'review') {
      return parsed as PlannerMeta;
    }
  } catch { /* not planner metadata */ }
  return null;
}

/**
 * Extract pipelineId from any task's metadata (planner, review, or worker).
 * Returns null if the task is not part of an autonomous pipeline.
 */
export function extractPipelineId(metadata?: string | null): string | null {
  if (!metadata) return null;
  try {
    const parsed = JSON.parse(metadata);
    return typeof parsed?.pipelineId === 'string' ? parsed.pipelineId : null;
  } catch { return null; }
}

// ── Guards (server-enforced hard limits) ───────────────────────────

export interface GuardInput {
  /** All existing tasks in the project */
  existingTasks: Array<{ metadata?: string | null }>;
  /** Metadata of the task being created (parsed), if any */
  newTaskMeta?: Record<string, unknown> | null;
}

export type GuardResult =
  | { allowed: true }
  | { allowed: false; reason: string };

/**
 * Enforce autonomous-pipeline limits at the system level.
 *
 * Pipeline-scoped: only counts tasks belonging to the SAME pipelineId.
 * Called by the team_task create handler in server.ts.
 * Tasks without a pipelineId (manual tasks, other pipelines) are never affected.
 */
export function checkPipelineGuards(input: GuardInput): GuardResult {
  // Extract pipelineId from the task being created
  const newPipelineId = typeof input.newTaskMeta?.pipelineId === 'string'
    ? input.newTaskMeta.pipelineId : null;

  // No pipelineId on new task → not part of any autonomous pipeline → allow
  if (!newPipelineId) return { allowed: true };

  // Scan existing tasks: find plan meta + count pipeline members
  let planMeta: PlannerMeta | null = null;
  let pipelineTaskCount = 0;

  for (const t of input.existingTasks) {
    const pid = extractPipelineId(t.metadata);
    if (pid === newPipelineId) {
      pipelineTaskCount++;
      if (!planMeta) {
        const parsed = isPlannerTask(t.metadata);
        if (parsed?.plannerType === 'plan') planMeta = parsed;
      }
    }
  }

  // No planning task found for this pipeline → allow (orphan pipelineId)
  if (!planMeta) return { allowed: true };

  // Guard 1: task budget (pipeline-scoped)
  if (pipelineTaskCount + 1 > planMeta.taskBudget) {
    return {
      allowed: false,
      reason: `Task budget exhausted (${pipelineTaskCount}/${planMeta.taskBudget}). Cannot create more tasks.`,
    };
  }

  // Guard 2: review iteration limit (pipeline-scoped)
  if (input.newTaskMeta?.plannerType === 'review') {
    const iter = typeof input.newTaskMeta.iteration === 'number'
      ? input.newTaskMeta.iteration : 0;
    if (iter > planMeta.maxIterations) {
      return {
        allowed: false,
        reason: `Max review iterations exceeded (${iter}/${planMeta.maxIterations}). Cannot create more review tasks.`,
      };
    }
  }

  return { allowed: true };
}

// ── Seed ───────────────────────────────────────────────────────────

/**
 * Create the initial planning task.  The agent that executes it will
 * decompose the goal into concrete worker + review tasks via team_task.
 */
export function seedAutonomousPipeline(
  teamStore: TeamStore,
  projectId: string,
  config: PlannerConfig,
): { planningTaskId: string; pipelineId: string } {
  const maxIterations = config.maxIterations ?? 3;
  const taskBudget = config.taskBudget ?? 15;

  const pipelineId = randomUUID();

  const meta: PlannerMeta = {
    plannerType: 'plan',
    pipelineId,
    goal: config.goal,
    iteration: 0,
    maxIterations,
    taskBudget,
  };

  const task = teamStore.createTask({
    projectId,
    description: buildPlanningPrompt(config.goal, maxIterations, taskBudget, pipelineId),
    metadata: meta as unknown as Record<string, unknown>,
  });

  return { planningTaskId: task.task_id, pipelineId };
}

// ── Prompts ────────────────────────────────────────────────────────

function buildPlanningPrompt(
  goal: string,
  maxIterations: number,
  taskBudget: number,
  pipelineId: string,
): string {
  const reviewMetaExample = JSON.stringify({
    plannerType: 'review',
    pipelineId,
    goal,
    iteration: 1,
    maxIterations,
    taskBudget,
  });
  const workerMetaExample = JSON.stringify({ pipelineId });

  return `[Role: Project Planner — Autonomous Task Decomposition]

You are the technical lead and project planner for a team of AI agents.
Analyze the goal below and create a concrete, executable task plan.

## Goal
${goal}

## Instructions

1. **Analyze** the goal.  Think about what roles are needed (PM, Engineer, QA, Reviewer) and what order tasks should run in.

2. **Create tasks** using \`team_task action="create"\`.  For each task:
   - Write a clear, self-contained \`description\` starting with \`[Role: <role>]\`.
   - Include ALL context the executing agent will need — file paths, tech choices, acceptance criteria.
   - Set \`deps\` to task IDs of prerequisite tasks (returned by previous create calls).
   - **MANDATORY**: include \`metadata\` with at least: \`'${workerMetaExample}'\`
     (This \`pipelineId\` links every task to this pipeline for budget tracking.)

3. **Suggested structure** (adapt to the goal):
   - 1–2 research / planning tasks (PM writes spec, explores approach)
   - 1–3 implementation tasks (Engineer builds deliverables)
   - 0–1 testing / QA tasks (validate output works)
   - 1 review task (**MANDATORY** — depends on ALL other tasks)

4. **Review task** — create it LAST, depending on every other task.  Its description MUST include:
   \`\`\`
   [Role: Reviewer — Quality Gate (iteration 1/${maxIterations})]
   Review all completed work for this goal: "${goal}"
   Read every output file and check correctness, completeness, and polish.
   • If quality is satisfactory → call memorix_handoff with an approval summary, then exit.
   • If issues found → create fix tasks via team_task action="create" (no deps),
     then create ONE follow-up review task with deps on those fix tasks
     and metadata: '${reviewMetaExample}'
     (increment "iteration" for the follow-up review).
   Task budget remaining: ~${taskBudget - 1}. Do NOT exceed it.
   \`\`\`

5. **Call memorix_handoff** to share your planning rationale with the team.

## Rules
- Task budget: **${taskBudget}** max total tasks (including this planning task).  Create only what's needed.
- Maximum **${maxIterations}** review iterations.
- Each description must be **self-contained** — no assumptions about shared state beyond file paths.
- Prefer fewer, focused tasks over many trivial ones.

Exit when all tasks are created.`;
}

/**
 * Build a hint string for review-iteration context.
 * Can be appended to review task descriptions by agents.
 */
export function buildReviewIterationHint(
  iteration: number,
  maxIterations: number,
  budgetRemaining: number,
): string {
  if (iteration >= maxIterations) {
    return `\n\n⚠️ This is the FINAL review iteration (${iteration}/${maxIterations}). Do NOT create more tasks. Summarize remaining issues and exit.`;
  }
  return `\n\nReview iteration: ${iteration}/${maxIterations}. Budget remaining: ~${budgetRemaining} tasks. You may create fix tasks if needed.`;
}
