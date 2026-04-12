/**
 * Planner — Phase 6c: Structured goal→tasks decomposition.
 *
 * Seeds a "planning" meta-task. The planner agent returns a structured
 * JSON TaskGraph (validated by Zod). The coordinator then calls
 * materializeTaskGraph() to create real tasks with system-injected
 * pipelineId (eliminating D1 debt: no more prompt-compliance dependency).
 *
 * Review tasks include a quality-gate: the reviewer checks completed work
 * and may spawn fix tasks + a follow-up review, up to maxIterations.
 */

import { randomUUID } from 'node:crypto';
import type { TeamStore } from '../team/team-store.js';
import { parseTaskGraph, topologicalSort, type TaskGraph } from './task-graph.js';
import { collectPlanningContext, contextToPromptSection } from './context-collector.js';

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

export interface SeedOptions {
  /** Collect project context before planning (default: true) */
  collectContext?: boolean;
  /** Use structured JSON output (default: true). Set false for P5 legacy mode. */
  structuredPlan?: boolean;
}

/**
 * Create the initial planning task.  The agent that executes it will
 * return a structured JSON TaskGraph (or call team_task in legacy mode).
 */
export function seedAutonomousPipeline(
  teamStore: TeamStore,
  projectId: string,
  config: PlannerConfig,
  opts?: SeedOptions & { projectDir?: string; agents?: string[] },
): { planningTaskId: string; pipelineId: string } {
  const maxIterations = config.maxIterations ?? 3;
  const taskBudget = config.taskBudget ?? 15;
  const structuredPlan = opts?.structuredPlan ?? true;

  const pipelineId = randomUUID();

  const meta: PlannerMeta = {
    plannerType: 'plan',
    pipelineId,
    goal: config.goal,
    iteration: 0,
    maxIterations,
    taskBudget,
  };

  // Collect project context (best-effort)
  let contextSection = '';
  if (opts?.collectContext !== false && opts?.projectDir) {
    try {
      const ctx = collectPlanningContext({
        projectDir: opts.projectDir,
        agents: opts.agents ?? [],
      });
      contextSection = contextToPromptSection(ctx);
    } catch { /* best-effort */ }
  }

  const prompt = structuredPlan
    ? buildStructuredPlanningPrompt(config.goal, maxIterations, taskBudget, pipelineId, contextSection)
    : buildLegacyPlanningPrompt(config.goal, maxIterations, taskBudget, pipelineId, contextSection);

  const task = teamStore.createTask({
    projectId,
    description: prompt,
    metadata: meta as unknown as Record<string, unknown>,
  });

  return { planningTaskId: task.task_id, pipelineId };
}

// ── Materialize (Phase 6c core: structured output → real tasks) ────

export interface MaterializeResult {
  success: boolean;
  taskIds: string[];
  graph?: TaskGraph;
  error?: string;
  warnings: string[];
}

/**
 * Parse planner agent's raw output into a TaskGraph, validate it,
 * and create real tasks in TeamStore with system-injected pipelineId.
 *
 * This eliminates D1 debt: pipelineId is set by the system, not by
 * the agent's prompt compliance.
 */
export function materializeTaskGraph(
  teamStore: TeamStore,
  projectId: string,
  pipelineId: string,
  plannerOutput: string,
  meta: { maxIterations: number; taskBudget: number; goal: string },
): MaterializeResult {
  const parsed = parseTaskGraph(plannerOutput);
  if (!parsed.success) {
    return { success: false, taskIds: [], error: parsed.error, warnings: [] };
  }

  const { data: graph, warnings } = parsed;

  // Topological sort for correct creation order
  let sorted;
  try {
    sorted = topologicalSort(graph.tasks);
  } catch (e) {
    return { success: false, taskIds: [], error: (e as Error).message, warnings };
  }

  // Map tempId → real taskId
  const idMap = new Map<string, string>();
  const taskIds: string[] = [];

  for (const node of sorted) {
    // Resolve deps to real IDs
    const realDeps = node.deps.map(d => idMap.get(d)).filter(Boolean) as string[];

    // System-inject pipelineId into metadata (D1 fix)
    const taskMeta: Record<string, unknown> = { pipelineId, role: node.role };
    if (node.role === 'reviewer') {
      taskMeta.plannerType = 'review';
      taskMeta.goal = meta.goal;
      taskMeta.iteration = 1;
      taskMeta.maxIterations = meta.maxIterations;
      taskMeta.taskBudget = meta.taskBudget;
    }

    const created = teamStore.createTask({
      projectId,
      description: node.description,
      deps: realDeps,
      metadata: taskMeta,
    });

    idMap.set(node.tempId, created.task_id);
    taskIds.push(created.task_id);
  }

  return { success: true, taskIds, graph, warnings };
}

// ── Prompts ────────────────────────────────────────────────────────

/**
 * Phase 6c: Structured JSON planning prompt.
 * Agent returns a JSON TaskGraph — no MCP tool calls needed.
 */
function buildStructuredPlanningPrompt(
  goal: string,
  maxIterations: number,
  taskBudget: number,
  pipelineId: string,
  contextSection: string,
): string {
  return `[Role: Project Planner — Autonomous Task Decomposition]

You are the technical lead and project planner for a team of AI agents.
Analyze the goal below and output a **structured JSON task plan**.

## Goal
${goal}
${contextSection ? `\n${contextSection}\n` : ''}
## Output Format

Return a single JSON object (inside a \`\`\`json code fence) matching this schema:

\`\`\`json
{
  "summary": "One-paragraph summary of your plan",
  "tasks": [
    {
      "tempId": "t1",
      "role": "pm",
      "description": "[Role: PM] Self-contained task description with all context...",
      "deps": [],
      "files": ["optional/list/of/files.ts"]
    },
    {
      "tempId": "t2",
      "role": "engineer",
      "description": "[Role: Engineer] Build the component...",
      "deps": ["t1"]
    },
    {
      "tempId": "tN",
      "role": "reviewer",
      "description": "[Role: Reviewer — Quality Gate (iteration 1/${maxIterations})] Review all work...",
      "deps": ["t1", "t2", "...all other tempIds"]
    }
  ]
}
\`\`\`

## Schema Rules

- **role** must be one of: \`pm\`, \`engineer\`, \`qa\`, \`reviewer\`
- **description** must start with \`[Role: ...]\` and be **self-contained** (all context, file paths, acceptance criteria)
- **deps** is an array of tempIds of prerequisite tasks
- **The LAST task MUST be a reviewer** — it depends on ALL other tasks
- **files** (optional) lists files the task creates or modifies

## Suggested Structure

1. 1–2 research/planning tasks (PM writes spec)
2. 1–3 implementation tasks (Engineer builds)
3. 0–1 QA tasks (testing/validation)
4. 1 review task (MANDATORY, last, depends on ALL others)

## Review Task Description Template

The reviewer description MUST include:
- "Review all completed work for this goal: \"{goal}\""
- Instructions to check correctness, completeness, polish
- If quality OK → call memorix_handoff with approval summary, exit
- If issues → create fix tasks via team_task action="create" (no deps), then a follow-up review task
- If some pending tasks are unnecessary → create a cancellation note via memorix_handoff
- Can also create NEW general tasks (not just fixes) if gaps are found
- Task budget remaining: ~${taskBudget - 1}
- The reviewer will receive a full Pipeline Progress ledger in its prompt

## Rules
- Task budget: **${taskBudget}** max tasks. Create only what's needed.
- Maximum **${maxIterations}** review iterations.
- Prefer fewer, focused tasks over many trivial ones.
- Output ONLY the JSON. No other text before or after the code fence.

pipelineId (for your reference only, the system will inject this): ${pipelineId}`;
}

/**
 * Phase 5 legacy: agent calls team_task create directly.
 * Retained for --no-structured-plan fallback.
 */
function buildLegacyPlanningPrompt(
  goal: string,
  maxIterations: number,
  taskBudget: number,
  pipelineId: string,
  contextSection: string,
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
${contextSection ? `\n${contextSection}\n` : ''}
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
