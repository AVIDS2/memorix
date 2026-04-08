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
import { getObservation, getAllObservations } from '../memory/observations.js';
import { ensureFreshIndex } from '../memory/freshness.js';
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
  // Parse all inputs into typed MemoryRefs — fail-fast on invalid refs
  const invalidRefs: string[] = [];
  const parsedRefs: MemoryRef[] = [];
  for (let i = 0; i < (idsOrRefs as any[]).length; i++) {
    const item = (idsOrRefs as any[])[i];
    if (typeof item === 'number') {
      parsedRefs.push({ kind: 'obs' as const, id: item });
    } else if (typeof item === 'string') {
      try { parsedRefs.push(parseMemoryRef(item)); } catch { invalidRefs.push(item); }
    } else if (item && typeof item === 'object' && 'id' in item && typeof item.id === 'number') {
      parsedRefs.push({ kind: 'obs' as const, id: item.id, projectId: item.projectId });
    } else {
      invalidRefs.push(String(item));
    }
  }
  if (invalidRefs.length > 0) {
    throw new Error(
      `Invalid memory ref(s): ${invalidRefs.map(r => `"${r}"`).join(', ')}. ` +
      `Expected: obs:<id>, skill:<id>, obs:<id>@<projectId>, or a bare number.`,
    );
  }

  // Tag each ref with its original position so we can reassemble in order
  const obsRefsIndexed = parsedRefs
    .map((r, i) => ({ ref: r, idx: i }))
    .filter((x) => x.ref.kind === 'obs');
  const skillRefsIndexed = parsedRefs
    .map((r, i) => ({ ref: r, idx: i }))
    .filter((x) => x.ref.kind === 'skill');

  // Per-slot results — keyed by original parsedRefs index
  const slotDoc = new Map<number, MemorixDocument>();
  const slotFormatted = new Map<number, string>();

  // --- Resolve mini-skill refs ---
  if (skillRefsIndexed.length > 0) {
    try {
      const store = getMiniSkillStore();
      const allSkills = await store.loadAll();
      const skillMap = new Map(allSkills.map((s) => [s.id, s]));
      for (const { ref, idx } of skillRefsIndexed) {
        const skill = skillMap.get(ref.id);
        if (skill) {
          slotDoc.set(idx, miniSkillToDocument(skill));
          const obsLookup = (id: number) => getObservation(id);
          const status = resolveProvenanceStatus(skill, obsLookup);
          slotFormatted.set(idx, formatMiniSkillDetail(skill, status));
        } else {
          slotFormatted.set(idx, `Mini-skill S${ref.id} not found.`);
        }
      }
    } catch {
      for (const { ref, idx } of skillRefsIndexed) {
        slotFormatted.set(idx, `Mini-skill S${ref.id}: store unavailable.`);
      }
    }
  }

  // --- Resolve observation refs (existing path) ---
  const refs: ObservationRef[] = obsRefsIndexed.map((x) => ({ id: x.ref.id, projectId: x.ref.projectId }));

  // Prefer in-memory observations for current-project reliability, but fall back
  // to the global Orama index so cross-project search results can still open.
  // Security: refs WITHOUT projectId are treated as ambiguous — the in-memory
  // lookup may return a wrong-project observation. Callers (memorix_detail tool)
  // should always inject projectId for bare numeric IDs.
  await ensureFreshIndex(); // unified freshness gate: observations + mini-skills
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

  // Store observation results into slots by original index
  for (let i = 0; i < obsRefsIndexed.length; i++) {
    const { idx } = obsRefsIndexed[i];
    const ref = refs[i];
    const doc = documentMap.get(toRefKey(ref));
    if (doc) {
      slotDoc.set(idx, doc);
      const obs = getObservation(doc.observationId, doc.projectId);
      let detail = formatObservationDetail({
        ...doc,
        commitHash: obs?.commitHash,
        relatedCommits: obs?.relatedCommits,
      });
      const xrefs = crossRefMap.get(doc.id);
      if (xrefs && xrefs.length > 0) {
        detail += '\n\nEvidence support:\n' + xrefs.join('\n');
      }
      slotFormatted.set(idx, detail);
    }
  }

  // Reassemble in original parsedRefs order
  const allDocuments: MemorixDocument[] = [];
  const allFormattedParts: string[] = [];
  for (let i = 0; i < parsedRefs.length; i++) {
    const doc = slotDoc.get(i);
    const fmt = slotFormatted.get(i);
    if (doc) allDocuments.push(doc);
    if (fmt) allFormattedParts.push(fmt);
  }

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
