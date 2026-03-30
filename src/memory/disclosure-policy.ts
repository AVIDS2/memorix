/**
 * Disclosure Policy
 *
 * Lightweight helper that classifies an observation or index entry into
 * an L1 / L2 / L3 disclosure layer based on its provenance fields.
 *
 * Rules (phase 2 first-cut):
 *   L2 — default working-context: explicit, undefined, or core-valued
 *   L1 — routing signal: hook auto-captures (non-core)
 *   L3 — evidence layer: git-ingest (non-core), or any other low-trust source
 *
 * git-ingest defaults to L3 but can be promoted to L2 by valueCategory=core.
 * Rules are kept explicit and easy to extend in future phases.
 */

export type DisclosureLayer = 'L1' | 'L2' | 'L3';

export interface ProvenanceFields {
  sourceDetail?: string;
  valueCategory?: string;
}

/**
 * Classify a single observation or index entry into a disclosure layer.
 */
export function classifyLayer(fields: ProvenanceFields): DisclosureLayer {
  const { sourceDetail, valueCategory } = fields;

  // Core-valued memories are always promoted to L2, regardless of source.
  if (valueCategory === 'core') return 'L2';

  // Hook auto-captures without core classification → L1 routing signal.
  if (sourceDetail === 'hook') return 'L1';

  // Git-ingest is evidence-grounded but defaults to L3.
  // Caller may choose to promote selectively (e.g., when L2 is thin).
  if (sourceDetail === 'git-ingest') return 'L3';

  // Explicit, undefined/legacy, manual → L2 working context.
  return 'L2';
}

/**
 * Return a compact source badge string for display in search tables.
 * Keeps existing table structure stable — fits in a narrow column.
 */
export function sourceBadge(sourceDetail?: string): string {
  if (sourceDetail === 'explicit') return 'ex';
  if (sourceDetail === 'hook') return 'hk';
  if (sourceDetail === 'git-ingest') return 'git';
  return '';
}
