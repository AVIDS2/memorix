/**
 * Evidence Directory — Phase 7, Step 9: Per-task evidence collection.
 *
 * Creates a structured evidence directory for each pipeline run:
 *   .pipeline/<pipelineId>/evidence/<taskId>/
 *     prompt.md, output.txt, compile.txt, test.txt, result.json
 *
 * Design principle: evidence collection is best-effort. Disk write failures
 * are logged and ignored — never crash the pipeline for evidence.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GateResult } from './verify-gate.js';
import type { TokenUsage } from './adapters/types.js';

// ── Types ──────────────────────────────────────────────────────────

export interface TaskEvidence {
  taskId: string;
  taskDescription: string;
  agentName: string;
  status: 'completed' | 'failed';
  durationMs: number;
  prompt?: string;
  tailOutput?: string;
  gateResults?: GateResult[];
  tokenUsage?: Record<string, TokenUsage>;
  costUSD?: number | null;
  fixAttempts?: number;
}

export interface PipelineSummary {
  pipelineId: string;
  goal: string;
  totalTasks: number;
  completed: number;
  failed: number;
  elapsedMs: number;
  tokenUsage?: Record<string, TokenUsage>;
  costUSD?: number | null;
  tasks: TaskEvidence[];
}

// ── Core ───────────────────────────────────────────────────────────

/**
 * Write evidence for a single task. Best-effort — never throws.
 */
export function writeTaskEvidence(
  projectDir: string,
  pipelineId: string,
  evidence: TaskEvidence,
): string | null {
  try {
    const dir = join(projectDir, '.pipeline', pipelineId, 'evidence', evidence.taskId.slice(0, 12));
    mkdirSync(dir, { recursive: true });

    if (evidence.prompt) {
      safeWrite(join(dir, 'prompt.md'), evidence.prompt);
    }
    if (evidence.tailOutput) {
      safeWrite(join(dir, 'output.txt'), evidence.tailOutput);
    }
    if (evidence.gateResults) {
      for (const g of evidence.gateResults) {
        const content = `Command: ${g.command}\nStatus: ${g.passed ? 'PASS' : 'FAIL'}\nDuration: ${(g.durationMs / 1000).toFixed(1)}s\n\n${g.output}`;
        safeWrite(join(dir, `${g.gate}.txt`), content);
      }
    }

    const resultJson = {
      taskId: evidence.taskId,
      description: evidence.taskDescription,
      agent: evidence.agentName,
      status: evidence.status,
      durationMs: evidence.durationMs,
      fixAttempts: evidence.fixAttempts ?? 0,
      gates: evidence.gateResults?.map(g => ({ gate: g.gate, passed: g.passed, durationMs: g.durationMs, command: g.command })),
      tokenUsage: evidence.tokenUsage,
      costUSD: evidence.costUSD,
    };
    safeWrite(join(dir, 'result.json'), JSON.stringify(resultJson, null, 2));
    return dir;
  } catch {
    return null;
  }
}

/**
 * Write pipeline summary markdown. Best-effort — never throws.
 */
export function writePipelineSummary(
  projectDir: string,
  summary: PipelineSummary,
): string | null {
  try {
    const dir = join(projectDir, '.pipeline', summary.pipelineId);
    mkdirSync(dir, { recursive: true });

    const elapsed = (summary.elapsedMs / 1000).toFixed(0);
    const lines = [
      `# Pipeline: ${summary.goal.slice(0, 100)}`,
      '',
      `- **ID**: ${summary.pipelineId}`,
      `- **Tasks**: ${summary.completed}/${summary.totalTasks} completed, ${summary.failed} failed`,
      `- **Elapsed**: ${elapsed}s`,
    ];

    if (summary.costUSD != null) {
      lines.push(`- **Cost**: $${summary.costUSD.toFixed(4)}`);
    }

    lines.push('', '## Tasks', '');
    for (const t of summary.tasks) {
      const status = t.status === 'completed' ? 'PASS' : 'FAIL';
      const dur = (t.durationMs / 1000).toFixed(1);
      const fixes = t.fixAttempts ? ` (${t.fixAttempts} fix attempts)` : '';
      lines.push(`- [${status}] ${t.taskDescription.slice(0, 80)} — ${t.agentName}, ${dur}s${fixes}`);
    }

    const content = lines.join('\n') + '\n';
    safeWrite(join(dir, 'summary.md'), content);
    return join(dir, 'summary.md');
  } catch {
    return null;
  }
}

// ── Helpers ────────────────────────────────────────────────────────

function safeWrite(path: string, content: string): void {
  try {
    writeFileSync(path, content, 'utf-8');
  } catch { /* best-effort */ }
}
