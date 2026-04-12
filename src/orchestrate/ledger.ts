/**
 * Shared Ledger — Phase 6d: Pipeline progress tracking.
 *
 * Maintains a structured record of completed/failed tasks within a pipeline.
 * Serialized into prompts so every worker has global context.
 * Built-in truncation prevents token bloat (pays D8 debt from day 1).
 */

// ── Types ──────────────────────────────────────────────────────────

export interface LedgerEntry {
  taskId: string;
  tempId?: string;
  role: string;
  agent: string;
  status: 'completed' | 'failed';
  summary: string;
  outputFiles: string[];
  durationMs: number;
  timestamp: number;
}

export interface PipelineLedger {
  pipelineId: string;
  goal: string;
  planSummary: string;
  totalTasks: number;
  entries: LedgerEntry[];
}

// ── CRUD ───────────────────────────────────────────────────────────

export function createLedger(
  pipelineId: string,
  goal: string,
  planSummary: string,
  totalTasks: number,
): PipelineLedger {
  return { pipelineId, goal, planSummary, totalTasks, entries: [] };
}

export function appendEntry(ledger: PipelineLedger, entry: LedgerEntry): void {
  // Clamp summary to 200 chars
  if (entry.summary.length > 200) {
    entry.summary = entry.summary.slice(0, 197) + '...';
  }
  ledger.entries.push(entry);
}

// ── Serialization ──────────────────────────────────────────────────

/**
 * Serialize ledger into a prompt section.
 * Truncates to stay within token budget (rough estimate: 1 token ≈ 4 chars).
 */
export function ledgerToPromptSection(
  ledger: PipelineLedger,
  opts?: { maxChars?: number; taskIndex?: number },
): string {
  const maxChars = opts?.maxChars ?? 3200; // ~800 tokens
  const taskIndex = opts?.taskIndex;

  const header = [
    `## Pipeline Progress`,
    `Goal: ${ledger.goal}`,
    `Plan: ${ledger.planSummary}`,
    '',
  ].join('\n');

  const completedCount = ledger.entries.filter(e => e.status === 'completed').length;
  const failedCount = ledger.entries.filter(e => e.status === 'failed').length;
  const remaining = ledger.totalTasks - completedCount - failedCount;

  const stats = `Status: ${completedCount} completed, ${failedCount} failed, ${remaining} remaining\n`;

  let entries = ledger.entries;
  let entryLines = entries.map(formatEntry);

  // Truncation: keep first (plan context) + last N entries
  const overhead = header.length + stats.length + 100;
  while (totalChars(entryLines) + overhead > maxChars && entryLines.length > 2) {
    // Remove second entry (keep first + tail)
    entryLines.splice(1, 1);
  }

  // Add truncation notice if we removed entries
  if (entryLines.length < entries.length) {
    entryLines.splice(1, 0, `  ... (${entries.length - entryLines.length} entries omitted)`);
  }

  const position = taskIndex !== undefined
    ? `\nYou are task ${taskIndex + 1}/${ledger.totalTasks}. Focus on your role and build on prior work.`
    : '';

  return header + stats + '\n' + entryLines.join('\n') + position;
}

// ── Internals ──────────────────────────────────────────────────────

function formatEntry(entry: LedgerEntry): string {
  const icon = entry.status === 'completed' ? '✅' : '❌';
  const files = entry.outputFiles.length > 0
    ? ` → ${entry.outputFiles.join(', ')}`
    : '';
  return `- ${icon} [${entry.role}] (${entry.agent}): ${entry.summary}${files}`;
}

function totalChars(lines: string[]): number {
  return lines.reduce((sum, l) => sum + l.length + 1, 0);
}
