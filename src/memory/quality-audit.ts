import type { Observation } from '../types.js';
import { getRetentionZone } from './retention.js';

const COMMAND_LOG_TITLE = /^(Ran:|Command:|Executed:)\s/i;
const HOOK_NOISE_TITLE = /^(Thinking|Brewing|Distilled|Settled|Cooked|Sautéed|Whirring|Simmering|Puttering)\b/i;

export interface MemoryQualityAuditOptions {
  projectId: string;
  referenceTime?: Date;
}

export interface AuditDuplicateCluster {
  entityName: string;
  type: string;
  ids: number[];
  titles: string[];
}

export interface AuditEntry {
  id: number;
  title: string;
  entityName: string;
  type: string;
  reason: string;
}

export interface MemoryQualityAuditReport {
  projectId: string;
  summary: {
    total: number;
    active: number;
    archived: number;
    core: number;
    contextual: number;
    ephemeral: number;
  };
  issues: {
    duplicateClusters: AuditDuplicateCluster[];
    lowEvidence: AuditEntry[];
    hookNoise: AuditEntry[];
    orphans: AuditEntry[];
    retentionCandidates: AuditEntry[];
  };
  recommendations: string[];
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function evidenceScore(obs: Observation): number {
  let score = 0;
  score += obs.narrative.trim().length > 0 ? 1 : 0;
  score += obs.facts.filter((fact) => fact.trim().length > 0).length > 0 ? 1 : 0;
  score += obs.filesModified.filter((file) => file.trim().length > 0).length > 0 ? 1 : 0;
  score += obs.concepts.filter((concept) => concept.trim().length > 0).length > 0 ? 1 : 0;
  score += obs.entityName && obs.entityName !== 'quick-note' && obs.entityName !== 'general' && obs.entityName !== 'unknown' ? 1 : 0;
  return score;
}

function isHookNoise(obs: Observation): boolean {
  return obs.sourceDetail === 'hook' || HOOK_NOISE_TITLE.test(obs.title);
}

function isCommandLog(obs: Observation): boolean {
  return COMMAND_LOG_TITLE.test(obs.title);
}

function isOrphan(obs: Observation): boolean {
  return evidenceScore(obs) <= 2;
}

function makeEntry(obs: Observation, reason: string): AuditEntry {
  return {
    id: obs.id,
    title: obs.title,
    entityName: obs.entityName,
    type: obs.type,
    reason,
  };
}

export function auditMemoryQuality(
  observations: Observation[],
  options: MemoryQualityAuditOptions,
): MemoryQualityAuditReport {
  const scoped = observations.filter((obs) => obs.projectId === options.projectId);
  const active = scoped.filter((obs) => (obs.status ?? 'active') === 'active');
  const archived = scoped.filter((obs) => (obs.status ?? 'active') === 'archived');

  const duplicateMap = new Map<string, Observation[]>();
  for (const obs of active) {
    const key = `${obs.entityName}::${obs.type}::${normalizeText(obs.title)}::${normalizeText(obs.narrative)}`;
    const list = duplicateMap.get(key) ?? [];
    list.push(obs);
    duplicateMap.set(key, list);
  }

  const duplicateClusters = [...duplicateMap.values()]
    .filter((group) => group.length > 1)
    .map((group) => ({
      entityName: group[0].entityName,
      type: group[0].type,
      ids: group.map((obs) => obs.id).sort((a, b) => a - b),
      titles: group.map((obs) => obs.title),
    }));

  const lowEvidence = active
    .filter((obs) => evidenceScore(obs) <= 2)
    .map((obs) => makeEntry(obs, `Low evidence score (${evidenceScore(obs)}/5)`));

  const hookNoise = active
    .filter((obs) => isHookNoise(obs) || isCommandLog(obs))
    .map((obs) => makeEntry(obs, isCommandLog(obs) ? 'Command log noise' : 'Hook-generated noise'));

  const orphans = active
    .filter((obs) => isOrphan(obs))
    .map((obs) => makeEntry(obs, 'Weakly connected or isolated memory'));

  const retentionCandidates = active
    .filter((obs) => getRetentionZone({
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
    }, options.referenceTime) !== 'active')
    .map((obs) => makeEntry(obs, 'Outside active retention zone'));

  const summary = {
    total: scoped.length,
    active: active.length,
    archived: archived.length,
    core: scoped.filter((obs) => obs.valueCategory === 'core').length,
    contextual: scoped.filter((obs) => (obs.valueCategory ?? 'contextual') === 'contextual').length,
    ephemeral: scoped.filter((obs) => obs.valueCategory === 'ephemeral').length,
  };

  const recommendations: string[] = [];
  if (duplicateClusters.length > 0) {
    recommendations.push(`Review ${duplicateClusters.length} duplicate cluster(s) with \`memorix memory consolidate --action preview\`.`);
  }
  if (hookNoise.length > 0) {
    recommendations.push('Consider filtering or down-ranking hook-generated memories before they reach long-term search.');
  }
  if (orphans.length > 0) {
    recommendations.push('Promote or attach isolated memories only if they have clear evidence value.');
  }
  if (retentionCandidates.length > 0) {
    recommendations.push('Run \`memorix retention stale\` or \`memorix retention archive\` to inspect aged memories.');
  }
  if (recommendations.length === 0) {
    recommendations.push('Memory quality looks healthy for this project slice.');
  }

  return {
    projectId: options.projectId,
    summary,
    issues: {
      duplicateClusters,
      lowEvidence,
      hookNoise,
      orphans,
      retentionCandidates,
    },
    recommendations,
  };
}
