/**
 * Durable cognitive-memory contracts. These types are intentionally separate
 * from Observation provenance and Knowledge Claim truth contracts.
 */

export const LONG_TERM_MEMORY_KINDS = ['episodic', 'semantic', 'procedural'] as const;
export type LongTermMemoryKind = typeof LONG_TERM_MEMORY_KINDS[number];

export const LONG_TERM_MEMORY_SCOPES = ['project', 'user', 'team'] as const;
export type LongTermMemoryScope = typeof LONG_TERM_MEMORY_SCOPES[number];

export const LONG_TERM_MEMORY_STATES = [
  'candidate',
  'qualified',
  'approved',
  'archived',
  'superseded',
] as const;
export type LongTermMemoryState = typeof LONG_TERM_MEMORY_STATES[number];

export const LONG_TERM_MEMORY_PORTABILITIES = ['project-bound', 'portable'] as const;
export type LongTermMemoryPortability = typeof LONG_TERM_MEMORY_PORTABILITIES[number];

export const LONG_TERM_MEMORY_EVIDENCE_KINDS = [
  'observation',
  'claim',
  'workflow',
  'session',
  'checkpoint',
  'git',
  'code',
  'test',
  'run',
  'document',
  'manual',
  'user',
] as const;
export type LongTermMemoryEvidenceKind = typeof LONG_TERM_MEMORY_EVIDENCE_KINDS[number];

export const LONG_TERM_MEMORY_EVIDENCE_RELATIONS = [
  'supports',
  'verifies',
  'derives',
  'user-confirmed',
] as const;
export type LongTermMemoryEvidenceRelation = typeof LONG_TERM_MEMORY_EVIDENCE_RELATIONS[number];

export type LongTermMemoryOrigin = 'manual' | 'agent' | 'hook' | 'git' | 'migration';

export interface LongTermMemoryEvidence {
  id: string;
  memoryId: string;
  kind: LongTermMemoryEvidenceKind;
  referenceId: string;
  relation: LongTermMemoryEvidenceRelation;
  locator?: string;
  capturedHash?: string;
  createdAt: string;
}

export interface LongTermMemory {
  id: string;
  /** Project from which this item and its evidence originated. */
  originProjectId: string;
  /** Local stable owner identity. Team and project records retain attribution. */
  ownerId: string;
  scope: LongTermMemoryScope;
  kind: LongTermMemoryKind;
  state: LongTermMemoryState;
  portability: LongTermMemoryPortability;
  title: string;
  content: string;
  facts: string[];
  tags: string[];
  /** Short condition explaining when the procedure/fact applies. */
  applicability?: string;
  origin: LongTermMemoryOrigin;
  createdAt: string;
  updatedAt: string;
  qualifiedAt?: string;
  approvedAt?: string;
  archivedAt?: string;
  supersededBy?: string;
  lastValidatedAt?: string;
  accessCount: number;
  lastAccessedAt?: string;
}

export type LongTermMemoryEventKind = 'created' | 'qualified' | 'approved' | 'archived' | 'superseded';

export interface LongTermMemoryEvent {
  id: string;
  memoryId: string;
  kind: LongTermMemoryEventKind;
  fromState?: LongTermMemoryState;
  toState?: LongTermMemoryState;
  detail?: string;
  createdAt: string;
}

export interface LongTermMemoryReader {
  projectId: string;
  ownerId?: string;
  agentId?: string;
  isTeamMember?: boolean;
}

export interface LongTermMemoryEvidenceInput {
  kind: LongTermMemoryEvidenceKind;
  referenceId: string;
  relation: LongTermMemoryEvidenceRelation;
  locator?: string;
  capturedHash?: string;
}

export interface CreateLongTermMemoryInput {
  originProjectId: string;
  ownerId: string;
  scope: LongTermMemoryScope;
  kind: LongTermMemoryKind;
  portability?: LongTermMemoryPortability;
  title: string;
  content: string;
  facts?: string[];
  tags?: string[];
  applicability?: string;
  origin?: LongTermMemoryOrigin;
  evidence: LongTermMemoryEvidenceInput[];
}

export interface LongTermMemorySelection {
  memory: LongTermMemory;
  evidence: LongTermMemoryEvidence[];
  score: number;
  reason: string;
}
