/** Pure feedback math shared by retrieval/retention without opening SQLite. */
export function feedbackWeightMultiplier(weight: number): number {
  return Math.max(0.35, Math.min(1.4, 0.35 + Math.max(0, Math.min(2, weight)) * 0.525));
}
