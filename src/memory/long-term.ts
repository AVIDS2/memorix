import { randomUUID } from 'node:crypto';
import { countTextTokens, truncateToTokenBudget } from '../compact/token-budget.js';
import type { EmbeddingProvider } from '../embedding/provider.js';
import { withTimeout } from '../timeout.js';
import { sanitizeCredentials } from './secret-filter.js';
import type { Observation } from '../types.js';
import { resolveLocalMemoryOwner } from './owner.js';
import { LongTermMemoryStore } from './long-term-store.js';
import {
  LONG_TERM_MEMORY_EVIDENCE_KINDS,
  LONG_TERM_MEMORY_EVIDENCE_RELATIONS,
  LONG_TERM_MEMORY_KINDS,
  LONG_TERM_MEMORY_PORTABILITIES,
  LONG_TERM_MEMORY_SCOPES,
  type CreateLongTermMemoryInput,
  type LongTermMemory,
  type LongTermMemoryEvidence,
  type LongTermMemoryEvidenceInput,
  type LongTermMemoryKind,
  type LongTermMemoryPortability,
  type LongTermMemoryReader,
  type LongTermMemoryScope,
  type LongTermMemorySelection,
} from './long-term-types.js';

const MAX_TEXT_LENGTH = 12_000;
const MAX_LIST_ITEMS = 40;
const MAX_SEMANTIC_CANDIDATES = 48;
const SEMANTIC_RETRIEVAL_TIMEOUT_MS = 1_800;
const MIN_SEMANTIC_SIMILARITY = 0.58;
const PORTABLE_EVIDENCE_KINDS = new Set(['manual', 'user']);
const STOP_TERMS = new Set([
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'into', 'when', 'what',
  '如何', '什么', '这个', '那个', '我们', '项目', '进行', '需要', '继续', '处理',
]);

function isOneOf<T extends readonly string[]>(value: unknown, values: T): value is T[number] {
  return typeof value === 'string' && (values as readonly string[]).includes(value);
}

function compactText(value: string, field: string, max = MAX_TEXT_LENGTH): string {
  if (typeof value !== 'string') throw new Error('Long-term memory ' + field + ' must be text.');
  const safe = sanitizeCredentials(value).replace(/\s+/g, ' ').trim();
  if (!safe) throw new Error('Long-term memory ' + field + ' is required.');
  if (safe.length > max) throw new Error('Long-term memory ' + field + ' is too long.');
  return safe;
}

function compactList(values: string[] | undefined, field: string): string[] {
  if (!values) return [];
  if (!Array.isArray(values)) throw new Error('Long-term memory ' + field + ' must be an array.');
  return [...new Set(values
    .filter((value): value is string => typeof value === 'string')
    .map(value => compactText(value, field, 500)))]
    .slice(0, MAX_LIST_ITEMS);
}

function normalizeEvidence(input: LongTermMemoryEvidenceInput[]): LongTermMemoryEvidenceInput[] {
  if (!Array.isArray(input) || input.length === 0) {
    throw new Error('A long-term memory requires at least one source evidence reference.');
  }
  return input.map((evidence) => {
    if (!evidence || !isOneOf(evidence.kind, LONG_TERM_MEMORY_EVIDENCE_KINDS)) {
      throw new Error('Long-term memory evidence kind is invalid.');
    }
    if (!isOneOf(evidence.relation, LONG_TERM_MEMORY_EVIDENCE_RELATIONS)) {
      throw new Error('Long-term memory evidence relation is invalid.');
    }
    return {
      kind: evidence.kind,
      referenceId: compactText(evidence.referenceId, 'evidence reference', 1_000),
      relation: evidence.relation,
      ...(evidence.locator ? { locator: compactText(evidence.locator, 'evidence locator', 1_000) } : {}),
      ...(evidence.capturedHash ? { capturedHash: compactText(evidence.capturedHash, 'evidence hash', 1_000) } : {}),
    };
  });
}

function assertScope(scope: unknown): asserts scope is LongTermMemoryScope {
  if (!isOneOf(scope, LONG_TERM_MEMORY_SCOPES)) throw new Error('Long-term memory scope is invalid.');
}

function assertKind(kind: unknown): asserts kind is LongTermMemoryKind {
  if (!isOneOf(kind, LONG_TERM_MEMORY_KINDS)) throw new Error('Long-term memory kind is invalid.');
}

function assertPortability(value: unknown): asserts value is LongTermMemoryPortability {
  if (!isOneOf(value, LONG_TERM_MEMORY_PORTABILITIES)) {
    throw new Error('Long-term memory portability is invalid.');
  }
}

function assertPortableEvidence(scope: LongTermMemoryScope, portability: LongTermMemoryPortability, evidence: LongTermMemoryEvidenceInput[]): void {
  if (portability !== 'portable') return;
  if (scope !== 'user') {
    throw new Error('Only user-scoped long-term memories may be portable across projects.');
  }
  if (evidence.some(item => !PORTABLE_EVIDENCE_KINDS.has(item.kind))) {
    throw new Error('Portable user memory may only use manual or user-confirmed evidence; project code, Git, observation, test, session, claim, and workflow evidence must remain project-bound.');
  }
}

function requireTeamReader(scope: LongTermMemoryScope, reader?: LongTermMemoryReader): void {
  if (scope === 'team' && reader?.isTeamMember !== true) {
    throw new Error('Team long-term memory requires an explicit active team identity for this project.');
  }
}

function matchesScope(memory: LongTermMemory, reader: LongTermMemoryReader): boolean {
  if (memory.scope === 'project') return memory.originProjectId === reader.projectId;
  if (memory.scope === 'team') {
    return memory.originProjectId === reader.projectId && reader.isTeamMember === true;
  }
  if (!reader.ownerId || memory.ownerId !== reader.ownerId) return false;
  return memory.portability === 'portable' || memory.originProjectId === reader.projectId;
}

export function canReadLongTermMemory(memory: LongTermMemory, reader: LongTermMemoryReader): boolean {
  return matchesScope(memory, reader);
}

export function isEligibleLongTermMemory(memory: LongTermMemory): boolean {
  return memory.state === 'qualified' || memory.state === 'approved';
}

function taskTerms(task: string): string[] {
  const matches = task.toLocaleLowerCase('en-US').match(/[\p{L}\p{N}_./:-]+/gu) ?? [];
  return [...new Set(matches.filter(term => term.length > 1 && !STOP_TERMS.has(term)))].slice(0, 16);
}

function kindFitScore(kind: LongTermMemoryKind, task: string): number {
  const normalized = task.toLocaleLowerCase('en-US');
  const hints: Record<LongTermMemoryKind, string[]> = {
    episodic: ['resume', 'continue', 'handoff', 'previous', 'session', '接手', '继续', '交接', '上次', '会话'],
    semantic: ['why', 'what', 'architecture', 'design', 'decision', 'reason', '为什么', '是什么', '架构', '设计', '决策', '原因'],
    procedural: ['how', 'steps', 'procedure', 'run', 'release', 'publish', 'verify', 'implement', '流程', '步骤', '发布', '验证', '修复', '实现'],
  };
  return hints[kind].some(hint => normalized.includes(hint)) ? 1 : 0;
}

function validationFreshnessScore(memory: LongTermMemory): number {
  const validatedAt = memory.lastValidatedAt ?? memory.approvedAt ?? memory.qualifiedAt;
  if (!validatedAt) return 0;
  const time = Date.parse(validatedAt);
  if (!Number.isFinite(time)) return 0;
  const ageDays = Math.max(0, Date.now() - time) / (24 * 60 * 60 * 1000);
  if (ageDays <= 30) return 0.35;
  if (ageDays <= 90) return 0.15;
  return 0;
}

function scoreForTask(memory: LongTermMemory, task: string): { score: number; reason: string } | undefined {
  const terms = taskTerms(task);
  if (terms.length === 0) return undefined;
  const title = memory.title.toLocaleLowerCase('en-US');
  const content = memory.content.toLocaleLowerCase('en-US');
  const facts = memory.facts.join(' ').toLocaleLowerCase('en-US');
  const tags = memory.tags.join(' ').toLocaleLowerCase('en-US');
  const applicability = (memory.applicability ?? '').toLocaleLowerCase('en-US');
  let score = memory.state === 'approved' ? 0.5 : 0;
  const matched: string[] = [];
  for (const term of terms) {
    let termScore = 0;
    if (title.includes(term)) termScore += 5;
    if (tags.includes(term)) termScore += 4;
    if (applicability.includes(term)) termScore += 3;
    if (facts.includes(term)) termScore += 2;
    if (content.includes(term)) termScore += 1;
    if (termScore > 0) {
      score += termScore;
      matched.push(term);
    }
  }
  if (matched.length === 0) return undefined;
  score += kindFitScore(memory.kind, task);
  score += validationFreshnessScore(memory);
  const kindLabel = memory.kind === 'procedural' ? 'procedure' : memory.kind === 'semantic' ? 'fact' : 'episode';
  const freshness = validationFreshnessScore(memory) > 0 ? '; recently validated' : '';
  return { score, reason: kindLabel + ' matches ' + matched.slice(0, 3).join(', ') + freshness };
}

type LongTermEmbeddingProvider = Pick<EmbeddingProvider, 'embedBatch'>;

function semanticText(memory: LongTermMemory): string {
  return sanitizeCredentials([
    memory.title,
    memory.applicability,
    memory.tags.join(' '),
    memory.facts.join(' '),
    memory.content,
  ].filter((value): value is string => Boolean(value)).join('\n'))
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TEXT_LENGTH);
}

function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length === 0 || left.length !== right.length) return 0;
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index];
    const b = right[index];
    if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
    dot += a * b;
    leftMagnitude += a * a;
    rightMagnitude += b * b;
  }
  if (leftMagnitude === 0 || rightMagnitude === 0) return 0;
  return dot / Math.sqrt(leftMagnitude * rightMagnitude);
}

function semanticSelection(memory: LongTermMemory, similarity: number, task: string): { score: number; reason: string } | undefined {
  if (similarity < MIN_SEMANTIC_SIMILARITY) return undefined;
  const kindLabel = memory.kind === 'procedural' ? 'procedure' : memory.kind === 'semantic' ? 'fact' : 'episode';
  const freshness = validationFreshnessScore(memory) > 0 ? '; recently validated' : '';
  return {
    score: similarity * 10 + (memory.state === 'approved' ? 0.5 : 0) + kindFitScore(memory.kind, task) + validationFreshnessScore(memory),
    reason: kindLabel + ' semantic match ' + similarity.toFixed(2) + freshness,
  };
}

async function resolveSemanticProvider(explicit?: LongTermEmbeddingProvider | null): Promise<LongTermEmbeddingProvider | null> {
  if (explicit !== undefined) return explicit;
  try {
    const { getEmbeddingProvider } = await import('../embedding/provider.js');
    return await withTimeout(
      getEmbeddingProvider({ requestTimeoutMs: SEMANTIC_RETRIEVAL_TIMEOUT_MS, retry: false }),
      SEMANTIC_RETRIEVAL_TIMEOUT_MS,
      'Long-term semantic provider initialization',
    );
  } catch {
    return null;
  }
}

function createStore(dataDir: string): Promise<LongTermMemoryStore> {
  const store = new LongTermMemoryStore();
  return store.init(dataDir).then(() => store);
}

export interface CreateManualLongTermMemoryInput {
  dataDir: string;
  projectId: string;
  scope: LongTermMemoryScope;
  kind: LongTermMemoryKind;
  title: string;
  content: string;
  facts?: string[];
  tags?: string[];
  applicability?: string;
  portability?: LongTermMemoryPortability;
  reader?: LongTermMemoryReader;
}

/** Create a local manually declared candidate with explicit user/manual provenance. */
export async function createManualLongTermMemory(input: CreateManualLongTermMemoryInput): Promise<{
  memory: LongTermMemory;
  evidence: LongTermMemoryEvidence[];
}> {
  const owner = await resolveLocalMemoryOwner(input.dataDir, { create: true });
  if (!owner) throw new Error('Memorix could not resolve a local memory owner.');
  assertScope(input.scope);
  const evidence: LongTermMemoryEvidenceInput[] = input.scope === 'user'
    ? [{ kind: 'user', referenceId: owner.id, relation: 'user-confirmed' }]
    : [{ kind: 'manual', referenceId: 'manual:' + randomUUID(), relation: 'supports' }];
  return createLongTermMemoryWithDataDir({
    dataDir: input.dataDir,
    originProjectId: input.projectId,
    ownerId: owner.id,
    scope: input.scope,
    kind: input.kind,
    portability: input.portability,
    title: input.title,
    content: input.content,
    facts: input.facts,
    tags: input.tags,
    applicability: input.applicability,
    origin: 'manual',
    evidence,
    reader: input.reader,
  });
}

export interface PromoteObservationToLongTermInput {
  dataDir: string;
  observation: Observation;
  scope: LongTermMemoryScope;
  kind: LongTermMemoryKind;
  tags?: string[];
  applicability?: string;
  reader?: LongTermMemoryReader;
}

/**
 * Promote an existing observation without duplicating or hiding its source.
 * Observation-derived items are deliberately project-bound.
 */
export async function promoteObservationToLongTermMemory(input: PromoteObservationToLongTermInput): Promise<{
  memory: LongTermMemory;
  evidence: LongTermMemoryEvidence[];
}> {
  const owner = await resolveLocalMemoryOwner(input.dataDir, { create: true });
  if (!owner) throw new Error('Memorix could not resolve a local memory owner.');
  return createLongTermMemoryWithDataDir({
    dataDir: input.dataDir,
    originProjectId: input.observation.projectId,
    ownerId: owner.id,
    scope: input.scope,
    kind: input.kind,
    portability: 'project-bound',
    title: input.observation.title,
    content: input.observation.narrative,
    facts: input.observation.facts,
    tags: input.tags ?? input.observation.concepts,
    applicability: input.applicability,
    origin: input.observation.source === 'git' ? 'git' : 'agent',
    evidence: [{
      kind: 'observation',
      referenceId: 'obs:' + input.observation.projectId + ':' + input.observation.id,
      relation: 'derives',
    }],
    reader: input.reader,
  });
}

export interface CreateLongTermMemoryCandidateInput extends CreateLongTermMemoryInput {
  dataDir: string;
  reader?: LongTermMemoryReader;
}

/** Create a candidate only. Qualification and approval are deliberate later transitions. */
export async function createLongTermMemoryCandidate(input: CreateLongTermMemoryCandidateInput): Promise<{
  memory: LongTermMemory;
  evidence: LongTermMemoryEvidence[];
}> {
  return createLongTermMemoryWithDataDir(input);
}

async function createLongTermMemoryWithDataDir(input: CreateLongTermMemoryCandidateInput): Promise<{
  memory: LongTermMemory;
  evidence: LongTermMemoryEvidence[];
}> {
  assertScope(input.scope);
  assertKind(input.kind);
  const portability = input.portability ?? 'project-bound';
  assertPortability(portability);
  requireTeamReader(input.scope, input.reader);
  const evidenceInputs = normalizeEvidence(input.evidence);
  assertPortableEvidence(input.scope, portability, evidenceInputs);
  const now = new Date().toISOString();
  const memory: LongTermMemory = {
    id: randomUUID(),
    originProjectId: compactText(input.originProjectId, 'origin project id', 1_000),
    ownerId: compactText(input.ownerId, 'owner id', 160),
    scope: input.scope,
    kind: input.kind,
    state: 'candidate',
    portability,
    title: compactText(input.title, 'title', 500),
    content: compactText(input.content, 'content'),
    facts: compactList(input.facts, 'facts'),
    tags: compactList(input.tags, 'tags'),
    ...(input.applicability ? { applicability: compactText(input.applicability, 'applicability', 1_000) } : {}),
    origin: input.origin ?? 'manual',
    createdAt: now,
    updatedAt: now,
    accessCount: 0,
  };
  const store = await createStore(input.dataDir);
  const evidence = store.transaction(() => {
    store.insert(memory);
    const written = evidenceInputs.map(item => store.insertEvidence({ memoryId: memory.id, ...item, createdAt: now }));
    store.recordEvent({
      memoryId: memory.id,
      kind: 'created',
      toState: 'candidate',
      detail: 'Created as a source-backed long-term memory candidate.',
      createdAt: now,
    });
    return written;
  });
  return { memory, evidence };
}

function transitionDetail(value: string): string {
  return compactText(value, 'transition reason', 1_000);
}

async function transitionMemory(input: {
  dataDir: string;
  id: string;
  expected: 'candidate' | 'qualified';
  next: 'qualified' | 'approved';
  event: 'qualified' | 'approved';
  reason: string;
}): Promise<LongTermMemory> {
  const store = await createStore(input.dataDir);
  return store.transaction(() => {
    const current = store.get(input.id);
    if (!current) throw new Error('Long-term memory was not found.');
    if (current.state !== input.expected) {
      throw new Error('Long-term memory must be ' + input.expected + ' before it can be ' + input.next + '.');
    }
    const evidence = store.listEvidence(current.id);
    if (evidence.length === 0) throw new Error('Long-term memory cannot advance without source evidence.');
    const now = new Date().toISOString();
    const next: LongTermMemory = {
      ...current,
      state: input.next,
      updatedAt: now,
      lastValidatedAt: now,
      ...(input.next === 'qualified' ? { qualifiedAt: now } : { approvedAt: now }),
    };
    store.update(next);
    store.recordEvent({
      memoryId: next.id,
      kind: input.event,
      fromState: current.state,
      toState: next.state,
      detail: transitionDetail(input.reason),
      createdAt: now,
    });
    return next;
  });
}

export async function qualifyLongTermMemory(input: { dataDir: string; id: string; reason: string }): Promise<LongTermMemory> {
  return transitionMemory({ ...input, expected: 'candidate', next: 'qualified', event: 'qualified' });
}

export async function approveLongTermMemory(input: { dataDir: string; id: string; reason: string }): Promise<LongTermMemory> {
  return transitionMemory({ ...input, expected: 'qualified', next: 'approved', event: 'approved' });
}

export async function archiveLongTermMemory(input: { dataDir: string; id: string; reason: string }): Promise<LongTermMemory> {
  const store = await createStore(input.dataDir);
  return store.transaction(() => {
    const current = store.get(input.id);
    if (!current) throw new Error('Long-term memory was not found.');
    if (current.state === 'archived' || current.state === 'superseded') {
      throw new Error('Long-term memory is already inactive.');
    }
    const now = new Date().toISOString();
    const next: LongTermMemory = { ...current, state: 'archived', archivedAt: now, updatedAt: now };
    store.update(next);
    store.recordEvent({
      memoryId: next.id,
      kind: 'archived',
      fromState: current.state,
      toState: 'archived',
      detail: transitionDetail(input.reason),
      createdAt: now,
    });
    return next;
  });
}

/**
 * Retire an active record in favor of another qualified or approved record.
 * The replacement remains its own audited artifact; this only records the
 * relationship and prevents the old record from entering future Worksets.
 */
export async function supersedeLongTermMemory(input: {
  dataDir: string;
  id: string;
  supersededBy: string;
  reason: string;
}): Promise<LongTermMemory> {
  const store = await createStore(input.dataDir);
  return store.transaction(() => {
    const current = store.get(input.id);
    if (!current) throw new Error('Long-term memory was not found.');
    if (current.state === 'archived' || current.state === 'superseded') {
      throw new Error('Long-term memory is already inactive.');
    }
    if (current.id === input.supersededBy) {
      throw new Error('Long-term memory cannot supersede itself.');
    }
    const replacement = store.get(input.supersededBy);
    if (!replacement || !isEligibleLongTermMemory(replacement)) {
      throw new Error('Replacement long-term memory must be qualified or approved.');
    }
    if (replacement.scope !== current.scope) {
      throw new Error('Replacement long-term memory must use the same scope.');
    }
    if (current.scope === 'user' && replacement.ownerId !== current.ownerId) {
      throw new Error('User long-term memory may only be superseded by the same local owner.');
    }
    if (current.scope !== 'user' && replacement.originProjectId !== current.originProjectId) {
      throw new Error('Project and team long-term memory may only be superseded within the same project.');
    }
    const now = new Date().toISOString();
    const next: LongTermMemory = {
      ...current,
      state: 'superseded',
      supersededBy: replacement.id,
      updatedAt: now,
    };
    store.update(next);
    store.recordEvent({
      memoryId: next.id,
      kind: 'superseded',
      fromState: current.state,
      toState: 'superseded',
      detail: transitionDetail(input.reason),
      createdAt: now,
    });
    return next;
  });
}

export async function listLongTermMemories(input: {
  dataDir: string;
  reader: LongTermMemoryReader;
  includeInactive?: boolean;
  limit?: number;
}): Promise<Array<{ memory: LongTermMemory; evidence: LongTermMemoryEvidence[] }>> {
  const store = await createStore(input.dataDir);
  return store.list({ limit: input.limit ?? 100 })
    .filter(memory => canReadLongTermMemory(memory, input.reader))
    .filter(memory => input.includeInactive || memory.state !== 'archived' && memory.state !== 'superseded')
    .map(memory => ({ memory, evidence: store.listEvidence(memory.id) }));
}

export async function getLongTermMemoryDetail(input: {
  dataDir: string;
  id: string;
  reader: LongTermMemoryReader;
}): Promise<{ memory: LongTermMemory; evidence: LongTermMemoryEvidence[]; events: ReturnType<LongTermMemoryStore['listEvents']> }> {
  const store = await createStore(input.dataDir);
  const memory = store.get(input.id);
  if (!memory || !canReadLongTermMemory(memory, input.reader)) {
    throw new Error('Long-term memory was not found in the active scope.');
  }
  store.markAccess([memory.id]);
  return { memory, evidence: store.listEvidence(memory.id), events: store.listEvents(memory.id) };
}

export async function selectLongTermMemoriesForTask(input: {
  dataDir: string;
  projectId: string;
  task?: string;
  agentId?: string;
  isTeamMember?: boolean;
  limit?: number;
  /** Tests and bounded integrations may provide an already-ready provider. Null disables semantic fallback. */
  embeddingProvider?: LongTermEmbeddingProvider | null;
}): Promise<LongTermMemorySelection[]> {
  const task = input.task?.trim();
  if (!task) return [];
  const owner = await resolveLocalMemoryOwner(input.dataDir, { create: false });
  const reader: LongTermMemoryReader = {
    projectId: input.projectId,
    ...(owner ? { ownerId: owner.id } : {}),
    ...(input.agentId ? { agentId: input.agentId } : {}),
    ...(input.isTeamMember ? { isTeamMember: true } : {}),
  };
  const store = await createStore(input.dataDir);
  const eligible = store.list({ limit: 1_000 })
    .filter(memory => isEligibleLongTermMemory(memory) && canReadLongTermMemory(memory, reader));
  let selected = eligible
    .map(memory => {
      const ranked = scoreForTask(memory, task);
      return ranked ? {
        memory,
        evidence: store.listEvidence(memory.id),
        score: ranked.score,
        reason: ranked.reason,
      } : undefined;
    })
    .filter((item): item is LongTermMemorySelection => Boolean(item))
    .sort((left, right) => right.score - left.score || right.memory.updatedAt.localeCompare(left.memory.updatedAt) || left.memory.id.localeCompare(right.memory.id));

  // Keyword matches remain the fast, deterministic primary route. Semantic
  // fallback only runs when none matched, after scope and lifecycle filtering,
  // so it cannot turn an unrelated global record into default context.
  if (selected.length === 0 && eligible.length > 0) {
    const provider = await resolveSemanticProvider(input.embeddingProvider);
    const candidates = eligible.slice(0, MAX_SEMANTIC_CANDIDATES);
    if (provider && candidates.length > 0) {
      try {
        const vectors = await withTimeout(
          provider.embedBatch([task, ...candidates.map(semanticText)], {
            timeoutMs: SEMANTIC_RETRIEVAL_TIMEOUT_MS,
            retry: false,
          }),
          SEMANTIC_RETRIEVAL_TIMEOUT_MS,
          'Long-term semantic retrieval',
        );
        const query = vectors[0];
        if (Array.isArray(query)) {
          selected = candidates
            .map((memory, index) => {
              const vector = vectors[index + 1];
              const ranked = Array.isArray(vector)
                ? semanticSelection(memory, cosineSimilarity(query, vector), task)
                : undefined;
              return ranked ? {
                memory,
                evidence: store.listEvidence(memory.id),
                score: ranked.score,
                reason: ranked.reason,
              } : undefined;
            })
            .filter((item): item is LongTermMemorySelection => Boolean(item))
            .sort((left, right) => right.score - left.score || right.memory.updatedAt.localeCompare(left.memory.updatedAt) || left.memory.id.localeCompare(right.memory.id));
        }
      } catch {
        // Semantic enrichment is optional. A slow or unavailable provider must
        // preserve the normal keyword-only retrieval path.
      }
    }
  }

  selected = selected.slice(0, Math.max(1, Math.min(input.limit ?? 3, 5)));
  store.markAccess(selected.map(item => item.memory.id));
  return selected;
}

export function renderLongTermMemorySummary(memory: LongTermMemory, maxTokens = 22): string {
  const source = [memory.title, memory.applicability, memory.content].filter(Boolean).join(': ');
  const safe = sanitizeCredentials(source).replace(/\s+/g, ' ').trim();
  return countTextTokens(safe) <= maxTokens ? safe : truncateToTokenBudget(safe, maxTokens);
}
