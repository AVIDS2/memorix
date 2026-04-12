/**
 * Task Graph — Phase 6b: Structured task plan schema + DAG utilities.
 *
 * Defines the Zod schema for planner output, validates structure and
 * semantics, and provides DAG operations (topological sort, cycle
 * detection, parallel group discovery).
 *
 * The planner returns a TaskGraph; the coordinator materializes it
 * into TeamStore tasks with system-injected pipelineId.
 */

import { z } from 'zod';

// ── Zod Schema ─────────────────────────────────────────────────────

export const TaskNodeSchema = z.object({
  tempId: z.string().min(1).describe('Temporary ID like "t1", "t2"'),
  role: z.enum(['pm', 'engineer', 'qa', 'reviewer']),
  description: z.string().min(30).describe('Self-contained task description with all context'),
  deps: z.array(z.string()).describe('tempIds of prerequisite tasks'),
  files: z.array(z.string()).optional().describe('Files this task will create or modify'),
});

export type TaskNode = z.infer<typeof TaskNodeSchema>;

export const TaskGraphSchema = z.object({
  summary: z.string().min(10).describe('One-paragraph plan summary'),
  tasks: z.array(TaskNodeSchema).min(2).max(30),
}).superRefine((data, ctx) => {
  const ids = new Set(data.tasks.map(t => t.tempId));

  // Validate: all dep references exist
  for (const task of data.tasks) {
    for (const dep of task.deps) {
      if (!ids.has(dep)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Task "${task.tempId}" references unknown dependency "${dep}"`,
          path: ['tasks'],
        });
      }
    }
    // Self-reference check
    if (task.deps.includes(task.tempId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Task "${task.tempId}" depends on itself`,
        path: ['tasks'],
      });
    }
  }

  // Validate: last task must be a reviewer
  if (data.tasks.length > 0 && data.tasks[data.tasks.length - 1].role !== 'reviewer') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Last task must have role "reviewer"',
      path: ['tasks'],
    });
  }

  // Validate: no cycles
  if (hasCycle(data.tasks)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Task graph contains a cycle',
      path: ['tasks'],
    });
  }

  // Validate: unique tempIds
  if (ids.size !== data.tasks.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Duplicate tempId values detected',
      path: ['tasks'],
    });
  }
});

export type TaskGraph = z.infer<typeof TaskGraphSchema>;

// ── Parsing ────────────────────────────────────────────────────────

/**
 * Parse and validate a JSON string into a TaskGraph.
 * Returns { success, data, error }.
 */
export function parseTaskGraph(raw: string): {
  success: true; data: TaskGraph; warnings: string[];
} | {
  success: false; error: string;
} {
  // Try to extract JSON from fenced code blocks or raw text
  const json = extractJson(raw);
  if (!json) {
    return { success: false, error: 'No valid JSON found in planner output' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    return { success: false, error: `JSON parse error: ${(e as Error).message}` };
  }

  const result = TaskGraphSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`);
    return { success: false, error: `Validation failed:\n${issues.join('\n')}` };
  }

  const warnings = validateSemantics(result.data);
  return { success: true, data: result.data, warnings };
}

// ── DAG Utilities ──────────────────────────────────────────────────

/**
 * Detect cycles in the task graph using DFS.
 */
export function hasCycle(tasks: Pick<TaskNode, 'tempId' | 'deps'>[]): boolean {
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  for (const t of tasks) color.set(t.tempId, WHITE);

  const adj = new Map<string, string[]>();
  for (const t of tasks) adj.set(t.tempId, t.deps);

  function dfs(node: string): boolean {
    color.set(node, GRAY);
    for (const dep of adj.get(node) ?? []) {
      const c = color.get(dep);
      if (c === GRAY) return true; // back edge → cycle
      if (c === WHITE && dfs(dep)) return true;
    }
    color.set(node, BLACK);
    return false;
  }

  for (const t of tasks) {
    if (color.get(t.tempId) === WHITE && dfs(t.tempId)) return true;
  }
  return false;
}

/**
 * Topological sort (Kahn's algorithm). Returns tasks in execution order.
 * Throws if graph has a cycle.
 */
export function topologicalSort(tasks: TaskNode[]): TaskNode[] {
  const inDegree = new Map<string, number>();
  const taskMap = new Map<string, TaskNode>();
  const adj = new Map<string, string[]>(); // dep → dependents

  for (const t of tasks) {
    taskMap.set(t.tempId, t);
    inDegree.set(t.tempId, t.deps.length);
    if (!adj.has(t.tempId)) adj.set(t.tempId, []);
    for (const dep of t.deps) {
      if (!adj.has(dep)) adj.set(dep, []);
      adj.get(dep)!.push(t.tempId);
    }
  }

  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  const sorted: TaskNode[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    sorted.push(taskMap.get(id)!);
    for (const dependent of adj.get(id) ?? []) {
      const newDeg = (inDegree.get(dependent) ?? 1) - 1;
      inDegree.set(dependent, newDeg);
      if (newDeg === 0) queue.push(dependent);
    }
  }

  if (sorted.length !== tasks.length) {
    throw new Error('Task graph contains a cycle — topological sort failed');
  }
  return sorted;
}

/**
 * Find groups of tasks that can execute in parallel.
 * Tasks in the same group have no mutual dependencies and all their
 * deps are satisfied at the same "level".
 */
export function findParallelGroups(tasks: TaskNode[]): string[][] {
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();

  for (const t of tasks) {
    inDegree.set(t.tempId, t.deps.length);
    if (!adj.has(t.tempId)) adj.set(t.tempId, []);
    for (const dep of t.deps) {
      if (!adj.has(dep)) adj.set(dep, []);
      adj.get(dep)!.push(t.tempId);
    }
  }

  const groups: string[][] = [];
  const remaining = new Set(tasks.map(t => t.tempId));

  while (remaining.size > 0) {
    const ready: string[] = [];
    for (const id of remaining) {
      if ((inDegree.get(id) ?? 0) === 0) ready.push(id);
    }
    if (ready.length === 0) break; // cycle guard
    groups.push(ready);
    for (const id of ready) {
      remaining.delete(id);
      for (const dep of adj.get(id) ?? []) {
        inDegree.set(dep, (inDegree.get(dep) ?? 1) - 1);
      }
    }
  }

  return groups;
}

/**
 * Length of the longest dependency chain.
 */
export function longestChain(tasks: Pick<TaskNode, 'tempId' | 'deps'>[]): number {
  const memo = new Map<string, number>();
  const taskMap = new Map(tasks.map(t => [t.tempId, t]));

  function depth(id: string): number {
    if (memo.has(id)) return memo.get(id)!;
    const t = taskMap.get(id);
    if (!t || t.deps.length === 0) { memo.set(id, 1); return 1; }
    const maxDep = Math.max(...t.deps.map(d => depth(d)));
    const d = maxDep + 1;
    memo.set(id, d);
    return d;
  }

  let max = 0;
  for (const t of tasks) max = Math.max(max, depth(t.tempId));
  return max;
}

// ── Semantic Validation (warnings, not errors) ─────────────────────

function validateSemantics(graph: TaskGraph): string[] {
  const warnings: string[] = [];

  // Check for duplicate descriptions
  const descs = graph.tasks.map(t => t.description.slice(0, 80));
  if (new Set(descs).size < descs.length) {
    warnings.push('Some tasks have very similar descriptions — consider making them more distinct');
  }

  // Check for overly linear graph (missed parallelism)
  const chain = longestChain(graph.tasks);
  if (chain > graph.tasks.length * 0.8 && graph.tasks.length > 3) {
    warnings.push(`Task graph is nearly linear (chain=${chain}/${graph.tasks.length}) — independent tasks could run in parallel`);
  }

  // Check for very short descriptions
  for (const t of graph.tasks) {
    if (t.description.length < 80) {
      warnings.push(`Task "${t.tempId}" has a short description (${t.description.length} chars) — agents may lack context`);
    }
  }

  return warnings;
}

// ── Helpers ─────────────────────────────────────────────────────────

/**
 * Extract JSON from raw LLM output — handles fenced code blocks,
 * bare JSON objects, and markdown-wrapped output.
 */
function extractJson(raw: string): string | null {
  // Try fenced code block first: ```json ... ``` or ``` ... ```
  const fenced = raw.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  if (fenced) {
    const candidate = fenced[1].trim();
    if (candidate.startsWith('{')) return candidate;
  }

  // Try bare JSON object
  const braceStart = raw.indexOf('{');
  const braceEnd = raw.lastIndexOf('}');
  if (braceStart !== -1 && braceEnd > braceStart) {
    return raw.slice(braceStart, braceEnd + 1);
  }

  return null;
}
