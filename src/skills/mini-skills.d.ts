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
import type { MiniSkill, Observation, KnowledgeLayer, DocumentType, MemorixDocument } from '../types.js';
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
export type ProvenanceStatus = 'verified' | 'partial' | 'snapshot-only' | 'legacy';
/**
 * Promote one or more observations into a mini-skill.
 * The source observations are NOT deleted — they remain in the observation store
 * but the mini-skill is the permanent, never-decaying version.
 */
export declare function promoteToMiniSkill(projectDir: string, projectId: string, observations: Observation[], options?: PromoteOptions): Promise<MiniSkill>;
/**
 * Load all mini-skills for a project.
 */
export declare function loadMiniSkills(projectDir: string, projectId?: string): Promise<MiniSkill[]>;
/**
 * Load all mini-skills (unfiltered).
 */
export declare function loadAllMiniSkills(projectDir: string): Promise<MiniSkill[]>;
/**
 * Delete a mini-skill by ID.
 */
export declare function deleteMiniSkill(projectDir: string, skillId: number): Promise<boolean>;
/**
 * Increment usedCount for skills that were injected in session_start.
 */
export declare function recordMiniSkillUsage(projectDir: string, skillIds: number[]): Promise<void>;
/**
 * Format mini-skills for injection into session_start context.
 * Returns a markdown string ready to append to session context.
 */
export declare function formatMiniSkillsForInjection(skills: MiniSkill[]): string;
/**
 * Resolve the provenance status of a mini-skill by checking whether its
 * source observations still exist.
 *
 * @param skill The mini-skill to check
 * @param getObservationById Lookup function: (id) => Observation | undefined
 */
export declare function resolveProvenanceStatus(skill: MiniSkill, getObservationById: (id: number) => {
    id: number;
    status?: string;
} | undefined): ProvenanceStatus;
/**
 * Resolve the knowledge layer for a document based on its type and source.
 * This is computed at index time — NOT stored in SQLite.
 */
export declare function resolveKnowledgeLayer(documentType: DocumentType, sourceDetail?: string, source?: string): KnowledgeLayer;
/**
 * Convert a MiniSkill into a MemorixDocument for Orama indexing.
 * The document carries documentType='mini-skill' and knowledgeLayer='promoted'.
 */
export declare function miniSkillToDocument(skill: MiniSkill): MemorixDocument;
//# sourceMappingURL=mini-skills.d.ts.map