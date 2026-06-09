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
 *   'repository'  — directly backed by a git commit or repository evidence
 *   'synthesized' — explicit agent analysis that cites repository evidence
 *                   via relatedCommits (no direct commitHash — not raw evidence)
 *   'direct'      — explicitly agent-recorded, no git backing
 *   undefined     — hook trace, legacy, or unknown origin → neutral
 */
export type EvidenceBasis = 'repository' | 'synthesized' | 'direct' | undefined;
/**
 * Derive the evidence basis from existing provenance fields.
 * Conservative: only labels what can be clearly determined.
 * Neutral (undefined) is preferred over incorrect labeling.
 */
export declare function resolveEvidenceBasis(fields: {
    sourceDetail?: string;
    source?: string;
    commitHash?: string;
    relatedCommits?: string[];
}): EvidenceBasis;
/**
 * Return a compact one-line verification annotation for provenance headers.
 * Returns empty string when basis is 'direct' or undefined (not shown to avoid noise).
 * The commit hash is shown only in the detail path (commitHash present).
 */
export declare function evidenceBasisLine(basis: EvidenceBasis, commitHash?: string): string;
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
export declare function resolveSourceDetail(sourceDetail?: string, source?: string): 'explicit' | 'hook' | 'git-ingest' | undefined;
/**
 * Classify a single observation or index entry into a disclosure layer.
 */
export declare function classifyLayer(fields: ProvenanceFields): DisclosureLayer;
/**
 * Return a compact source badge string for display in search tables.
 * Accepts both sourceDetail and legacy source for fallback resolution.
 * Keeps existing table structure stable — fits in a narrow column.
 */
export declare function sourceBadge(sourceDetail?: string, source?: string): string;
//# sourceMappingURL=disclosure-policy.d.ts.map