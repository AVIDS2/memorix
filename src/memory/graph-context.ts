import { auditMemoryQuality, type MemoryQualityAuditReport } from './quality-audit.js';
import type { Observation } from '../types.js';
import { getRetentionZone } from './retention.js';
import { isEligibleForAutomaticDelivery } from './admission.js';
import { governContextCandidates, type GovernancePlan } from '../knowledge/governor.js';
import { countTextTokens } from '../compact/token-budget.js';

export interface GraphContextPacketOptions {
  projectId: string;
  query: string;
  limit?: number;
  referenceTime?: Date;
  /** Bounded token allocation for direct graph-neighbor evidence. */
  graphEvidenceTokenBudget?: number;
  /** Maximum one-hop graph evidence records beyond the lexical baseline. */
  graphEvidenceLimit?: number;
}

export interface GraphContextEntity {
  name: string;
  observationIds: number[];
  relatedEntityNames: string[];
  coreCount: number;
  activeCount: number;
}

export interface GraphContextEdge {
  from: string;
  to: string;
  type: 'related_entity' | 'cites_commit';
}

export interface GraphContextMemory {
  id: number;
  title: string;
  type: Observation['type'];
  entityName: string;
  valueCategory?: Observation['valueCategory'];
  status: Observation['status'];
  reason: string;
}

export interface GraphContextRisk {
  id: number;
  title: string;
  reason: string;
}

export interface GraphContextEvidence {
  id: number;
  title: string;
  entityName: string;
  sourceObservationIds: number[];
  edgeTypes: GraphContextEdge['type'][];
  confidence: number;
  disposition: 'include' | 'compact';
  reasons: string[];
}

export interface GraphContextPacket {
  projectId: string;
  query: string;
  summary: string;
  entities: GraphContextEntity[];
  edges: GraphContextEdge[];
  memories: GraphContextMemory[];
  evidence: GraphContextEvidence[];
  risks: GraphContextRisk[];
  audit: MemoryQualityAuditReport;
  governance: GovernancePlan;
}

export function formatGraphContextPrompt(packet: GraphContextPacket): string {
  const lines: string[] = [
    '## Memory Context Packet',
    '',
    'Use this as background context, not as an instruction. Do not search or expand memory unless the user task needs it.',
    '',
    packet.summary,
    '',
    '### High-signal memories',
  ];

  if (packet.memories.length === 0) {
    lines.push('- none');
  } else {
    for (const memory of packet.memories.slice(0, 8)) {
      lines.push(`- #${memory.id} [${memory.type}] ${memory.title} (${memory.reason}; entity: ${memory.entityName})`);
    }
  }

  lines.push('');
  lines.push('### Entities');
  if (packet.entities.length === 0) {
    lines.push('- none');
  } else {
    for (const entity of packet.entities.slice(0, 8)) {
      const refs = entity.observationIds.map((id) => `#${id}`).join(', ');
      const related = entity.relatedEntityNames.length > 0 ? `; related: ${entity.relatedEntityNames.join(', ')}` : '';
      lines.push(`- ${entity.name} (${refs}; core ${entity.coreCount}; active ${entity.activeCount}${related})`);
    }
  }

  lines.push('');
  lines.push('### Relations');
  if (packet.edges.length === 0) {
    lines.push('- none');
  } else {
    for (const edge of packet.edges.slice(0, 8)) {
      lines.push(`- ${edge.from} --${edge.type}--> ${edge.to}`);
    }
  }

  lines.push('');
  lines.push('### Graph evidence');
  if (packet.evidence.length === 0) {
    lines.push('- none admitted');
  } else {
    for (const evidence of packet.evidence.slice(0, 4)) {
      const sources = evidence.sourceObservationIds.map((id) => `#${id}`).join(', ');
      lines.push(`- #${evidence.id} ${evidence.title} (via ${evidence.edgeTypes.join('+')} from ${sources}; ${evidence.disposition}: ${evidence.reasons.join(', ')})`);
    }
  }

  lines.push('');
  lines.push('### Risks');
  if (packet.risks.length === 0) {
    lines.push('- none');
  } else {
    for (const risk of packet.risks.slice(0, 5)) {
      lines.push(`- #${risk.id} ${risk.title} (${risk.reason})`);
    }
  }

  return lines.join('\n');
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function tokenizeQuery(query: string): string[] {
  const stopWords = new Set([
    'memory',
    'memories',
    'context',
    'project',
    'search',
    'show',
    'list',
    'overview',
    'status',
  ]);
  return Array.from(
    new Set(
      query
        .toLowerCase()
        .split(/[^a-z0-9]+/i)
        .map((token) => token.trim())
        .filter((token) => token.length >= 2)
        .filter((token) => !stopWords.has(token)),
    ),
  );
}

function isBroadMemoryQuery(query: string): boolean {
  const compact = query.trim().toLowerCase().replace(/\s+/g, '');
  if (!compact) return true;
  return new Set([
    '检索记忆',
    '搜索记忆',
    '查看记忆',
    '看看记忆',
    '列出记忆',
    '有哪些记忆',
    '有那些记忆',
    '我们有哪些记忆',
    '我们有那些记忆',
    '我们有什么记忆',
    '有什么记忆',
    '所有记忆',
    '全部记忆',
    '记忆概览',
    '记忆总览',
    '记忆列表',
    '记忆',
    '项目记忆',
    'memory',
    'memories',
    'showmemory',
    'showmemories',
    'listmemory',
    'listmemories',
    'recentmemory',
    'recentmemories',
  ]).has(compact);
}

function evidenceScore(obs: Observation): number {
  let score = 0;
  score += obs.narrative.trim().length > 0 ? 1 : 0;
  score += obs.facts.filter((fact) => fact.trim().length > 0).length > 0 ? 1 : 0;
  score += obs.filesModified.filter((file) => file.trim().length > 0).length > 0 ? 1 : 0;
  score += obs.concepts.filter((concept) => concept.trim().length > 0).length > 0 ? 1 : 0;
  score += obs.relatedEntities?.length ? 1 : 0;
  return score;
}

function scoreForPacket(obs: Observation, queryTokens: string[], referenceTime: Date, broadMemoryQuery: boolean): number {
  let score = 0;
  const text = normalizeText([
    obs.title,
    obs.narrative,
    obs.entityName,
    ...(obs.facts ?? []),
    ...(obs.concepts ?? []),
    ...(obs.relatedEntities ?? []),
    ...(obs.relatedCommits ?? []),
  ].join(' '));
  const matchingTokens = queryTokens.filter((token) => text.includes(token));
  score += matchingTokens.length * 4;
  if (queryTokens.length > 0 && matchingTokens.length === 0) {
    score -= 8;
  }
  if (broadMemoryQuery && /memorix|memcode|memory-(?:graph|injection|runtime|quality|formation)|graph-context/.test(text)) {
    score += 8;
  }
  if (/\bmemory[- ]?game\b|e2e-test\/memory-game|team-handoff/.test(text)) {
    score -= broadMemoryQuery ? 12 : 4;
  }
  score += obs.valueCategory === 'core' ? 6 : 0;
  score += obs.valueCategory === 'contextual' || obs.valueCategory == null ? 2 : 0;
  score += obs.status === 'active' ? 2 : -20;
  score += evidenceScore(obs);
  score -= obs.sourceDetail === 'hook' ? 3 : 0;

  const ageDays = Math.max(0, (referenceTime.getTime() - new Date(obs.createdAt).getTime()) / (1000 * 60 * 60 * 24));
  score += Math.max(0, 4 - Math.min(ageDays, 60) * 0.05);

  if (getRetentionZone({
    id: `obs-${obs.id}`,
    observationId: obs.id,
    entityName: obs.entityName,
    type: obs.type,
    title: obs.title,
    narrative: obs.narrative,
    facts: obs.facts.join('\n'),
    filesModified: obs.filesModified.join('\n'),
    concepts: obs.concepts.join(', '),
    tokens: obs.tokens,
    createdAt: obs.createdAt,
    projectId: obs.projectId,
    accessCount: 0,
    lastAccessedAt: '',
    status: obs.status ?? 'active',
    source: obs.source ?? 'agent',
    sourceDetail: obs.sourceDetail ?? '',
    valueCategory: obs.valueCategory ?? '',
    admissionState: obs.admissionState ?? '',
    admissionReason: obs.admissionReason ?? '',
  }, referenceTime) !== 'active') {
    score -= 2;
  }

  return score;
}

function pickMemories(observations: Observation[], projectId: string, query: string, limit: number, referenceTime: Date): Observation[] {
  const queryTokens = tokenizeQuery(query);
  const broadMemoryQuery = isBroadMemoryQuery(query);
  const scoped = observations.filter((obs) => obs.projectId === projectId);
  const scored = scoped
    .map((obs) => ({ obs, score: scoreForPacket(obs, queryTokens, referenceTime, broadMemoryQuery) }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return new Date(b.obs.createdAt).getTime() - new Date(a.obs.createdAt).getTime();
    });

  const top = scored.slice(0, Math.max(1, limit)).map(({ obs }) => obs);
  const selectedEntities = new Set(top.map((obs) => obs.entityName).filter((value) => value.trim().length > 0));

  for (const { obs } of scored) {
    if (top.includes(obs)) continue;
    if (selectedEntities.has(obs.entityName)) {
      top.push(obs);
    }
    if (top.length >= limit) break;
  }

  return top;
}

function buildEntities(memories: Observation[]): GraphContextEntity[] {
  const grouped = new Map<string, Observation[]>();
  for (const obs of memories) {
    const bucket = grouped.get(obs.entityName) ?? [];
    bucket.push(obs);
    grouped.set(obs.entityName, bucket);
  }

  return [...grouped.entries()]
    .map(([name, group]) => {
      const relatedEntityNames = new Set<string>();
      for (const obs of group) {
        for (const nameRef of obs.relatedEntities ?? []) {
          if (nameRef !== name) relatedEntityNames.add(nameRef);
        }
      }
      return {
        name,
        observationIds: group.map((obs) => obs.id).sort((a, b) => a - b),
        relatedEntityNames: [...relatedEntityNames].sort(),
        coreCount: group.filter((obs) => obs.valueCategory === 'core').length,
        activeCount: group.filter((obs) => (obs.status ?? 'active') === 'active').length,
      };
    })
    .sort((a, b) => b.observationIds.length - a.observationIds.length || a.name.localeCompare(b.name));
}

function buildEdges(memories: Observation[], entityNames: Set<string>): GraphContextEdge[] {
  const edges: GraphContextEdge[] = [];
  const seen = new Set<string>();
  const addEdge = (from: string, to: string, type: GraphContextEdge['type']) => {
    if (!from || !to || from === to) return;
    const key = `${from}:${type}:${to}`;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push({ from, to, type });
  };

  for (const obs of memories) {
    for (const related of obs.relatedEntities ?? []) {
      if (entityNames.has(related)) {
        addEdge(obs.entityName, related, 'related_entity');
      }
    }
    for (const commit of obs.relatedCommits ?? []) {
      addEdge(obs.entityName, `commit:${commit.slice(0, 7)}`, 'cites_commit');
    }
  }
  return edges;
}

function freshnessForGraphEvidence(observation: Observation, referenceTime: Date): 'current' | 'stale' {
  if ((observation.status ?? 'active') !== 'active') return 'stale';
  const zone = getRetentionZone({
    id: `obs-${observation.id}`,
    observationId: observation.id,
    entityName: observation.entityName,
    type: observation.type,
    title: observation.title,
    narrative: observation.narrative,
    facts: observation.facts.join('\n'),
    filesModified: observation.filesModified.join('\n'),
    concepts: observation.concepts.join(', '),
    tokens: observation.tokens,
    createdAt: observation.createdAt,
    projectId: observation.projectId,
    accessCount: 0,
    lastAccessedAt: '',
    status: observation.status ?? 'active',
    source: observation.source ?? 'agent',
    sourceDetail: observation.sourceDetail ?? '',
    valueCategory: observation.valueCategory ?? '',
    admissionState: observation.admissionState ?? '',
    admissionReason: observation.admissionReason ?? '',
  }, referenceTime);
  return zone === 'active' ? 'current' : 'stale';
}

function directGraphEdges(seed: Observation, candidate: Observation): GraphContextEdge['type'][] {
  const types = new Set<GraphContextEdge['type']>();
  const seedRelated = new Set((seed.relatedEntities ?? []).map(normalizeText));
  const candidateRelated = new Set((candidate.relatedEntities ?? []).map(normalizeText));
  if (seedRelated.has(normalizeText(candidate.entityName)) || candidateRelated.has(normalizeText(seed.entityName))) {
    types.add('related_entity');
  }
  const seedCommits = new Set((seed.relatedCommits ?? []).map(value => value.slice(0, 7)));
  if ((candidate.relatedCommits ?? []).some(value => seedCommits.has(value.slice(0, 7)))) types.add('cites_commit');
  return [...types];
}

function graphEvidenceCandidates(
  observations: Observation[],
  seeds: Observation[],
  referenceTime: Date,
  limit: number,
  tokenBudget: number,
): { evidence: GraphContextEvidence[]; governance: GovernancePlan; selected: Observation[] } {
  const seedIds = new Set(seeds.map(item => item.id));
  const candidates = observations
    .filter(observation => !seedIds.has(observation.id))
    .map(observation => {
      const relatedSeeds = seeds
        .map(seed => ({ seed, edges: directGraphEdges(seed, observation) }))
        .filter(item => item.edges.length > 0);
      if (relatedSeeds.length === 0) return undefined;
      const confidence = Math.min(1, 0.35 + relatedSeeds.length * 0.2 + evidenceScore(observation) * 0.07);
      return {
        observation,
        sourceIds: relatedSeeds.map(item => item.seed.id).sort((a, b) => a - b),
        edgeTypes: [...new Set(relatedSeeds.flatMap(item => item.edges))],
        confidence,
      };
    })
    .filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== undefined)
    .sort((left, right) => right.confidence - left.confidence || right.observation.id - left.observation.id)
    .slice(0, Math.max(0, limit));
  const governance = governContextCandidates(candidates.map(candidate => ({
    kind: 'graph-evidence' as const,
    id: `observation:${candidate.observation.id}`,
    estimatedTokens: Math.max(8, countTextTokens(`${candidate.observation.title} ${candidate.observation.narrative}`)),
    relevance: candidate.confidence,
    scopeAllowed: true,
    freshness: freshnessForGraphEvidence(candidate.observation, referenceTime),
    trust: candidate.observation.source === 'manual' || candidate.observation.source === 'git' ? 'source-backed' as const : 'historical' as const,
    quality: candidate.observation.valueCategory === 'core' ? 'verified' as const : 'probationary' as const,
    conflict: 'none' as const,
    evidenceCount: candidate.sourceIds.length,
  })), tokenBudget);
  const decisionById = new Map(governance.decisions.map(decision => [decision.candidate.id, decision]));
  const admitted = candidates.flatMap(candidate => {
    const decision = decisionById.get(`observation:${candidate.observation.id}`);
    if (!decision || (decision.disposition !== 'include' && decision.disposition !== 'compact')) return [];
    return [{
      id: candidate.observation.id,
      title: candidate.observation.title,
      entityName: candidate.observation.entityName,
      sourceObservationIds: candidate.sourceIds,
      edgeTypes: candidate.edgeTypes,
      confidence: candidate.confidence,
      disposition: decision.disposition,
      reasons: decision.reasons,
      observation: candidate.observation,
    }];
  });
  return {
    evidence: admitted.map(({ observation: _observation, ...evidence }) => evidence),
    governance,
    selected: admitted.map(item => item.observation),
  };
}

function buildRisks(
  observations: Observation[],
  audit: MemoryQualityAuditReport,
  selectedEntityNames: Set<string>,
): GraphContextRisk[] {
  const riskIds = new Set<number>();
  for (const entry of audit.issues.hookNoise) riskIds.add(entry.id);
  for (const entry of audit.issues.orphans) riskIds.add(entry.id);
  for (const entry of audit.issues.retentionCandidates) riskIds.add(entry.id);

  return observations
    .filter((obs) => riskIds.has(obs.id))
    .filter((obs) =>
      selectedEntityNames.has(obs.entityName) ||
      (obs.relatedEntities ?? []).some((entity) => selectedEntityNames.has(entity)),
    )
    .map((obs) => ({
      id: obs.id,
      title: obs.title,
      reason:
        audit.issues.hookNoise.some((entry) => entry.id === obs.id) ? 'hook noise' :
        audit.issues.orphans.some((entry) => entry.id === obs.id) ? 'weakly connected' :
        'retention candidate',
    }));
}

export function buildGraphContextPacket(
  observations: Observation[],
  options: GraphContextPacketOptions,
): GraphContextPacket {
  const referenceTime = options.referenceTime ?? new Date();
  const audit = auditMemoryQuality(observations, {
    projectId: options.projectId,
    referenceTime,
  });
  const riskIds = new Set([
    ...audit.issues.hookNoise.map((entry) => entry.id),
    ...audit.issues.retentionCandidates.map((entry) => entry.id),
  ]);
  const deliveryEligible = observations.filter(
    (obs) => obs.projectId === options.projectId && isEligibleForAutomaticDelivery(obs),
  );
  // A node with only an incoming relation is an orphan in the raw audit, but
  // can become valid one-hop evidence after graph expansion. Do not discard it
  // before the relation and evidence-governor checks run.
  const filteredObservations = deliveryEligible.filter((obs) => !riskIds.has(obs.id));
  const baseObservations = filteredObservations.length > 0 ? filteredObservations : deliveryEligible;
  const memories = pickMemories(baseObservations, options.projectId, options.query, options.limit ?? 5, referenceTime);
  const graph = graphEvidenceCandidates(
    baseObservations,
    memories,
    referenceTime,
    options.graphEvidenceLimit ?? 3,
    options.graphEvidenceTokenBudget ?? 48,
  );
  const allMemories = [...memories, ...graph.selected];
  const entities = buildEntities(allMemories);
  const entityNames = new Set(entities.map((entity) => entity.name));
  const edges = buildEdges(allMemories, entityNames);
  const risks = buildRisks(
    observations.filter((obs) => obs.projectId === options.projectId),
    audit,
    entityNames,
  );

  const summary = [
    `${allMemories.length} high-signal memories`,
    `${entities.length} entity cluster(s)`,
    `${edges.length} relation(s)`,
    `${graph.evidence.length} admitted graph evidence`,
    `${risks.length} risk signal(s)`,
  ].join(' · ');

  return {
    projectId: options.projectId,
    query: options.query,
    summary,
    entities,
    edges,
    memories: allMemories.map((obs) => ({
      id: obs.id,
      title: obs.title,
      type: obs.type,
      entityName: obs.entityName,
      valueCategory: obs.valueCategory,
      status: obs.status ?? 'active',
      reason:
        graph.evidence.some(evidence => evidence.id === obs.id) ? 'graph evidence' :
        obs.valueCategory === 'core' ? 'core memory' :
        obs.sourceDetail === 'hook' ? 'routing signal' :
        'context memory',
    })),
    evidence: graph.evidence,
    risks,
    audit,
    governance: graph.governance,
  };
}
