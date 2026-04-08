/**
 * Mini-Skills Engine — Promoted memories that never decay
 *
 * Converts important observations into permanent, actionable "mini-skills"
 * that are automatically injected into agent context during session_start.
 *
 * Unlike generic SKILL.md files from marketplaces, mini-skills are:
 *   - Derived from YOUR project's actual memories (gotchas, decisions, fixes)
 *   - Immune from retention decay (permanent knowledge)
 *   - Auto-injected at session start (agents proactively apply them)
 *   - Cross-IDE shared (stored in ~/.memorix/data/ alongside observations)
 *
 * Lifecycle: observation → memorix_promote → mini-skill → session_start injection
 */

import type { MiniSkill, Observation, SourceSnapshot, SnapshotObservation, KnowledgeLayer, DocumentType, MemorixDocument } from '../types.js';
import { getMiniSkillStore } from '../store/mini-skill-store.js';
import { countTextTokens } from '../compact/token-budget.js';

// Hard filter: command execution logs are not promotable knowledge
const COMMAND_LOG_TITLE = /^(Ran:|Command:|Executed:)\s/i;

// ── Promote observations to mini-skills ──────────────────────────

export interface PromoteOptions {
  /** Override auto-generated trigger description */
  trigger?: string;
  /** Override auto-generated instruction */
  instruction?: string;
  /** Extra tags */
  tags?: string[];
  /** Bypass R2 (no command logs) and R3 (has content) validation. Cannot bypass R1 (sources must exist). */
  force?: boolean;
}

/** Provenance status of a mini-skill relative to its source observations */
export type ProvenanceStatus =
  | 'verified'          // all source observations exist and are active
  | 'partial'           // some source observations exist
  | 'snapshot-only'     // no sources available, but snapshot exists
  | 'legacy';           // no snapshot AND no sources (unverifiable)

/**
 * Promote one or more observations into a mini-skill.
 * The source observations are NOT deleted — they remain in the observation store
 * but the mini-skill is the permanent, never-decaying version.
 */
export async function promoteToMiniSkill(
  projectDir: string,
  projectId: string,
  observations: Observation[],
  options?: PromoteOptions,
): Promise<MiniSkill> {
  // ── Promote-time validation ────────────────────────────────────
  // R1a: Sources must exist (cannot be bypassed)
  if (observations.length === 0) {
    throw new Error('Cannot promote: no source observations provided');
  }

  // R1b: All sources must be active — stale/archived knowledge must never be
  // permanently promoted. This check is NOT bypassable by force=true.
  const nonActive = observations.filter(o => (o.status ?? 'active') !== 'active');
  if (nonActive.length > 0) {
    throw new Error(
      `Cannot promote: ${nonActive.length} observation(s) are not active. ` +
      `Blocked: ${nonActive.map(o => `#${o.id} (${o.status ?? 'unknown'})`).join(', ')}. ` +
      `Only active observations can be promoted to permanent knowledge.`,
    );
  }

  if (!options?.force) {
    // R2: No command-log noise
    const commandLogs = observations.filter(o => COMMAND_LOG_TITLE.test(o.title));
    if (commandLogs.length > 0) {
      throw new Error(
        `Cannot promote command execution logs — use a knowledge observation instead. ` +
        `Blocked: ${commandLogs.map(o => `#${o.id} "${o.title.substring(0, 60)}"`).join(', ')}. ` +
        `Use force=true to override.`,
      );
    }

    // R3: Has substantive content
    const hasContent = observations.some(
      o => (o.narrative && o.narrative.trim().length > 0) ||
           (o.facts && o.facts.length > 0 && o.facts.some(f => f.trim().length > 0)),
    );
    if (!hasContent) {
      throw new Error(
        'Cannot promote: source observations have no substantive content (empty narrative and facts). ' +
        'Use force=true to override.',
      );
    }
  }

  // ── Freeze source snapshot (immutable provenance proof) ────────
  const snapshot = createSourceSnapshot(observations);
  const snapshotJson = JSON.stringify(snapshot);

  const store = getMiniSkillStore();

  // Auto-generate content from observations
  const title = generateTitle(observations);
  const instruction = options?.instruction || generateInstruction(observations);
  const trigger = options?.trigger || generateTrigger(observations);
  const facts = extractFacts(observations);
  const tags = [
    ...(options?.tags || []),
    ...extractTags(observations),
  ];

  const now = new Date().toISOString();

  // Atomic: ID allocation + insert + counter bump in a single SQLite transaction.
  // Prevents concurrent promotes from receiving the same ID.
  const skill = await store.atomicInsertWithId({
    sourceObservationIds: observations.map(o => o.id),
    sourceEntity: observations[0]?.entityName || 'unknown',
    title,
    instruction,
    trigger,
    facts,
    projectId,
    createdAt: now,
    usedCount: 0,
    tags: [...new Set(tags)],
    sourceSnapshot: snapshotJson,
    updatedAt: now,
  });

  return skill;
}

// ── Load & query mini-skills ─────────────────────────────────────

/**
 * Load all mini-skills for a project.
 */
export async function loadMiniSkills(
  projectDir: string,
  projectId?: string,
): Promise<MiniSkill[]> {
  const store = getMiniSkillStore();
  if (!projectId) return store.loadAll();
  return store.loadByProject(projectId);
}

/**
 * Load all mini-skills (unfiltered).
 */
export async function loadAllMiniSkills(projectDir: string): Promise<MiniSkill[]> {
  return getMiniSkillStore().loadAll();
}

/**
 * Delete a mini-skill by ID.
 */
export async function deleteMiniSkill(
  projectDir: string,
  skillId: number,
): Promise<boolean> {
  const store = getMiniSkillStore();
  const all = await store.loadAll();
  const exists = all.some(s => s.id === skillId);
  if (!exists) return false;
  await store.remove(skillId);
  return true;
}

/**
 * Increment usedCount for skills that were injected in session_start.
 */
export async function recordMiniSkillUsage(
  projectDir: string,
  skillIds: number[],
): Promise<void> {
  if (skillIds.length === 0) return;
  const store = getMiniSkillStore();
  const existing = await store.loadAll();
  for (const skill of existing) {
    if (skillIds.includes(skill.id)) {
      skill.usedCount++;
      await store.update(skill);
    }
  }
}

// ── Format mini-skills for session injection ─────────────────────

/**
 * Format mini-skills for injection into session_start context.
 * Returns a markdown string ready to append to session context.
 */
export function formatMiniSkillsForInjection(skills: MiniSkill[]): string {
  if (skills.length === 0) return '';

  const lines = [
    `## 🎯 Project Mini-Skills (${skills.length} active)`,
    '',
  ];

  for (const skill of skills) {
    lines.push(`### ${skill.title}`);
    lines.push(`**Do**: ${skill.instruction}`);
    lines.push(`**When**: ${skill.trigger}`);
    if (skill.facts.length > 0) {
      for (const fact of skill.facts) {
        lines.push(`- ${fact}`);
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ── Auto-generation helpers ──────────────────────────────────────

function generateTitle(observations: Observation[]): string {
  if (observations.length === 1) {
    return observations[0].title;
  }
  // Multiple observations — use the first one's title as base
  return observations[0].title;
}

function generateInstruction(observations: Observation[]): string {
  // Convert narrative into imperative instruction
  const obs = observations[0];
  const narrative = obs.narrative || '';

  // For gotchas, flip to "avoid" instruction
  if (obs.type === 'gotcha') {
    return `Avoid: ${narrative.split('\n')[0]}`;
  }
  // For decisions, state the chosen approach
  if (obs.type === 'decision') {
    return `Follow: ${narrative.split('\n')[0]}`;
  }
  // For problem-solution, state the solution
  if (obs.type === 'problem-solution') {
    return `Apply fix: ${narrative.split('\n')[0]}`;
  }
  // Default: use narrative as-is
  return narrative.split('\n')[0] || obs.title;
}

function generateTrigger(observations: Observation[]): string {
  const obs = observations[0];

  // Use entity name + file paths as trigger context
  const parts: string[] = [];
  if (obs.entityName && obs.entityName !== 'unknown') {
    parts.push(`Working on ${obs.entityName}`);
  }
  if (obs.filesModified.length > 0) {
    parts.push(`touching ${obs.filesModified.slice(0, 3).join(', ')}`);
  }
  if (obs.concepts.length > 0) {
    parts.push(`involving ${obs.concepts.slice(0, 3).join(', ')}`);
  }

  return parts.length > 0 ? parts.join('; ') : `Related to ${obs.title}`;
}

function extractFacts(observations: Observation[]): string[] {
  const facts = new Set<string>();
  for (const obs of observations) {
    for (const f of obs.facts) {
      facts.add(f);
    }
  }
  return [...facts].slice(0, 10);
}

function extractTags(observations: Observation[]): string[] {
  const tags = new Set<string>();
  for (const obs of observations) {
    tags.add(obs.type);
    for (const c of obs.concepts) {
      if (c.length <= 30) tags.add(c.toLowerCase());
    }
  }
  return [...tags].slice(0, 10);
}

// ── Provenance helpers (Phase 3a) ────────────────────────────────

/**
 * Create an immutable source snapshot from observations at promote time.
 * Contains the minimum field set needed for self-contained provenance proof.
 */
function createSourceSnapshot(observations: Observation[]): SourceSnapshot {
  return {
    observations: observations.map((o): SnapshotObservation => ({
      id: o.id,
      title: o.title,
      type: o.type,
      narrative: o.narrative,
      facts: [...o.facts],
      entityName: o.entityName,
      projectId: o.projectId,
      createdAt: o.createdAt,
      sourceDetail: o.sourceDetail,
    })),
    promotedAt: new Date().toISOString(),
  };
}

/**
 * Resolve the provenance status of a mini-skill by checking whether its
 * source observations still exist.
 *
 * @param skill The mini-skill to check
 * @param getObservationById Lookup function: (id) => Observation | undefined
 */
export function resolveProvenanceStatus(
  skill: MiniSkill,
  getObservationById: (id: number) => { id: number; status?: string } | undefined,
): ProvenanceStatus {
  const ids = skill.sourceObservationIds;
  if (ids.length === 0) {
    return skill.sourceSnapshot ? 'snapshot-only' : 'legacy';
  }
  const found = ids.filter(id => {
    const obs = getObservationById(id);
    return obs && (obs.status ?? 'active') === 'active';
  });
  if (found.length === ids.length) return 'verified';
  if (found.length > 0) return 'partial';
  return skill.sourceSnapshot ? 'snapshot-only' : 'legacy';
}

// ── Knowledge Layer helpers (Phase 3a) ───────────────────────────

/**
 * Resolve the knowledge layer for a document based on its type and source.
 * This is computed at index time — NOT stored in SQLite.
 */
export function resolveKnowledgeLayer(
  documentType: DocumentType,
  sourceDetail?: string,
  source?: string,
): KnowledgeLayer {
  if (documentType === 'mini-skill') return 'promoted';
  if (sourceDetail === 'git-ingest' || source === 'git') return 'evidence';
  return 'project-truth';
}

/**
 * Convert a MiniSkill into a MemorixDocument for Orama indexing.
 * The document carries documentType='mini-skill' and knowledgeLayer='promoted'.
 */
export function miniSkillToDocument(skill: MiniSkill): MemorixDocument {
  const content = skill.instruction + '\n' + skill.facts.join('\n');
  return {
    id: `skill:${encodeURIComponent(skill.projectId)}:${skill.id}`,
    observationId: skill.id,
    entityName: skill.sourceEntity,
    type: 'mini-skill',
    title: skill.title,
    narrative: skill.instruction,
    facts: skill.facts.join('\n'),
    filesModified: '',
    concepts: skill.tags.join(', '),
    tokens: countTextTokens(content),
    createdAt: skill.createdAt,
    projectId: skill.projectId,
    accessCount: skill.usedCount,
    lastAccessedAt: '',
    status: 'active',
    source: 'agent',
    sourceDetail: 'explicit',
    valueCategory: 'core',
    documentType: 'mini-skill',
    knowledgeLayer: 'promoted',
  };
}
