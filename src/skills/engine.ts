/**
 * Skills Engine — Memory-Driven Project Skills
 *
 * Memorix's unique take on agent skills:
 *   - Discovers existing SKILL.md files across all 7 agents
 *   - Auto-generates project-specific skills from observation patterns
 *   - Injects skill content directly into agent context (no file reading needed)
 *
 * Unlike generic skill marketplaces, these skills are derived from YOUR
 * project's actual history—decisions, gotchas, patterns, and solutions
 * that make this project unique.
 *
 * SKILL.md format (industry standard):
 * ---
 * description: Short description for tool use
 * ---
 * # Skill Title
 * Markdown instructions...
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { AgentTarget, SkillEntry } from '../types.js';

// ============================================================
// Types
// ============================================================

/** A skill with full content (for inject/generate) */
export interface SkillFull extends SkillEntry {
    content: string;
    /** Whether this was auto-generated from observations */
    generated: boolean;
}

/** Observation data for skill generation */
interface ObsData {
    id: number;
    entityName: string;
    type: string;
    title: string;
    narrative: string;
    facts?: string[];
    concepts?: string[];
    filesModified?: string[];
    createdAt?: string;
}

/** Entity cluster for skill generation */
interface EntityCluster {
    entity: string;
    observations: ObsData[];
    /** Types present in cluster */
    types: Set<string>;
    /** Score: higher = more skill-worthy */
    score: number;
}

// ============================================================
// Skills Engine
// ============================================================

/** Skills directories per agent (same as workspace engine) */
const SKILLS_DIRS: Record<AgentTarget, string[]> = {
    codex: ['.codex/skills', '.agents/skills'],
    cursor: ['.cursor/skills', '.cursor/skills-cursor'],
    windsurf: ['.windsurf/skills'],
    'claude-code': ['.claude/skills'],
    copilot: ['.github/skills', '.copilot/skills'],
    antigravity: ['.agent/skills', '.gemini/skills', '.gemini/antigravity/skills'],
    kiro: ['.kiro/skills'],
    opencode: ['.opencode/skills'],
};

/** Types with high signal for skill generation */
const SKILL_WORTHY_TYPES = new Set([
    'gotcha', 'decision', 'how-it-works', 'problem-solution', 'trade-off',
]);

/** Minimum observations needed per entity to generate a skill */
const MIN_OBS_FOR_SKILL = 3;

/** Minimum score for skill generation */
const MIN_SCORE_FOR_SKILL = 5;

export class SkillsEngine {
    private skipGlobal: boolean;
    constructor(private projectRoot: string, options?: { skipGlobal?: boolean }) {
        this.skipGlobal = options?.skipGlobal ?? false;
    }

    // ============================================================
    // List: Discover all available skills
    // ============================================================

    /**
     * List all available skills from all agents + generated suggestions.
     */
    listSkills(): SkillFull[] {
        const skills: SkillFull[] = [];
        const seen = new Set<string>();
        const home = homedir();

        for (const [agent, dirs] of Object.entries(SKILLS_DIRS)) {
            for (const dir of dirs) {
                const paths = [join(this.projectRoot, dir)];
                if (!this.skipGlobal) {
                    paths.push(join(home, dir));
                }

                for (const skillsRoot of paths) {
                    if (!existsSync(skillsRoot)) continue;

                    try {
                        const entries = readdirSync(skillsRoot, { withFileTypes: true });
                        for (const entry of entries) {
                            if (!entry.isDirectory()) continue;
                            const name = entry.name;
                            if (seen.has(name)) continue;

                            const skillMd = join(skillsRoot, name, 'SKILL.md');
                            if (!existsSync(skillMd)) continue;

                            try {
                                const content = readFileSync(skillMd, 'utf-8');
                                const description = this.parseDescription(content);

                                skills.push({
                                    name,
                                    description,
                                    sourcePath: join(skillsRoot, name),
                                    sourceAgent: agent as AgentTarget,
                                    content,
                                    generated: false,
                                });
                                seen.add(name);
                            } catch { /* skip unreadable */ }
                        }
                    } catch { /* skip unreadable dirs */ }
                }
            }
        }

        return skills;
    }

    // ============================================================
    // Generate: Create skills from observation patterns
    // ============================================================

    /**
     * Analyze observations and generate SKILL.md content for entities with
     * rich knowledge accumulation.
     */
    generateFromObservations(observations: ObsData[]): SkillFull[] {
        // 1. Cluster observations by entity
        const clusters = this.clusterByEntity(observations);

        // 2. Score each cluster for skill-worthiness
        for (const cluster of clusters.values()) {
            cluster.score = this.scoreCluster(cluster);
        }

        // 3. Generate skills for top clusters
        const results: SkillFull[] = [];
        const sortedClusters = [...clusters.values()]
            .filter(c => c.score >= MIN_SCORE_FOR_SKILL)
            .sort((a, b) => b.score - a.score)
            .slice(0, 10); // Max 10 auto-generated skills

        for (const cluster of sortedClusters) {
            const skill = this.clusterToSkill(cluster);
            if (skill) results.push(skill);
        }

        return results;
    }

    /**
     * Write a generated skill to the target agent's skills directory.
     */
    writeSkill(skill: SkillFull, target: AgentTarget): string | null {
        const dirs = SKILLS_DIRS[target];
        if (!dirs || dirs.length === 0) return null;

        const targetDir = join(this.projectRoot, dirs[0], skill.name);

        try {
            mkdirSync(targetDir, { recursive: true });
            writeFileSync(join(targetDir, 'SKILL.md'), skill.content, 'utf-8');
            return join(dirs[0], skill.name, 'SKILL.md');
        } catch {
            return null;
        }
    }

    // ============================================================
    // Inject: Return skill content for direct agent consumption
    // ============================================================

    /**
     * Get full content of a skill by name (for direct injection).
     */
    injectSkill(name: string): SkillFull | null {
        const all = this.listSkills();
        return all.find(s => s.name.toLowerCase() === name.toLowerCase()) || null;
    }

    // ============================================================
    // Internal helpers
    // ============================================================

    private parseDescription(content: string): string {
        const match = content.match(/^---[\s\S]*?description:\s*["']?(.+?)["']?\s*$/m);
        return match ? match[1] : '';
    }

    private clusterByEntity(observations: ObsData[]): Map<string, EntityCluster> {
        const clusters = new Map<string, EntityCluster>();

        for (const obs of observations) {
            const entity = obs.entityName || 'unknown';
            let cluster = clusters.get(entity);
            if (!cluster) {
                cluster = { entity, observations: [], types: new Set(), score: 0 };
                clusters.set(entity, cluster);
            }
            cluster.observations.push(obs);
            cluster.types.add(obs.type);
        }

        return clusters;
    }

    private scoreCluster(cluster: EntityCluster): number {
        let score = 0;
        const obs = cluster.observations;

        // Base: need minimum observations
        if (obs.length < MIN_OBS_FOR_SKILL) return 0;

        // Must have at least one skill-worthy type (gotcha/decision/how-it-works/etc.)
        let hasSkillWorthyType = false;
        for (const type of cluster.types) {
            if (SKILL_WORTHY_TYPES.has(type)) {
                hasSkillWorthyType = true;
                break;
            }
        }
        if (!hasSkillWorthyType) return 0;

        // Volume bonus (1 point per obs, capped at 5)
        score += Math.min(obs.length, 5);

        // Type diversity bonus (3 points per unique skill-worthy type)
        for (const type of cluster.types) {
            if (SKILL_WORTHY_TYPES.has(type)) score += 3;
        }

        // Gotcha bonus (critical knowledge that MUST be preserved)
        const gotchas = obs.filter(o => o.type === 'gotcha').length;
        score += gotchas * 3;

        // Decision bonus (architecture choices that define patterns)
        const decisions = obs.filter(o => o.type === 'decision').length;
        score += decisions * 2;

        // Facts bonus (structured knowledge)
        const totalFacts = obs.reduce((sum, o) => sum + (o.facts?.length || 0), 0);
        score += Math.min(totalFacts, 5);

        // Files bonus (indicates real code involvement)
        const totalFiles = new Set(obs.flatMap(o => o.filesModified || [])).size;
        score += Math.min(totalFiles, 5);

        return score;
    }

    private clusterToSkill(cluster: EntityCluster): SkillFull | null {
        const { entity, observations } = cluster;
        const safeName = entity.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();

        // Group observations by type
        const gotchas = observations.filter(o => o.type === 'gotcha');
        const decisions = observations.filter(o => o.type === 'decision');
        const howItWorks = observations.filter(o => o.type === 'how-it-works');
        const problems = observations.filter(o => o.type === 'problem-solution');
        const tradeoffs = observations.filter(o => o.type === 'trade-off');
        const others = observations.filter(o =>
            !['gotcha', 'decision', 'how-it-works', 'problem-solution', 'trade-off'].includes(o.type),
        );

        // Collect all facts and concepts
        const allFacts = [...new Set(observations.flatMap(o => o.facts || []))];
        const allConcepts = [...new Set(observations.flatMap(o => o.concepts || []))];
        const allFiles = [...new Set(observations.flatMap(o => o.filesModified || []))];

        // Build SKILL.md content
        const lines: string[] = [];

        // Frontmatter
        const description = this.generateDescription(cluster);
        lines.push('---');
        lines.push(`description: ${description}`);
        lines.push('---');
        lines.push('');

        // Title
        lines.push(`# ${entity}`);
        lines.push('');
        lines.push(`> Auto-generated from ${observations.length} project observations by Memorix.`);
        lines.push('> Adapt to your actual project context before relying on this skill.');
        lines.push('');

        // Key files
        if (allFiles.length > 0) {
            lines.push('## Key Files');
            lines.push('');
            for (const f of allFiles.slice(0, 15)) {
                lines.push(`- \`${f}\``);
            }
            lines.push('');
        }

        // Critical gotchas (most important — put first)
        if (gotchas.length > 0) {
            lines.push('## ⚠️ Critical Gotchas');
            lines.push('');
            for (const g of gotchas) {
                lines.push(`### ${g.title}`);
                if (g.narrative) lines.push('', g.narrative);
                if (g.facts && g.facts.length > 0) {
                    lines.push('', ...g.facts.map(f => `- ${f}`));
                }
                lines.push('');
            }
        }

        // Architecture decisions
        if (decisions.length > 0) {
            lines.push('## 🏗️ Architecture Decisions');
            lines.push('');
            for (const d of decisions) {
                lines.push(`### ${d.title}`);
                if (d.narrative) lines.push('', d.narrative);
                if (d.facts && d.facts.length > 0) {
                    lines.push('', ...d.facts.map(f => `- ${f}`));
                }
                lines.push('');
            }
        }

        // How it works
        if (howItWorks.length > 0) {
            lines.push('## 📖 How It Works');
            lines.push('');
            for (const h of howItWorks) {
                lines.push(`### ${h.title}`);
                if (h.narrative) lines.push('', h.narrative);
                lines.push('');
            }
        }

        // Common problems & solutions
        if (problems.length > 0) {
            lines.push('## 🔧 Common Problems & Solutions');
            lines.push('');
            for (const p of problems) {
                lines.push(`### ${p.title}`);
                if (p.narrative) lines.push('', p.narrative);
                if (p.facts && p.facts.length > 0) {
                    lines.push('', ...p.facts.map(f => `- ${f}`));
                }
                lines.push('');
            }
        }

        // Trade-offs
        if (tradeoffs.length > 0) {
            lines.push('## ⚖️ Trade-offs');
            lines.push('');
            for (const t of tradeoffs) {
                lines.push(`### ${t.title}`);
                if (t.narrative) lines.push('', t.narrative);
                lines.push('');
            }
        }

        // Other notable observations
        if (others.length > 0) {
            lines.push('## 📝 Notes');
            lines.push('');
            for (const o of others.slice(0, 5)) {
                lines.push(`- **${o.title}**: ${o.narrative?.split('\n')[0] || ''}`);
            }
            lines.push('');
        }

        // Key concepts
        if (allConcepts.length > 0) {
            lines.push('## 🏷️ Related Concepts');
            lines.push('');
            lines.push(allConcepts.map(c => `\`${c}\``).join(', '));
            lines.push('');
        }

        // Quick facts summary
        if (allFacts.length > 0) {
            lines.push('## 📌 Quick Facts');
            lines.push('');
            for (const f of allFacts.slice(0, 15)) {
                lines.push(`- ${f}`);
            }
            lines.push('');
        }

        const content = lines.join('\n');

        return {
            name: safeName,
            description,
            sourcePath: '',
            sourceAgent: 'codex' as AgentTarget, // generated skills follow SKILL.md standard
            content,
            generated: true,
        };
    }

    private generateDescription(cluster: EntityCluster): string {
        const parts: string[] = [];
        const typeCounts: Record<string, number> = {};
        for (const obs of cluster.observations) {
            typeCounts[obs.type] = (typeCounts[obs.type] || 0) + 1;
        }

        if (typeCounts['gotcha']) parts.push(`${typeCounts['gotcha']} gotcha(s)`);
        if (typeCounts['decision']) parts.push(`${typeCounts['decision']} decision(s)`);
        if (typeCounts['how-it-works']) parts.push(`${typeCounts['how-it-works']} explanation(s)`);
        if (typeCounts['problem-solution']) parts.push(`${typeCounts['problem-solution']} fix(es)`);

        const summary = parts.length > 0 ? parts.join(', ') : `${cluster.observations.length} observations`;
        return `Project patterns for ${cluster.entity}: ${summary}`;
    }
}
