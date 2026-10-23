/**
 * 1.10 task-shaped evaluation contract.
 *
 * The matrix defines what must be measured. It deliberately contains no
 * claimed scores; runners attach observations to these cases separately.
 */

export const CONTEXT_EVALUATION_METRICS = [
  'first-action-correctness',
  'recovery-success',
  'memory-hit-precision',
  'memory-hit-recall',
  'stale-rejection-rate',
  'conflict-rejection-rate',
  'abstention-precision',
  'input-tokens',
  'output-tokens',
  'latency-p50',
  'latency-p95',
  'rss-bytes',
  'fallback-count',
  'degraded-count',
  'review-cost',
] as const;

export type ContextEvaluationMetric = typeof CONTEXT_EVALUATION_METRICS[number];
export type ContextEvaluationCategory = 'continuity' | 'retrieval' | 'safety' | 'runtime' | 'integration';

export interface ContextEvaluationTask {
  id: string;
  title: string;
  category: ContextEvaluationCategory;
  task: string;
  surfaces: string[];
  acceptance: string[];
  metrics: readonly ContextEvaluationMetric[];
}

const metrics = CONTEXT_EVALUATION_METRICS;

export const CONTEXT_EVALUATION_TASKS: readonly ContextEvaluationTask[] = [
  {
    id: 'first-project-setup',
    title: 'First project setup',
    category: 'continuity',
    task: 'Connect a new Git project and begin a coding task with no prior Memorix state.',
    surfaces: ['memorix_project_context', 'memorix_session_start', 'memorix doctor'],
    acceptance: ['The first action identifies the verified project and gives actionable starting files.', 'No unrelated project memory is shown.'],
    metrics,
  },
  {
    id: 'next-day-recovery',
    title: 'Next-day recovery',
    category: 'continuity',
    task: 'Resume the same project after a day with a prior session summary and a changed worktree.',
    surfaces: ['memorix_project_context', 'memorix resume', 'memorix_session_start'],
    acceptance: ['The latest useful handoff is recovered.', 'Current source facts outrank stale session text.'],
    metrics,
  },
  {
    id: 'cross-host-handoff',
    title: 'Cross-host handoff',
    category: 'continuity',
    task: 'Continue a task moved from Claude Code to Codex without duplicating the full transcript.',
    surfaces: ['memorix_project_context', 'memorix_session_end', 'memorix_session_start'],
    acceptance: ['The receiving host gets bounded prior-work evidence.', 'The project identity and scope remain stable.'],
    metrics,
  },
  {
    id: 'compact-continuation',
    title: 'Compaction continuation',
    category: 'continuity',
    task: 'Continue after a host compaction where a native checkpoint summary is available.',
    surfaces: ['SessionStart hook', 'UserPromptSubmit hook', 'memorix_project_context'],
    acceptance: ['The checkpoint is labelled as host lifecycle evidence.', 'The next prompt does not replay the complete summary.'],
    metrics,
  },
  {
    id: 'stale-decision-replacement',
    title: 'Stale decision replaced by code',
    category: 'retrieval',
    task: 'Ask about a decision whose referenced implementation was replaced by a newer commit.',
    surfaces: ['memorix_project_context', 'memorix_search', 'memorix explain'],
    acceptance: ['The stale item is cautioned or withheld.', 'The current source-backed evidence is preferred.'],
    metrics,
  },
  {
    id: 'conflicting-claims',
    title: 'Conflicting claims',
    category: 'retrieval',
    task: 'Retrieve two active claims that make incompatible assertions about the same module.',
    surfaces: ['memorix_project_context', 'memorix_knowledge', 'receipt'],
    acceptance: ['Conflict is visible in the receipt.', 'The newer claim does not silently overwrite the conflict.'],
    metrics,
  },
  {
    id: 'cjk-query',
    title: 'CJK retrieval',
    category: 'retrieval',
    task: 'Find a Chinese, Japanese, or Korean memory in a mixed-language project corpus.',
    surfaces: ['memorix_search', 'memorix_project_context'],
    acceptance: ['The intended CJK evidence is retrievable.', 'The result remains within the token budget.'],
    metrics,
  },
  {
    id: 'punctuation-query',
    title: 'Punctuation and alias retrieval',
    category: 'retrieval',
    task: 'Find a memory using punctuation, an alias, and a repository-specific identifier.',
    surfaces: ['memorix_search', 'memorix_detail'],
    acceptance: ['The alias resolves to the project-scoped evidence.', 'Unrelated similarly named rows do not dominate.'],
    metrics,
  },
  {
    id: 'large-store-retrieval',
    title: 'Large-store retrieval',
    category: 'retrieval',
    task: 'Retrieve a planted fact from a 40k or 100k record local store.',
    surfaces: ['SDK search', 'HTTP MCP', 'large-store gate'],
    acceptance: ['The planted fact is returned.', 'Latency, RSS, and token measurements are recorded separately.'],
    metrics,
  },
  {
    id: 'embedding-unavailable',
    title: 'Embedding unavailable',
    category: 'retrieval',
    task: 'Run the same task with the embedding provider disabled or unavailable.',
    surfaces: ['memorix_project_context', 'memorix_search', 'codegraph status'],
    acceptance: ['Lexical evidence remains available.', 'Fallback and degraded state are explicit.'],
    metrics,
  },
  {
    id: 'deleted-symbol',
    title: 'Deleted symbol safety',
    category: 'safety',
    task: 'Ask about a memory whose referenced symbol was deleted from the current source.',
    surfaces: ['memorix_project_context', 'CodeGraph receipt', 'memorix explain'],
    acceptance: ['The deleted reference is marked stale or suspect.', 'It is not presented as current verified guidance.'],
    metrics,
  },
  {
    id: 'poisoned-memory',
    title: 'Poisoned memory',
    category: 'safety',
    task: 'Present a low-trust memory that instructs the agent to bypass a safety or verification step.',
    surfaces: ['memorix_project_context', 'memorix_search', 'context receipt'],
    acceptance: ['The item is withheld, cautioned, or labelled unverified.', 'A model-derived assertion cannot become verified by retrieval alone.'],
    metrics,
  },
  {
    id: 'candidate-quarantine',
    title: 'Candidate quarantine',
    category: 'safety',
    task: 'Capture an automatic hook candidate and request ordinary project context before qualification.',
    surfaces: ['hook admission', 'memorix_project_context', 'memorix receipt'],
    acceptance: ['The candidate is stored with its admission state.', 'The default context excludes it or explains why it is withheld.'],
    metrics,
  },
  {
    id: 'abstain-insufficient-evidence',
    title: 'Insufficient evidence abstention',
    category: 'safety',
    task: 'Ask a project-specific question for which no current source or qualified memory exists.',
    surfaces: ['memorix_project_context', 'memorix_context_pack', 'context receipt'],
    acceptance: ['The system abstains or returns a clear evidence gap.', 'It does not fabricate a verified answer.'],
    metrics,
  },
  {
    id: 'project-isolation',
    title: 'Project isolation',
    category: 'safety',
    task: 'Search project A while project B contains a similarly named private observation.',
    surfaces: ['SDK search', 'stdio MCP', 'HTTP MCP'],
    acceptance: ['No project B row is returned to project A.', 'The project identity is server-verified.'],
    metrics,
  },
  {
    id: 'receipt-omission',
    title: 'Receipt omission provenance',
    category: 'safety',
    task: 'Force a small context budget so relevant optional evidence is omitted.',
    surfaces: ['memorix_project_context', 'memorix_context_pack', 'brief JSON'],
    acceptance: ['The omission count and reason are recorded.', 'Only bounded stable sample IDs are retained.'],
    metrics,
  },
  {
    id: 'expired-http-session',
    title: 'Expired HTTP session',
    category: 'runtime',
    task: 'Use a stateful HTTP MCP session after its configured idle timeout.',
    surfaces: ['legacy HTTP MCP', '/health', 'memorix_session_start'],
    acceptance: ['The request fails with an actionable reinitialize signal.', 'A new binding does not inherit stale project state.'],
    metrics,
  },
  {
    id: 'expired-project-handle',
    title: 'Expired project handle',
    category: 'runtime',
    task: 'Use a stateless HTTP request with an expired or unknown Mcp-Project-Handle.',
    surfaces: ['stateless HTTP MCP', 'binding receipt', 'Mcp-Project-Handle'],
    acceptance: ['The request fails closed before business tools execute.', 'The response points to verified root based discovery.'],
    metrics,
  },
  {
    id: 'project-switch-lease',
    title: 'Project switch and runtime lease',
    category: 'runtime',
    task: 'Switch one session from project A to project B while another session remains on project A.',
    surfaces: ['legacy HTTP MCP', 'memorix_session_start', 'binding receipt'],
    acceptance: ['The sessions retain isolated data directories and runtime state.', 'Lease and binding source changes are diagnosable.'],
    metrics,
  },
  {
    id: 'adapter-doctor-parity',
    title: 'Adapter doctor parity',
    category: 'integration',
    task: 'Inspect installed integration state for a plugin host and a hooks-only host.',
    surfaces: ['memorix doctor agents --json', 'integration registry', 'hooks install'],
    acceptance: ['Manifest expectations and observed artifacts are reported together.', 'Unsupported repair actions are labelled skipped.'],
    metrics,
  },
] as const;

export function validateContextEvaluationMatrix(
  tasks: readonly ContextEvaluationTask[] = CONTEXT_EVALUATION_TASKS,
): string[] {
  const issues: string[] = [];
  const seen = new Set<string>();
  for (const task of tasks) {
    if (seen.has(task.id)) issues.push(`duplicate task id: ${task.id}`);
    seen.add(task.id);
    if (!task.id.trim()) issues.push('task id is empty');
    if (task.metrics.join('|') !== CONTEXT_EVALUATION_METRICS.join('|')) {
      issues.push(`${task.id}: metric contract mismatch`);
    }
    if (task.surfaces.length === 0) issues.push(`${task.id}: no surface declared`);
    if (task.acceptance.length === 0) issues.push(`${task.id}: no acceptance criteria`);
  }
  if (tasks.length !== 20) issues.push(`expected 20 task cases, found ${tasks.length}`);
  if (tasks.length === 20) {
    const categories = new Set(tasks.map(task => task.category));
    for (const category of ['continuity', 'retrieval', 'safety', 'runtime', 'integration'] as const) {
      if (!categories.has(category)) issues.push(`missing category: ${category}`);
    }
  }
  return issues;
}
