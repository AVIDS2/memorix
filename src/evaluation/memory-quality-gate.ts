/** Deterministic, model-free quality gate for cross-session memory delivery. */

export interface MemoryQualitySample {
  id: string;
  expectedIds: string[];
  shownIds: string[];
  leakedProjectRows?: number;
  staleRowsShown?: number;
  shouldAbstain?: boolean;
  tokens: number;
  tokenBudget: number;
  latencyMs: number;
  rssBytes?: number;
}

export interface MemoryQualityGateScore {
  cases: number;
  recallAtK: number;
  precisionAtK: number;
  scopeIsolation: number;
  staleRejection: number;
  abstentionAccuracy: number;
  overBudgetCases: number;
  latencyP50Ms: number;
  latencyP95Ms: number;
  peakRssBytes: number;
  passed: boolean;
  failures: string[];
}

function rate(numerator: number, denominator: number): number {
  return denominator === 0 ? 1 : numerator / denominator;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}

export function scoreMemoryQualityGate(samples: MemoryQualitySample[]): MemoryQualityGateScore {
  let recalls = 0;
  let precisionNumerator = 0;
  let precisionDenominator = 0;
  let isolated = 0;
  let staleRejected = 0;
  let abstentionCorrect = 0;
  let overBudgetCases = 0;
  const latencies = samples.map(sample => sample.latencyMs);
  const failures: string[] = [];

  for (const sample of samples) {
    const expected = new Set(sample.expectedIds);
    const shown = new Set(sample.shownIds);
    if ([...expected].every(id => shown.has(id))) recalls++;
    precisionNumerator += [...shown].filter(id => expected.has(id)).length;
    precisionDenominator += shown.size;
    if (!sample.leakedProjectRows) isolated++;
    if (!sample.staleRowsShown) staleRejected++;
    const abstained = shown.size === 0;
    if (Boolean(sample.shouldAbstain) === abstained) abstentionCorrect++;
    if (sample.tokens > sample.tokenBudget) overBudgetCases++;
    if (sample.shouldAbstain && !abstained) failures.push(`${sample.id}: failed to abstain`);
    if (!sample.shouldAbstain && ![...expected].every(id => shown.has(id))) failures.push(`${sample.id}: expected memory missing`);
    if (sample.leakedProjectRows) failures.push(`${sample.id}: cross-project leakage`);
    if (sample.staleRowsShown) failures.push(`${sample.id}: stale memory surfaced`);
  }

  const score: MemoryQualityGateScore = {
    cases: samples.length,
    recallAtK: rate(recalls, samples.length),
    precisionAtK: rate(precisionNumerator, precisionDenominator),
    scopeIsolation: rate(isolated, samples.length),
    staleRejection: rate(staleRejected, samples.length),
    abstentionAccuracy: rate(abstentionCorrect, samples.length),
    overBudgetCases,
    latencyP50Ms: percentile(latencies, 50),
    latencyP95Ms: percentile(latencies, 95),
    peakRssBytes: Math.max(0, ...samples.map(sample => sample.rssBytes ?? 0)),
    passed: false,
    failures,
  };
  score.passed = score.recallAtK === 1
    && score.scopeIsolation === 1
    && score.staleRejection === 1
    && score.abstentionAccuracy === 1
    && score.overBudgetCases === 0;
  return score;
}
