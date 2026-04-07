/**
 * Compact Engine
 *
 * Orchestrates the 3-layer Progressive Disclosure workflow.
 * Source: claude-mem's proven architecture (27K stars, ~10x token savings).
 *
 * Layer 1 (search)   → Compact index with IDs (~50-100 tokens/result)
 * Layer 2 (timeline) → Chronological context around an observation
 * Layer 3 (detail)   → Full observation content (~500-1000 tokens/result)
 */

import type { SearchOptions, IndexEntry, TimelineContext, MemorixDocument, ObservationRef, MemoryRef, MiniSkill, SourceSnapshot } from '../types.js';
import { searchObservations, getTimeline, getObservationsByIds, makeOramaObservationId } from '../store/orama-store.js';
import { getObservation, getAllObservations, withFreshObservations } from '../memory/observations.js';
import { formatIndexTable, formatTimeline, formatObservationDetail } from './index-format.js';
import { countTextTokens } from './token-budget.js';
import { resolveAliases } from '../project/aliases.js';
import { parseMemoryRef } from '../memory/refs.js';
import { getMiniSkillStore } from '../store/mini-skill-store.js';
import { miniSkillToDocument, resolveProvenanceStatus, type ProvenanceStatus } from '../skills/mini-skills.js';
import { redactCredentials } from '../memory/secret-filter.js';

/**
 * Layer 1: Search and return a compact index.
 * Agent scans this to decide which observations to fetch in detail.
 */
export async function compactSearch(options: SearchOptions): Promise<{
  entries: IndexEntry[];
  formatted: string;
  totalTokens: number;
}> {
  const entries = await searchObservations(options);
  const formatted = formatIndexTable(entries, options.query, !options.projectId);
  const totalTokens = countTextTokens(formatted);

  return { entries, formatted, totalTokens };
}

/**
 * Layer 2: Get timeline context around an anchor observation.
 * Shows what happened before and after for temporal understanding.
 */
export async function compactTimeline(
  anchorId: number,
  projectId?: string,
  depthBefore = 3,
  depthAfter = 3,
): Promise<{
  timeline: TimelineContext;
  formatted: string;
  totalTokens: number;
}> {
  const result = await getTimeline(anchorId, projectId, depthBefore, depthAfter);

  const timeline: TimelineContext = {
    anchorId,
    anchorEntry: result.anchor,
    before: result.before,
    after: result.after,
  };

  const formatted = formatTimeline(timeline);
  const totalTokens = countTextTokens(formatted);

  return { timeline, formatted, totalTokens };
}

/**
 * Layer 3: Get full observation or mini-skill details by IDs or typed refs.
 * Only called after the agent has filtered via L1/L2.
 *
 * Phase 3a: Accepts typed MemoryRef inputs (obs:42, skill:3) alongside
 * legacy bare numbers and ObservationRef objects.
 */
export async function compactDetail(
  idsOrRefs: number[] | ObservationRef[] | string[],
): Promise<{
  documents: MemorixDocument[];
  formatted: string;
  totalTokens: number;
}> {
  // Parse all inputs into typed MemoryRefs
  const parsedRefs: MemoryRef[] = (idsOrRefs as any[]).map((item) => {
    if (typeof item === 'number') return { kind: 'obs' as const, id: item };
    if (typeof item === 'string') {
      try { return parseMemoryRef(item); } catch { return { kind: 'obs' as const, id: parseInt(item, 10) || 0 }; }
    }
    // ObservationRef object
    if (item && typeof item === 'object' && 'id' in item) {
      return { kind: 'obs' as const, id: item.id, projectId: item.projectId };
    }
    return { kind: 'obs' as const, id: 0 };
  });

  // Separate observation refs from skill refs
  const obsRefs = parsedRefs.filter((r) => r.kind === 'obs');
  const skillRefs = parsedRefs.filter((r) => r.kind === 'skill');

  // --- Resolve mini-skill refs ---
  const skillDocuments: MemorixDocument[] = [];
  const skillFormattedParts: string[] = [];
  if (skillRefs.length > 0) {
    try {
      const store = getMiniSkillStore();
      const allSkills = await store.loadAll();
      const skillMap = new Map(allSkills.map((s) => [s.id, s]));
      for (const ref of skillRefs) {
        const skill = skillMap.get(ref.id);
        if (skill) {
          const doc = miniSkillToDocument(skill);
          skillDocuments.push(doc);
          const obsLookup = (id: number) => getObservation(id);
          const status = resolveProvenanceStatus(skill, obsLookup);
          skillFormattedParts.push(formatMiniSkillDetail(skill, status));
        } else {
          skillFormattedParts.push(`Mini-skill S${ref.id} not found.`);
        }
      }
    } catch {
      for (const ref of skillRefs) {
        skillFormattedParts.push(`Mini-skill S${ref.id}: store unavailable.`);
      }
    }
  }

  // --- Resolve observation refs (existing path) ---
  const refs: ObservationRef[] = obsRefs.map((r) => ({ id: r.id, projectId: r.projectId }));

  // Prefer in-memory observations for current-project reliability, but fall back
  // to the global Orama index so cross-project search results can still open.
  // Security: refs WITHOUT projectId are treated as ambiguous — the in-memory
  // lookup may return a wrong-project observation. Callers (memorix_detail tool)
  // should always inject projectId for bare numeric IDs.
  await withFreshObservations(() => getAllObservations()); // freshness gate before observation reads
  const toRefKey = (ref: ObservationRef) => `${ref.projectId ?? ''}::${ref.id}`;
  const documentMap = new Map<string, MemorixDocument>();
  const missingRefs: ObservationRef[] = [];
  for (const ref of refs) {
    const obs = getObservation(ref.id, ref.projectId);
    if (obs && (ref.projectId ? obs.projectId === ref.projectId : true)) {
      documentMap.set(toRefKey(ref), {
        id: makeOramaObservationId(obs.projectId, obs.id),
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
      });
    } else {
      missingRefs.push(ref);
    }
  }

  if (missingRefs.length > 0) {
    for (const ref of missingRefs) {
      const fallbackDocs = await getObservationsByIds([ref.id], ref.projectId);
      const doc = fallbackDocs[0];
      if (doc) {
        documentMap.set(toRefKey(ref), doc);
      }
    }
  }

  const documents = refs
    .map((ref) => documentMap.get(toRefKey(ref)))
    .filter((doc): doc is MemorixDocument => Boolean(doc));

  // Build cross-reference map for all requested observations
  const allObs = getAllObservations();
  const crossRefMap = new Map<string, string[]>();
  for (const ref of refs) {
    const obs = getObservation(ref.id, ref.projectId);
    const doc = documentMap.get(toRefKey(ref));
    if (!obs && !doc) continue;
    const refs: string[] = [];
    const projectIds = obs
      ? new Set(await resolveAliases(obs.projectId).catch(() => [obs.projectId]))
      : new Set<string>(doc?.projectId ? [doc.projectId] : []);

    // Repository / source line
    if (obs?.source === 'git' && obs.commitHash) {
      refs.push(`Repository: commit ${obs.commitHash.substring(0, 7)}`);
    } else if (obs?.source && obs.source !== 'agent') {
      refs.push(`Source: ${obs.source}`);
    } else if (doc?.source && doc.source !== 'agent') {
      refs.push(`Source: ${doc.source}`);
    }

    if (!obs) {
      if (refs.length > 0 && doc) crossRefMap.set(doc.id, refs);
      continue;
    }

    // Cited commits (explicit relatedCommits cross-references)
    if (obs.relatedCommits && obs.relatedCommits.length > 0) {
      refs.push(`Cited commits: ${obs.relatedCommits.map(h => h.substring(0, 7)).join(', ')}`);
      // Auto-find git memories for those commits
      const gitMems = allObs.filter(o =>
        o.source === 'git' &&
        projectIds.has(o.projectId) &&
        o.commitHash &&
        obs.relatedCommits!.includes(o.commitHash),
      );
      for (const gm of gitMems) {
        refs.push(`  → #${gm.id} 🟢 ${gm.title}`);
      }
    }

    // Explicit relatedEntities
    if (obs.relatedEntities && obs.relatedEntities.length > 0) {
      refs.push(`Related entities: ${obs.relatedEntities.join(', ')}`);
    }

    // Auto: if this is a git memory, find analysis (reasoning/decision) for same entity
    if (obs.source === 'git') {
      const analysis = allObs.filter(o =>
        (o.type === 'reasoning' || o.type === 'decision') &&
        projectIds.has(o.projectId) &&
        o.entityName === obs.entityName && o.id !== obs.id && o.status !== 'archived',
      ).slice(0, 3);
      if (analysis.length > 0) {
        refs.push('Analysis:');
        for (const r of analysis) {
          refs.push(`  → #${r.id} ${r.type === 'reasoning' ? '🧠' : '🟤'} ${r.title}`);
        }
      }
    }

    // Auto: if this is a reasoning/decision memory, find git evidence for same entity
    if (obs.type === 'reasoning' || obs.type === 'decision') {
      const gitMems = allObs.filter(o =>
        o.source === 'git' &&
        projectIds.has(o.projectId) &&
        o.entityName === obs.entityName &&
        o.id !== obs.id &&
        o.status !== 'archived',
      ).slice(0, 3);
      if (gitMems.length > 0) {
        refs.push('Repository evidence:');
        for (const g of gitMems) {
          refs.push(`  → #${g.id} 🟢 ${g.title}`);
        }
      }
    }

    if (refs.length > 0) crossRefMap.set(makeOramaObservationId(obs.projectId, obs.id), refs);
  }

  const obsFormattedParts = documents.map((doc: MemorixDocument) => {
    // Re-use in-memory observation to forward commitHash/relatedCommits for
    // evidence basis display — these fields are not in MemorixDocument.
    const obs = getObservation(doc.observationId, doc.projectId);
    let detail = formatObservationDetail({
      ...doc,
      commitHash: obs?.commitHash,
      relatedCommits: obs?.relatedCommits,
    });
    const refs = crossRefMap.get(doc.id);
    if (refs && refs.length > 0) {
      detail += '\n\nEvidence support:\n' + refs.join('\n');
    }
    return detail;
  });

  // Merge observation and skill formatted parts in original request order
  const allFormattedParts = [...obsFormattedParts, ...skillFormattedParts];
  const allDocuments = [...documents, ...skillDocuments];

  const formatted = allFormattedParts.join('\n\n' + '═'.repeat(50) + '\n\n');
  const totalTokens = countTextTokens(formatted);

  return { documents: allDocuments, formatted, totalTokens };
}

/**
 * Format a mini-skill detail view with provenance status.
 */
function formatMiniSkillDetail(skill: MiniSkill, provenanceStatus: ProvenanceStatus): string {
  const lines: string[] = [];

  lines.push(`S${skill.id} ★ ${skill.title}`);
  lines.push('='.repeat(50));
  lines.push(`Type: promoted knowledge (mini-skill)`);
  lines.push(`Entity: ${skill.sourceEntity}`);
  lines.push(`Project: ${skill.projectId}`);
  lines.push(`Created: ${new Date(skill.createdAt).toLocaleString()}`);
  lines.push(`Used: ${skill.usedCount} time(s)`);
  lines.push(`Provenance: ${provenanceStatus}`);
  lines.push('');
  lines.push(`Instruction: ${redactCredentials(skill.instruction)}`);
  lines.push(`Trigger: ${skill.trigger}`);

  if (skill.facts.length > 0) {
    lines.push('');
    lines.push('Facts:');
    for (const fact of skill.facts) {
      lines.push(`- ${redactCredentials(fact)}`);
    }
  }

  if (skill.tags.length > 0) {
    lines.push('');
    lines.push(`Tags: ${skill.tags.join(', ')}`);
  }

  // Show source observation IDs with status
  if (skill.sourceObservationIds.length > 0) {
    lines.push('');
    lines.push(`Source observations: ${skill.sourceObservationIds.map(id => `#${id}`).join(', ')}`);
  }

  // Show snapshot summary if available
  if (skill.sourceSnapshot) {
    try {
      const snapshot: SourceSnapshot = JSON.parse(skill.sourceSnapshot);
      if (snapshot.observations && snapshot.observations.length > 0) {
        lines.push(`Snapshot: ${snapshot.observations.length} observation(s), frozen at ${new Date(snapshot.promotedAt).toLocaleString()}`);
      }
    } catch { /* malformed snapshot — skip */ }
  }

  return lines.join('\n');
}
