/**
 * Memorix Bridge — Phase 7, Step 5: Orchestrator ↔ Memorix memory integration.
 *
 * Bridge between the coordinator and Memorix's internal observation APIs.
 * Calls storeObservation() / searchObservations() directly (same process,
 * no MCP overhead). Every call is best-effort with timeout.
 *
 * Three integration layers:
 *   5a. Fix Loop Memory — CORE (always on): store verified fixes, search known fixes
 *   5b. Lesson Injection — OPT-IN: search gotcha/problem-solution before dispatch
 *   5c. Lifecycle Memory — OPT-IN: store task completion / pipeline summary events
 *
 * Design principles:
 *   - All writes: fire-and-forget (no await on hot path)
 *   - All reads: 3s timeout → empty fallback
 *   - Project isolation: only same-project memories
 *   - Safeguard 1: Only store VERIFIED fixes (gate must confirm)
 *   - Safeguard 2: Confidence scoring based on fix attempt number
 *   - Safeguard 6: Pattern sanitization (strip absolute paths, line numbers)
 *   - Safeguard 7: Advisory injection (agent is told to verify, not blindly follow)
 */

import { createHash } from 'node:crypto';

// ── Types ──────────────────────────────────────────────────────────

export interface FixResult {
  projectId: string;
  /** The gate that failed (compile or test) */
  gate: 'compile' | 'test';
  /** Raw error output from the gate */
  errorOutput: string;
  /** What the agent did to fix it (tail output from fix attempt) */
  fixDescription: string;
  /** Which fix attempt succeeded (1 = first try, 2+ = multiple tries) */
  fixAttempt: number;
  /** Max fix attempts configured */
  maxAttempts: number;
  /** Whether the fix ultimately passed the gate */
  passed: boolean;
}

export interface LessonEntry {
  id: number;
  title: string;
  narrative: string;
  type: string;
  score?: number;
}

export interface BridgeConfig {
  /** Enable lesson injection before dispatch (default: true) */
  enableLessons: boolean;
  /** Enable lifecycle event memory storage (default: false) */
  enableMemoryCapture: boolean;
  /** Max lessons to inject per prompt (default: 3) */
  maxLessons: number;
  /** Max total tokens for injected lessons (default: 500) */
  maxLessonTokens: number;
  /** Search timeout in ms (default: 3000) */
  searchTimeoutMs: number;
}

export const DEFAULT_BRIDGE_CONFIG: BridgeConfig = {
  enableLessons: true,
  enableMemoryCapture: false,
  maxLessons: 3,
  maxLessonTokens: 500,
  searchTimeoutMs: 3_000,
};

// ── Lazy imports (avoid circular deps) ─────────────────────────────

let _storeObservation: typeof import('../memory/observations.js').storeObservation | null = null;
let _searchObservations: typeof import('../store/orama-store.js').searchObservations | null = null;

async function getStoreObservation() {
  if (!_storeObservation) {
    const mod = await import('../memory/observations.js');
    _storeObservation = mod.storeObservation;
  }
  return _storeObservation;
}

async function getSearchObservations() {
  if (!_searchObservations) {
    const mod = await import('../store/orama-store.js');
    _searchObservations = mod.searchObservations;
  }
  return _searchObservations;
}

// ── 5a. Fix Loop Memory (CORE — always on) ────────────────────────

/**
 * Store a verified fix as a `problem-solution` observation.
 * Called ONLY when the gate passes after a fix attempt (Safeguard 1).
 *
 * Fire-and-forget — never blocks the pipeline. Never throws.
 */
export function storeVerifiedFix(fix: FixResult): void {
  // Only store if the fix actually passed (Safeguard 1)
  if (!fix.passed) return;

  const errorHash = hashErrorPattern(fix.errorOutput);
  const confidence = fix.fixAttempt === 1 ? 'high' : fix.fixAttempt === 2 ? 'medium' : 'low';

  // Fire-and-forget — catches all errors silently
  void (async () => {
    try {
      const store = await getStoreObservation();
      await store({
        entityName: `fix-${fix.gate}`,
        type: 'problem-solution',
        title: `${fix.gate} fix: ${sanitizeErrorPattern(fix.errorOutput).slice(0, 100)}`,
        narrative: sanitizeErrorPattern(fix.fixDescription).slice(0, 500),
        facts: [
          `gate: ${fix.gate}`,
          `confidence: ${confidence}`,
          `fixAttempt: ${fix.fixAttempt}/${fix.maxAttempts}`,
          `errorHash: ${errorHash}`,
        ],
        concepts: [`${fix.gate}-fix`, 'auto-fix', confidence],
        projectId: fix.projectId,
        topicKey: `fix/${fix.projectId}/${errorHash}`,
        source: 'agent',
        sourceDetail: 'hook',
        valueCategory: confidence === 'high' ? 'core' : 'contextual',
      });
    } catch { /* fire-and-forget */ }
  })();
}

/**
 * Store a gotcha when fix loop is exhausted (all attempts failed).
 *
 * Fire-and-forget — never blocks the pipeline. Never throws.
 */
export function storeFixExhausted(fix: FixResult): void {
  const errorHash = hashErrorPattern(fix.errorOutput);

  void (async () => {
    try {
      const store = await getStoreObservation();
      await store({
        entityName: `gotcha-${fix.gate}`,
        type: 'gotcha',
        title: `Unfixed ${fix.gate} error: ${sanitizeErrorPattern(fix.errorOutput).slice(0, 100)}`,
        narrative: `Fix loop exhausted after ${fix.maxAttempts} attempts. Last attempt output: ${sanitizeErrorPattern(fix.fixDescription).slice(0, 300)}`,
        facts: [
          `gate: ${fix.gate}`,
          `attempts: ${fix.maxAttempts}`,
          `errorHash: ${errorHash}`,
        ],
        concepts: [`${fix.gate}-error`, 'unfixed', 'gotcha'],
        projectId: fix.projectId,
        topicKey: `gotcha/${fix.projectId}/${errorHash}`,
        source: 'agent',
        sourceDetail: 'hook',
        valueCategory: 'contextual',
      });
    } catch { /* fire-and-forget */ }
  })();
}

/**
 * Search for known fixes matching an error pattern.
 * Returns matching lessons within timeout (Safeguard: 3s timeout → empty).
 *
 * Called when a gate fails, BEFORE building the fix prompt.
 */
export async function searchKnownFixes(
  errorOutput: string,
  projectId: string,
  timeoutMs: number = 3_000,
): Promise<LessonEntry[]> {
  try {
    const searchQuery = sanitizeErrorPattern(errorOutput).slice(0, 200);
    const search = await getSearchObservations();

    const results = await Promise.race([
      search({
        query: searchQuery,
        projectId,
        type: 'problem-solution',
        limit: 3,
        status: 'active',
      }),
      sleep(timeoutMs).then(() => []),
    ]);

    return (results as any[])
      .filter((r: any) => (r.score ?? 1) > 0.3) // Only reasonably relevant
      .map((r: any) => ({
        id: r.id ?? 0,
        title: r.title ?? '',
        narrative: r.narrative ?? r.summary ?? '',
        type: r.type ?? 'problem-solution',
        score: r.score,
      }));
  } catch {
    return []; // Search failure → empty lessons (Safeguard: graceful degradation)
  }
}

// ── 5b. Lesson Injection (OPT-IN) ─────────────────────────────────

/**
 * Search for relevant lessons (gotcha + problem-solution) matching a task description.
 * Returns formatted lesson text ready to inject into the agent prompt.
 *
 * Returns empty string if disabled, no lessons found, or timeout.
 */
export async function searchLessons(
  taskDescription: string,
  projectId: string,
  config: BridgeConfig = DEFAULT_BRIDGE_CONFIG,
): Promise<string> {
  if (!config.enableLessons) return '';

  try {
    const search = await getSearchObservations();
    const query = taskDescription.slice(0, 300); // Trim query for relevance

    const results = await Promise.race([
      search({
        query,
        projectId,
        limit: config.maxLessons + 2, // Fetch extra for filtering
        status: 'active',
      }),
      sleep(config.searchTimeoutMs).then(() => []),
    ]);

    const lessons = (results as any[])
      .filter((r: any) =>
        (r.type === 'problem-solution' || r.type === 'gotcha') &&
        (r.score ?? 1) > 0.5, // Only high-relevance (Safeguard 5: project isolation already handled by projectId filter)
      )
      .slice(0, config.maxLessons);

    if (lessons.length === 0) return '';

    // Format lessons with advisory caveat (Safeguard 7)
    const lines = [
      '## Lessons (from Memorix — advisory, verify before applying)',
      '',
    ];

    let tokenEstimate = 0;
    for (const lesson of lessons) {
      const title = lesson.title ?? 'Untitled';
      const narrative = lesson.narrative ?? lesson.summary ?? '';
      const entry = `- **${title}**: ${narrative.slice(0, 150)}`;

      // Rough token estimate: ~4 chars per token
      tokenEstimate += Math.ceil(entry.length / 4);
      if (tokenEstimate > config.maxLessonTokens) break; // Safeguard 4: token budget cap

      lines.push(entry);
    }

    lines.push('', '*These lessons are advisory. Verify their applicability before using.*');
    return lines.join('\n');
  } catch {
    return ''; // Search failure → no lessons (graceful degradation)
  }
}

// ── 5c. Lifecycle Memory (OPT-IN) ─────────────────────────────────

/**
 * Store a task completion event as a `what-changed` observation.
 * Fire-and-forget. Only called when enableMemoryCapture is true.
 */
export function storeTaskCompletion(opts: {
  projectId: string;
  pipelineId: string;
  taskId: string;
  taskDescription: string;
  agentName: string;
  durationMs: number;
  tailOutput: string;
}): void {
  void (async () => {
    try {
      const store = await getStoreObservation();
      await store({
        entityName: `task-${opts.taskId.slice(0, 8)}`,
        type: 'what-changed',
        title: `Task completed: ${opts.taskDescription.slice(0, 80)}`,
        narrative: `Agent ${opts.agentName} completed task in ${(opts.durationMs / 1000).toFixed(1)}s. Output: ${opts.tailOutput.slice(-200)}`,
        facts: [
          `agent: ${opts.agentName}`,
          `duration: ${(opts.durationMs / 1000).toFixed(1)}s`,
        ],
        concepts: ['task-completion', opts.agentName],
        projectId: opts.projectId,
        topicKey: `pipeline/${opts.pipelineId}/task/${opts.taskId}`,
        source: 'agent',
        sourceDetail: 'hook',
        valueCategory: 'ephemeral',
      });
    } catch { /* fire-and-forget */ }
  })();
}

/**
 * Store a pipeline completion summary as a `session-request` observation.
 * Fire-and-forget. Only called when enableMemoryCapture is true.
 */
export function storePipelineSummary(opts: {
  projectId: string;
  pipelineId: string;
  goal: string;
  totalTasks: number;
  completed: number;
  failed: number;
  elapsedMs: number;
}): void {
  void (async () => {
    try {
      const store = await getStoreObservation();
      await store({
        entityName: `pipeline-${opts.pipelineId.slice(0, 8)}`,
        type: 'session-request',
        title: `Pipeline: ${opts.goal.slice(0, 80)}`,
        narrative: `Completed ${opts.completed}/${opts.totalTasks} tasks (${opts.failed} failed) in ${(opts.elapsedMs / 1000).toFixed(0)}s.`,
        facts: [
          `goal: ${opts.goal.slice(0, 200)}`,
          `tasks: ${opts.completed}/${opts.totalTasks}`,
          `failed: ${opts.failed}`,
          `elapsed: ${(opts.elapsedMs / 1000).toFixed(0)}s`,
        ],
        concepts: ['pipeline-summary'],
        projectId: opts.projectId,
        topicKey: `pipeline/${opts.pipelineId}/summary`,
        source: 'agent',
        sourceDetail: 'hook',
        valueCategory: 'contextual',
      });
    } catch { /* fire-and-forget */ }
  })();
}

// ── Pattern Sanitization (Safeguard 6) ─────────────────────────────

/**
 * Sanitize error output before storage:
 * - Replace absolute paths with relative
 * - Strip line numbers (code changes between runs)
 * - Keep error codes and conceptual patterns
 */
export function sanitizeErrorPattern(text: string): string {
  return text
    // Windows absolute paths → relative
    .replace(/[A-Z]:\\(?:[\w.-]+\\)+/gi, './')
    // Unix absolute paths → relative
    .replace(/\/(?:home|Users|var|tmp|opt)\/[\w.-]+\//g, './')
    // Strip line:column numbers (e.g., :42:10, line 42)
    .replace(/:(\d+):(\d+)/g, ':_:_')
    .replace(/\bline\s+\d+/gi, 'line _')
    // Strip node_modules deep paths
    .replace(/node_modules\/[^\s]+/g, 'node_modules/...');
}

/**
 * Generate a stable hash from an error pattern for topicKey dedup.
 * Uses the sanitized first 500 chars of the error.
 */
export function hashErrorPattern(errorOutput: string): string {
  const sanitized = sanitizeErrorPattern(errorOutput).slice(0, 500);
  return createHash('sha256').update(sanitized).digest('hex').slice(0, 12);
}

// ── Helpers ────────────────────────────────────────────────────────

function sleep(ms: number): Promise<never[]> {
  return new Promise(resolve => setTimeout(() => resolve([]), ms));
}
