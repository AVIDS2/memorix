/**
 * Durable, source-qualified knowledge contracts.
 *
 * Claims are deliberately smaller than a wiki page: they record one assertion,
 * its lifecycle, and the evidence that makes the assertion safe to retrieve.
 */

export const KNOWLEDGE_CLAIM_SCOPES = [
  'project',
  'workspace',
  'team',
  'workflow',
  'task',
] as const;

export type KnowledgeClaimScope = typeof KNOWLEDGE_CLAIM_SCOPES[number];

export const KNOWLEDGE_CLAIM_STATUSES = [
  'active',
  'superseded',
  'disputed',
  'unknown',
] as const;

export type KnowledgeClaimStatus = typeof KNOWLEDGE_CLAIM_STATUSES[number];

export const KNOWLEDGE_CLAIM_REVIEW_STATES = [
  'approved',
  'needs-review',
  'draft',
  'rejected',
] as const;

export type KnowledgeClaimReviewState = typeof KNOWLEDGE_CLAIM_REVIEW_STATES[number];

export const CLAIM_EVIDENCE_KINDS = [
  'observation',
  'git',
  'code',
  'test',
  'document',
  'workflow',
  'run',
] as const;

export type ClaimEvidenceKind = typeof CLAIM_EVIDENCE_KINDS[number];

export const CLAIM_EVIDENCE_RELATIONS = [
  'supports',
  'contradicts',
  'derives',
  'verifies',
] as const;

export type ClaimEvidenceRelation = typeof CLAIM_EVIDENCE_RELATIONS[number];

export type KnowledgeClaimOrigin = 'explicit' | 'git' | 'derived' | 'model';

export const CLAIM_EVENT_KINDS = [
  'created',
  'evidence-added',
  'reviewed',
  'conflicted',
  'superseded',
  'requalified',
] as const;

export type ClaimEventKind = typeof CLAIM_EVENT_KINDS[number];

export interface KnowledgeClaim {
  id: string;
  projectId: string;
  subject: string;
  predicate: string;
  objectValue: string;
  scope: KnowledgeClaimScope;
  /** Exact normalized assertion identity: subject + predicate + object + scope. */
  claimKey: string;
  /** Normalized competing-assertion identity: subject + predicate + scope. */
  conflictKey: string;
  status: KnowledgeClaimStatus;
  confidence: number;
  observedAt: string;
  validFrom?: string;
  validTo?: string;
  supersededBy?: string;
  reviewState: KnowledgeClaimReviewState;
  origin: KnowledgeClaimOrigin;
  createdAt: string;
  updatedAt: string;
}

export interface ClaimEvidenceRef {
  id: string;
  claimId: string;
  evidenceKind: ClaimEvidenceKind;
  evidenceId: string;
  relation: ClaimEvidenceRelation;
  snapshotId?: string;
  locator?: string;
  capturedHash?: string;
  createdAt: string;
}

export interface ClaimEvidenceInput {
  evidenceKind: ClaimEvidenceKind;
  evidenceId: string;
  relation: ClaimEvidenceRelation;
  snapshotId?: string;
  locator?: string;
  capturedHash?: string;
}

export interface KnowledgeClaimInput {
  projectId: string;
  subject: string;
  predicate: string;
  objectValue: string;
  scope: KnowledgeClaimScope;
  evidence: ClaimEvidenceInput[];
  confidence?: number;
  observedAt?: string;
  validFrom?: string;
  validTo?: string;
  status?: KnowledgeClaimStatus;
  reviewState?: KnowledgeClaimReviewState;
  origin?: KnowledgeClaimOrigin;
}

export interface ClaimEvent {
  id: string;
  projectId: string;
  claimId: string;
  kind: ClaimEventKind;
  fromStatus?: KnowledgeClaimStatus;
  toStatus?: KnowledgeClaimStatus;
  relatedClaimId?: string;
  detail?: string;
  createdAt: string;
}

export interface ClaimConflict {
  conflictKey: string;
  claims: KnowledgeClaim[];
}

export interface ClaimWriteResult {
  claim: KnowledgeClaim;
  created: boolean;
  conflicts: ClaimConflict[];
}

export interface ClaimSelection {
  claims: KnowledgeClaim[];
  cautions: string[];
  tokenCount: number;
  reasons: Record<string, string>;
}
