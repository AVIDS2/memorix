import {
  CONTEXT_EVALUATION_METRICS,
  CONTEXT_EVALUATION_TASKS,
  type ContextEvaluationMetric,
  type ContextEvaluationTask,
} from './context-task-matrix.js';

export type ContextEvaluationMetricValues = Record<ContextEvaluationMetric, number>;

export interface ContextEvaluationProbeResult {
  passed: boolean;
  checks: string[];
  metrics: Partial<ContextEvaluationMetricValues>;
  evidence?: string[];
  outputTokens?: number;
  reviewCost?: number;
}

export interface ContextEvaluationCaseResult {
  id: string;
  title: string;
  category: ContextEvaluationTask['category'];
  passed: boolean;
  checks: string[];
  evidence: string[];
  metrics: ContextEvaluationMetricValues;
  elapsedMs: number;
  error?: string;
}

export interface ContextEvaluationReport {
  version: '1';
  generatedAt: string;
  runtime: {
    node: string;
    platform: string;
    embeddings: 'disabled' | 'enabled' | 'unknown';
  };
  cases: ContextEvaluationCaseResult[];
  summary: {
    cases: number;
    passed: number;
    failed: number;
    passRate: number;
    metricAverages: ContextEvaluationMetricValues;
    latencyP50Ms: number;
    latencyP95Ms: number;
    peakRssBytes: number;
  };
}

export type ContextEvaluationProbe = (
  task: ContextEvaluationTask,
) => Promise<ContextEvaluationProbeResult>;

function percentile(values: number[], percentileValue: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((percentileValue / 100) * sorted.length) - 1),
  );
  return sorted[index];
}

function metricDefaults(task: ContextEvaluationTask, inputTokens: number, outputTokens: number, rssBytes: number): ContextEvaluationMetricValues {
  const metrics = {} as ContextEvaluationMetricValues;
  for (const metric of CONTEXT_EVALUATION_METRICS) metrics[metric] = 0;
  metrics['input-tokens'] = inputTokens;
  metrics['output-tokens'] = outputTokens;
  metrics['rss-bytes'] = rssBytes;
  // Keep the task in the report even when a probe fails before measuring a
  // quality dimension. A zero is an explicit failed observation, not a claim
  // that the dimension was irrelevant.
  void task;
  return metrics;
}

function validateMetrics(metrics: ContextEvaluationMetricValues): string[] {
  return CONTEXT_EVALUATION_METRICS
    .filter(metric => !Number.isFinite(metrics[metric]) || metrics[metric] < 0)
    .map(metric => `invalid metric: ${metric}`);
}

/**
 * Run the stable 1.10 matrix against real probes supplied by the caller.
 * The runner owns timing, failure normalization, and aggregate statistics so
 * individual probes cannot silently omit an acceptance dimension.
 */
export async function runContextEvaluation(
  probe: ContextEvaluationProbe,
  tasks: readonly ContextEvaluationTask[] = CONTEXT_EVALUATION_TASKS,
): Promise<ContextEvaluationReport> {
  const cases: ContextEvaluationCaseResult[] = [];
  for (const task of tasks) {
    const startedAt = Date.now();
    const rssBefore = process.memoryUsage().rss;
    let result: ContextEvaluationProbeResult;
    let error: string | undefined;
    try {
      result = await probe(task);
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
      result = { passed: false, checks: ['probe threw an exception'], metrics: {} };
    }

    const elapsedMs = Math.max(0, Date.now() - startedAt);
    const rssBytes = Math.max(rssBefore, process.memoryUsage().rss);
    const inputTokens = task.task.trim().split(/\s+/u).filter(Boolean).length;
    const metrics = metricDefaults(task, inputTokens, result.outputTokens ?? 0, rssBytes);
    for (const metric of CONTEXT_EVALUATION_METRICS) {
      const observed = result.metrics[metric];
      if (observed !== undefined) metrics[metric] = observed;
    }
    metrics['latency-p50'] = result.metrics['latency-p50'] ?? elapsedMs;
    metrics['latency-p95'] = result.metrics['latency-p95'] ?? elapsedMs;
    metrics['rss-bytes'] = result.metrics['rss-bytes'] ?? rssBytes;
    if (result.reviewCost !== undefined) metrics['review-cost'] = result.reviewCost;

    const checks = [...result.checks];
    checks.push(...validateMetrics(metrics));
    const passed = result.passed && checks.every(check => !check.startsWith('invalid metric:')) && !error;
    cases.push({
      id: task.id,
      title: task.title,
      category: task.category,
      passed,
      checks,
      evidence: result.evidence ?? [],
      metrics,
      elapsedMs,
      ...(error ? { error } : {}),
    });
  }

  const metricAverages = {} as ContextEvaluationMetricValues;
  for (const metric of CONTEXT_EVALUATION_METRICS) {
    const total = cases.reduce((sum, item) => sum + item.metrics[metric], 0);
    metricAverages[metric] = cases.length > 0 ? total / cases.length : 0;
  }
  const latencies = cases.map(item => item.metrics['latency-p95']);
  return {
    version: '1',
    generatedAt: new Date().toISOString(),
    runtime: {
      node: process.version,
      platform: `${process.platform}-${process.arch}`,
      embeddings: process.env.MEMORIX_EMBEDDING === 'off' ? 'disabled' : 'unknown',
    },
    cases,
    summary: {
      cases: cases.length,
      passed: cases.filter(item => item.passed).length,
      failed: cases.filter(item => !item.passed).length,
      passRate: cases.length === 0 ? 1 : cases.filter(item => item.passed).length / cases.length,
      metricAverages,
      latencyP50Ms: percentile(latencies, 50),
      latencyP95Ms: percentile(latencies, 95),
      peakRssBytes: Math.max(0, ...cases.map(item => item.metrics['rss-bytes'])),
    },
  };
}

export function formatContextEvaluationReport(report: ContextEvaluationReport): string {
  const lines = [
    `1.10 context evaluation — ${report.summary.passed}/${report.summary.cases} cases passed`,
    `runtime: ${report.runtime.node} ${report.runtime.platform}; embeddings=${report.runtime.embeddings}`,
    `latency: p50=${report.summary.latencyP50Ms}ms p95=${report.summary.latencyP95Ms}ms; peak RSS=${report.summary.peakRssBytes} bytes`,
  ];
  for (const item of report.cases) {
    lines.push(`${item.passed ? 'PASS' : 'FAIL'} ${item.id} (${item.elapsedMs}ms)`);
    if (!item.passed) lines.push(`  checks: ${item.checks.join('; ') || item.error || 'no passing checks'}`);
  }
  return lines.join('\n');
}
