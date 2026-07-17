import { createHash, randomUUID } from 'node:crypto';
import { countTextTokens } from '../compact/token-budget.js';
import type { CodeGraphStore } from '../codegraph/store.js';
import type { CodeStateSnapshot, ObservationCodeRef } from '../codegraph/types.js';
import { sanitizeCredentials } from '../memory/secret-filter.js';
import type { Observation, ObservationType } from '../types.js';
import { ClaimStore } from './claim-store.js';
import type {
  ClaimConflict,
  ClaimEvidenceInput,
  ClaimEvidenceRef,
  ClaimSelection,
  ClaimWriteResult,
  KnowledgeClaim,
  KnowledgeClaimInput,
  KnowledgeClaimReviewState,
  KnowledgeClaimStatus,
} from './types.js';

const MAX_TERM_LENGTH = 2_000;
const MAX_EVIDENCE_ID_LENGTH = 1_000;
const TOKEN_PATTERN = /[\p{L}\p{N}_./:-]+/gu;

const PREDICATE_BY_OBSERVATION_TYPE: Partial<Record<ObservationType, string>> = {
  decision: 'decision',
  'trade-off': 'trade-off',
  'why-it-exists': 'rationale',
  'what-changed': 'changed',
  'problem-solution': 'workaround',
  gotcha: 'caution',
  'how-it-works': 'behavior',
  discovery: 'finding',
  reasoning: 'rationale',
};

function compactText(value: string, field: string): string {
  if (typeof value !== 'string') throw new Error('Claim ' + field + ' must be text');
  const sanitized = sanitizeCredentials(value).trim().replace(/\s+/g, ' ');
  if (!sanitized) throw new Error('Claim ' + field + ' is required');
  if (sanitized.length > MAX_TERM_LENGTH) throw new Error('Claim ' + field + ' is too long');
  return sanitized;
}

function normalizedTerm(value: string): string {
  return compactText(value, 'identity').toLocaleLowerCase('en-US');
}

function hashIdentity(parts: string[]): string {
  return createHash('sha256').update(parts.join(String.fromCharCode(31))).digest('hex');
}

export function buildClaimIdentity(input: Pick<KnowledgeClaimInput, 'subject' | 'predicate' | 'objectValue' | 'scope'>): {
  claimKey: string;
  conflictKey: string;
} {
  const subject = normalizedTerm(input.subject);
  const predicate = normalizedTerm(input.predicate);
  const objectValue = normalizedTerm(input.objectValue);
  return {
    claimKey: hashIdentity([subject, predicate, objectValue, input.scope]),
    conflictKey: hashIdentity([subject, predicate, input.scope]),
  };
}

function clampConfidence(value: number | undefined): number {
  if (value === undefined) return 0.7;
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error('Claim confidence must be a number between 0 and 1');
  }
  return value;
}

function validateEvidence(input: ClaimEvidenceInput[]): ClaimEvidenceInput[] {
  if (!Array.isArray(input) || input.length === 0) {
    throw new Error('A knowledge claim requires at least one evidence reference');
  }
  return input.map((evidence) => {
    if (!evidence || typeof evidence !== 'object') {
      throw new Error('Claim evidence must be an object');
    }
    const evidenceId = compactText(evidence.evidenceId, 'evidence id');
    if (evidenceId.length > MAX_EVIDENCE_ID_LENGTH) {
      throw new Error('Claim evidence id is too long');
    }
    if (!['observation', 'git', 'code', 'test', 'document', 'workflow', 'run'].includes(evidence.evidenceKind)) {
      throw new Error('Claim evidence kind is invalid');
    }
    if (!['supports', 'contradicts', 'derives', 'verifies'].includes(evidence.relation)) {
      throw new Error('Claim evidence relation is invalid');
    }
    return {
      evidenceKind: evidence.evidenceKind,
      evidenceId,
      relation: evidence.relation,
      ...(evidence.snapshotId ? { snapshotId: compactText(evidence.snapshotId, 'evidence snapshot id') } : {}),
      ...(evidence.locator ? { locator: compactText(evidence.locator, 'evidence locator') } : {}),
      ...(evidence.capturedHash ? { capturedHash: compactText(evidence.capturedHash, 'evidence hash') } : {}),
    };
  });
}

function normalizeClaimInput(input: KnowledgeClaimInput): {
  claim: KnowledgeClaim;
  evidence: ClaimEvidenceInput[];
} {
  if (!['project', 'workspace', 'team', 'workflow', 'task'].includes(input.scope)) {
    throw new Error('Claim scope is invalid');
  }
  const projectId = compactText(input.projectId, 'project id');
  const subject = compactText(input.subject, 'subject');
  const predicate = compactText(input.predicate, 'predicate');
  const objectValue = compactText(input.objectValue, 'object value');
  const identity = buildClaimIdentity({ subject, predicate, objectValue, scope: input.scope });
  const origin = input.origin ?? 'explicit';
  let reviewState: KnowledgeClaimReviewState = input.reviewState ?? 'approved';
  let status: KnowledgeClaimStatus = input.status ?? 'active';
  if (origin === 'model') {
    if (input.reviewState === 'approved' || input.status === 'active') {
      throw new Error('A model-origin claim cannot be approved or active without explicit review');
    }
    reviewState = input.reviewState ?? 'draft';
    status = input.status ?? 'unknown';
  }
  if (!['approved', 'needs-review', 'draft', 'rejected'].includes(reviewState)) {
    throw new Error('Claim review state is invalid');
  }
  if (!['active', 'superseded', 'disputed', 'unknown'].includes(status)) {
    throw new Error('Claim status is invalid');
  }
  const now = new Date().toISOString();
  return {
    claim: {
      id: randomUUID(),
      projectId,
      subject,
      predicate,
      objectValue,
      scope: input.scope,
      claimKey: identity.claimKey,
      conflictKey: identity.conflictKey,
      status,
      confidence: clampConfidence(input.confidence),
      observedAt: input.observedAt ?? now,
      ...(input.validFrom ? { validFrom: input.validFrom } : {}),
      ...(input.validTo ? { validTo: input.validTo } : {}),
      reviewState,
      origin,
      createdAt: now,
      updatedAt: now,
    },
    evidence: validateEvidence(input.evidence),
  };
}

function activeConflictClaims(store: ClaimStore, projectId: string, conflictKey: string): KnowledgeClaim[] {
  return store.listClaimsByConflictKey(projectId, conflictKey).filter(claim =>
    (claim.status === 'active' || claim.status === 'disputed') && claim.reviewState === 'approved');
}

function reconcileConflicts(
  store: ClaimStore,
  projectId: string,
  conflictKey: string,
  now: string,
): ClaimConflict[] {
  const claims = activeConflictClaims(store, projectId, conflictKey);
  const hasConflict = new Set(claims.map(claim => claim.claimKey)).size > 1;
  for (const claim of claims) {
    const nextStatus: KnowledgeClaimStatus = hasConflict ? 'disputed' : 'active';
    if (claim.status === nextStatus) continue;
    store.updateClaim({ ...claim, status: nextStatus, updatedAt: now });
    store.recordEvent({
      projectId,
      claimId: claim.id,
      kind: hasConflict ? 'conflicted' : 'requalified',
      fromStatus: claim.status,
      toStatus: nextStatus,
      detail: hasConflict
        ? 'A different approved assertion has the same subject, predicate, and scope.'
        : 'No remaining approved competing assertion exists.',
      createdAt: now,
    });
  }
  return store.listConflicts(projectId).filter(conflict => conflict.conflictKey === conflictKey);
}

function persistEvidence(store: ClaimStore, claim: KnowledgeClaim, evidence: ClaimEvidenceInput[], now: string): void {
  let added = false;
  for (const item of evidence) {
    added = store.insertEvidence({ claimId: claim.id, ...item, createdAt: now }) || added;
  }
  if (added) {
    store.touchClaim(claim.id, now);
    store.recordEvent({
      projectId: claim.projectId,
      claimId: claim.id,
      kind: 'evidence-added',
      detail: 'Additional source evidence was attached.',
      createdAt: now,
    });
  }
}

/** Write one claim without allowing a summary to replace its source evidence. */
export function writeClaim(store: ClaimStore, input: KnowledgeClaimInput): ClaimWriteResult {
  const normalized = normalizeClaimInput(input);
  return store.transaction(() => {
    const existing = store.findReusableClaim(normalized.claim.projectId, normalized.claim.claimKey);
    if (existing) {
      persistEvidence(store, existing, normalized.evidence, normalized.claim.updatedAt);
      return {
        claim: store.getClaim(existing.id) ?? existing,
        created: false,
        conflicts: store.listConflicts(existing.projectId)
          .filter(conflict => conflict.conflictKey === existing.conflictKey),
      };
    }

    store.insertClaim(normalized.claim);
    for (const evidence of normalized.evidence) {
      store.insertEvidence({ claimId: normalized.claim.id, ...evidence, createdAt: normalized.claim.createdAt });
    }
    store.recordEvent({
      projectId: normalized.claim.projectId,
      claimId: normalized.claim.id,
      kind: 'created',
      toStatus: normalized.claim.status,
      detail: 'Claim created with source evidence.',
      createdAt: normalized.claim.createdAt,
    });
    const conflicts = reconcileConflicts(
      store,
      normalized.claim.projectId,
      normalized.claim.conflictKey,
      normalized.claim.updatedAt,
    );
    return {
      claim: store.getClaim(normalized.claim.id) ?? normalized.claim,
      created: true,
      conflicts,
    };
  });
}

export function supersedeClaim(
  store: ClaimStore,
  input: {
    claimId: string;
    replacementClaimId: string;
    evidence: ClaimEvidenceInput[];
  },
): { superseded: KnowledgeClaim; replacement: KnowledgeClaim } {
  const evidence = validateEvidence(input.evidence);
  return store.transaction(() => {
    const claim = store.getClaim(input.claimId);
    const replacement = store.getClaim(input.replacementClaimId);
    if (!claim || !replacement) throw new Error('Both claims must exist before supersession');
    if (claim.projectId !== replacement.projectId || claim.conflictKey !== replacement.conflictKey) {
      throw new Error('A replacement claim must address the same project assertion');
    }
    if (claim.id === replacement.id) throw new Error('A claim cannot supersede itself');
    const now = new Date().toISOString();
    persistEvidence(store, claim, evidence, now);
    const updated: KnowledgeClaim = {
      ...claim,
      status: 'superseded',
      validTo: now,
      supersededBy: replacement.id,
      updatedAt: now,
    };
    store.updateClaim(updated);
    store.recordEvent({
      projectId: claim.projectId,
      claimId: claim.id,
      kind: 'superseded',
      fromStatus: claim.status,
      toStatus: 'superseded',
      relatedClaimId: replacement.id,
      detail: 'Superseded by an evidence-backed replacement claim.',
      createdAt: now,
    });
    reconcileConflicts(store, claim.projectId, claim.conflictKey, now);
    return {
      superseded: store.getClaim(claim.id) ?? updated,
      replacement: store.getClaim(replacement.id) ?? replacement,
    };
  });
}

function hashObservation(observation: Observation): string {
  return createHash('sha256').update(JSON.stringify([
    observation.title,
    observation.narrative,
    observation.facts,
    observation.filesModified,
    observation.updatedAt ?? observation.createdAt,
  ])).digest('hex');
}

function evidenceFromCodeRef(ref: ObservationCodeRef): ClaimEvidenceInput {
  return {
    evidenceKind: 'code',
    evidenceId: 'code-ref:' + ref.id,
    relation: 'supports',
    ...(ref.snapshotId ? { snapshotId: ref.snapshotId } : {}),
    locator: 'code-ref/' + ref.id,
    ...(ref.capturedSymbolHash || ref.capturedFileHash
      ? { capturedHash: ref.capturedSymbolHash ?? ref.capturedFileHash }
      : {}),
  };
}

/**
 * Converts only explicit or Git-ingested observations into conservative,
 * reviewable source claims. Hook/model-derived memories remain ordinary memory
 * until an agent or operator explicitly promotes them.
 */
export function deriveLowRiskClaimsFromObservation(
  store: ClaimStore,
  observation: Observation,
  codeStore?: CodeGraphStore,
): KnowledgeClaim[] {
  const predicate = PREDICATE_BY_OBSERVATION_TYPE[observation.type];
  const isExplicit = observation.sourceDetail === 'explicit';
  const isGit = observation.source === 'git' || observation.sourceDetail === 'git-ingest';
  if (!predicate || observation.status !== 'active' || (!isExplicit && !isGit)) return [];

  const evidence: ClaimEvidenceInput[] = [{
    evidenceKind: 'observation',
    evidenceId: 'observation:' + observation.id,
    relation: 'supports',
    locator: 'observation/' + observation.id,
    capturedHash: hashObservation(observation),
  }];
  if (observation.commitHash) {
    evidence.push({
      evidenceKind: 'git',
      evidenceId: 'git:' + observation.commitHash,
      relation: 'verifies',
      locator: 'git:' + observation.commitHash,
      capturedHash: observation.commitHash,
    });
  }
  const refs = codeStore?.listObservationRefs(observation.projectId, observation.id) ?? [];
  for (const ref of refs) evidence.push(evidenceFromCodeRef(ref));

  const confidence = Math.min(0.9, (isGit ? 0.75 : 0.7) + refs.filter(ref => ref.status === 'current').length * 0.05);
  const result = writeClaim(store, {
    projectId: observation.projectId,
    subject: observation.entityName,
    predicate,
    objectValue: observation.title,
    scope: 'project',
    confidence,
    observedAt: observation.updatedAt ?? observation.createdAt,
    reviewState: 'approved',
    origin: isGit ? 'git' : 'derived',
    evidence,
  });
  return [result.claim];
}

function incompleteSnapshot(snapshot: CodeStateSnapshot | undefined): boolean {
  if (!snapshot) return false;
  return snapshot.completeness.skippedOversizedFiles > 0 || snapshot.completeness.removalScanDeferred;
}

function requalification(
  claim: KnowledgeClaim,
  refs: Map<string, ObservationCodeRef>,
  evidence: ClaimEvidenceRef[],
  snapshot: CodeStateSnapshot | undefined,
): { status: KnowledgeClaimStatus; confidence: number; reviewState: KnowledgeClaimReviewState; reason?: string } | undefined {
  if (claim.status === 'superseded' || claim.reviewState === 'draft' || claim.reviewState === 'rejected') return undefined;
  const codeEvidence = evidence.filter(item => item.evidenceKind === 'code');
  if (codeEvidence.length === 0) return undefined;
  const linkedRefs = codeEvidence
    .map(item => refs.get(item.evidenceId.replace(/^code-ref:/, '')))
    .filter((ref): ref is ObservationCodeRef => !!ref);
  const missingOrStale = linkedRefs.length !== codeEvidence.length || linkedRefs.some(ref => ref.status === 'stale');
  if (missingOrStale) {
    return {
      status: 'unknown',
      confidence: Math.min(claim.confidence, 0.2),
      reviewState: 'needs-review',
      reason: 'Bound code evidence is no longer current.',
    };
  }
  if (linkedRefs.some(ref => ref.status === 'suspect')) {
    return {
      status: claim.status === 'disputed' ? 'disputed' : 'active',
      confidence: Math.min(claim.confidence, 0.5),
      reviewState: 'needs-review',
      reason: 'Bound file evidence changed and needs review.',
    };
  }
  if (incompleteSnapshot(snapshot)) {
    return {
      status: claim.status === 'disputed' ? 'disputed' : 'active',
      confidence: Math.min(claim.confidence, 0.55),
      reviewState: 'needs-review',
      reason: 'The latest code scan is incomplete.',
    };
  }
  return undefined;
}

/** Re-score code-bound claims after a completed CodeGraph refresh. */
export function requalifyClaimsForCodeState(
  store: ClaimStore,
  codeStore: CodeGraphStore,
  projectId: string,
): { requalified: number; incompleteSnapshot: boolean } {
  const snapshot = codeStore.latestSnapshot(projectId);
  const refs = new Map(codeStore.listProjectObservationRefs(projectId).map(ref => [ref.id, ref]));
  let requalified = 0;
  store.transaction(() => {
    for (const claim of store.listClaims(projectId)) {
      const next = requalification(claim, refs, store.listEvidence(claim.id), snapshot);
      if (!next) continue;
      if (
        next.status === claim.status
        && next.confidence === claim.confidence
        && next.reviewState === claim.reviewState
      ) {
        continue;
      }
      const updated = {
        ...claim,
        status: next.status,
        confidence: next.confidence,
        reviewState: next.reviewState,
        updatedAt: new Date().toISOString(),
      };
      store.updateClaim(updated);
      store.recordEvent({
        projectId,
        claimId: claim.id,
        kind: 'requalified',
        fromStatus: claim.status,
        toStatus: next.status,
        detail: next.reason,
        createdAt: updated.updatedAt,
      });
      requalified += 1;
    }
  });
  return { requalified, incompleteSnapshot: incompleteSnapshot(snapshot) };
}

function taskTokens(task: string): Set<string> {
  return new Set(
    sanitizeCredentials(task)
      .toLocaleLowerCase('en-US')
      .match(TOKEN_PATTERN)
      ?.filter(token => token.length > 1)
      ?? [],
  );
}

function scoreClaim(claim: KnowledgeClaim, tokens: Set<string>): number {
  const text = [claim.subject, claim.predicate, claim.objectValue]
    .join(' ')
    .toLocaleLowerCase('en-US');
  const words = new Set(text.match(TOKEN_PATTERN) ?? []);
  let matches = 0;
  for (const token of tokens) {
    if (words.has(token)) matches += 1;
  }
  if (matches === 0) return 0;
  const statusWeight = claim.status === 'active' ? 0.25 : claim.status === 'disputed' ? 0.2 : 0.1;
  return matches * 10 + claim.confidence + statusWeight;
}

function formatClaim(claim: KnowledgeClaim): string {
  return sanitizeCredentials([claim.subject, claim.predicate, claim.objectValue].join(' '));
}

/**
 * A deterministic compact selector used by the later Workset builder. It
 * returns no generic claim dump when no task terms match.
 */
export function selectClaimsForTask(
  store: ClaimStore,
  input: { projectId: string; task: string; limit?: number; maxTokens?: number },
): ClaimSelection {
  const limit = Math.max(1, Math.min(12, Math.floor(input.limit ?? 4)));
  const maxTokens = Math.max(16, Math.min(1_000, Math.floor(input.maxTokens ?? 160)));
  const tokens = taskTokens(input.task);
  if (tokens.size === 0) return { claims: [], cautions: [], tokenCount: 0, reasons: {} };

  const candidates = store.listClaims(input.projectId, {
    statuses: ['active', 'disputed', 'unknown'],
    limit: 1_000,
  }).filter(claim => claim.reviewState !== 'draft' && claim.reviewState !== 'rejected');
  const scored = candidates
    .map(claim => ({ claim, score: scoreClaim(claim, tokens) }))
    .filter(item => item.score > 0)
    .sort((left, right) => right.score - left.score || left.claim.id.localeCompare(right.claim.id));
  if (scored.length === 0) return { claims: [], cautions: [], tokenCount: 0, reasons: {} };

  const selected = new Map<string, KnowledgeClaim>();
  for (const { claim } of scored.slice(0, limit)) selected.set(claim.id, claim);
  for (const claim of [...selected.values()]) {
    for (const sibling of store.listClaimsByConflictKey(input.projectId, claim.conflictKey)) {
      if (sibling.status === 'active' || sibling.status === 'disputed') selected.set(sibling.id, sibling);
    }
  }

  const ordered = [...selected.values()]
    .sort((left, right) => scoreClaim(right, tokens) - scoreClaim(left, tokens) || left.id.localeCompare(right.id));
  const included: KnowledgeClaim[] = [];
  let tokenCount = 0;
  for (const claim of ordered) {
    const nextTokens = countTextTokens(formatClaim(claim));
    if (included.length > 0 && tokenCount + nextTokens > maxTokens) continue;
    included.push(claim);
    tokenCount += nextTokens;
  }

  const cautions = new Set<string>();
  const reasons: Record<string, string> = {};
  for (const claim of included) {
    reasons[claim.id] = 'task terms matched source-qualified claim';
    if (claim.status === 'disputed') cautions.add('claim-conflict');
    if (claim.status === 'unknown' || claim.reviewState === 'needs-review') {
      cautions.add('claim-needs-review');
    }
  }
  return { claims: included, cautions: [...cautions].sort(), tokenCount, reasons };
}
