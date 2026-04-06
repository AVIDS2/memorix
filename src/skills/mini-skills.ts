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

import type { MiniSkill, Observation } from '../types.js';
import { getMiniSkillStore } from '../store/mini-skill-store.js';

// ── Promote observations to mini-skills ──────────────────────────

export interface PromoteOptions {
  /** Override auto-generated trigger description */
  trigger?: string;
  /** Override auto-generated instruction */
  instruction?: string;
  /** Extra tags */
  tags?: string[];
}

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
    createdAt: new Date().toISOString(),
    usedCount: 0,
    tags: [...new Set(tags)],
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
