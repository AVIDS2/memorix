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

/**
 * Evidence basis: how well-grounded a memory is in verifiable sources.
 *
 * Computed from existing fields — not stored separately.
 *   'repository' — backed by git provenance, commit evidence, or repository evidence
 *   'direct'     — explicitly agent-recorded, no git backing
 *   undefined    — hook trace, legacy, or unknown origin → neutral
 */
export type EvidenceBasis = 'repository' | 'direct' | undefined;

/**
 * Derive the evidence basis from existing provenance fields.
 * Conservative: only labels what can be clearly determined.
 * Neutral (undefined) is preferred over incorrect labeling.
 */
export function resolveEvidenceBasis(fields: {
  sourceDetail?: string;
  source?: string;
  commitHash?: string;
  relatedCommits?: string[];
}): EvidenceBasis {
  // Repository-backed: any strong git/repository provenance signal.
  if (
    fields.commitHash ||
    (fields.relatedCommits?.length ?? 0) > 0 ||
    fields.source === 'git' ||
    fields.sourceDetail === 'git-ingest'
  ) {
    return 'repository';
  }
  // Direct: explicitly agent-recorded, no git backing
  if (fields.sourceDetail === 'explicit') return 'direct';
  // Hook trace, manual, legacy, unknown → neutral
  return undefined;
}

/**
 * Return a compact one-line verification annotation for provenance headers.
 * Returns empty string when basis is 'direct' or undefined (not shown to avoid noise).
 * The commit hash is shown only in the detail path (commitHash present).
 */
export function evidenceBasisLine(basis: EvidenceBasis, commitHash?: string): string {
  if (basis === 'repository') {
    const commit = commitHash ? ` — commit ${commitHash.substring(0, 7)}` : '';
    return `✓ Repository-backed${commit}`;
  }
  return '';
}

export interface ProvenanceFields {
  sourceDetail?: string;
  valueCategory?: string;
  /** Legacy fallback: observations ingested before Phase 1 only have source='git'. */
  source?: string;
}

/**
 * Resolve the effective sourceDetail for an observation, supporting legacy
 * observations that only have source='git' and no sourceDetail.
 *
 * This is the single fallback point — call this instead of reading sourceDetail
 * directly whenever provenance classification or display is needed.
 */
export function resolveSourceDetail(
  sourceDetail?: string,
  source?: string,
): 'explicit' | 'hook' | 'git-ingest' | undefined {
  if (sourceDetail === 'explicit' || sourceDetail === 'hook' || sourceDetail === 'git-ingest') {
    return sourceDetail;
  }
  // Legacy git memories: source='git' with no sourceDetail → treat as git-ingest.
  if (source === 'git') return 'git-ingest';
  return undefined;
}

/**
 * Classify a single observation or index entry into a disclosure layer.
 */
export function classifyLayer(fields: ProvenanceFields): DisclosureLayer {
  const { valueCategory } = fields;
  const sd = resolveSourceDetail(fields.sourceDetail, fields.source);

  // Core-valued memories are always promoted to L2, regardless of source.
  if (valueCategory === 'core') return 'L2';

  // Hook auto-captures without core classification → L1 routing signal.
  if (sd === 'hook') return 'L1';

  // Git-ingest (including legacy source='git') defaults to L3.
  if (sd === 'git-ingest') return 'L3';

  // Explicit, undefined/legacy, manual → L2 working context.
  return 'L2';
}

/**
 * Return a compact source badge string for display in search tables.
 * Accepts both sourceDetail and legacy source for fallback resolution.
 * Keeps existing table structure stable — fits in a narrow column.
 */
export function sourceBadge(sourceDetail?: string, source?: string): string {
  const sd = resolveSourceDetail(sourceDetail, source);
  if (sd === 'explicit') return 'ex';
  if (sd === 'hook') return 'hk';
  if (sd === 'git-ingest') return 'git';
  return '';
}
