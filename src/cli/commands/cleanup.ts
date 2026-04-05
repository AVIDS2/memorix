/**
 * CLI Command: memorix cleanup
 *
 * Identifies and removes low-quality auto-generated observations.
 * Also detects and archives demo/test/system-self pollution.
 * Inspired by Mem0's memory consolidation and Graphiti's temporal pruning.
 *
 * Usage:
 *   memorix cleanup                — Interactive: preview & confirm deletion of low-quality
 *   memorix cleanup --noise        — Also archive demo/test/Memorix-self pollution
 *   memorix cleanup --dry          — Preview only, no changes
 *   memorix cleanup --force        — Apply without confirmation
 *   memorix cleanup --project X    — Target a specific projectId
 */

import { defineCommand } from 'citty';
import { detectProject } from '../../project/detector.js';
import { getProjectDataDir } from '../../store/persistence.js';
import { getObservationStore } from '../../store/obs-store.js';

/** Patterns that indicate auto-generated, low-value observations */
const LOW_QUALITY_PATTERNS = [
    /^Session activity/i,
    /^Updated \S+\.\w+$/i,
    /^Created \S+\.\w+$/i,
    /^Deleted \S+\.\w+$/i,
    /^Modified \S+\.\w+$/i,
    /^Ran command:/i,
    /^Read file:/i,
];

/** Patterns for demo/test noise — matches session.ts NOISE_PATTERNS */
const NOISE_PATTERNS = [
    /\[测试\]/i, /\[test\]/i, /验证/i, /兼容/i, /\bcompat(?:ibility)?\b/i,
    /\bdemo\b/i, /展示/i, /全能力/i, /handoff/i, /交接/i,
    /for_memmcp_test/i, /\bbenchmark\b/i, /\bsandbox\b/i, /\bplayground\b/i,
];

/** Patterns for Memorix system self-reference — should not pollute unrelated projects */
const SYSTEM_SELF_PATTERNS = [
    /memorix.demo/i, /memorix.*全能力/i, /memorix.*工具.*能力/i,
    /memorix.*runtime.*mode/i, /memorix.*运行模式/i, /memorix.*control.plane/i,
    /session.*inject(?:ion)?/i, /注入.*逻辑/i,
    /\b22\s*(?:个|tools?).*(?:工具|能力|capabilit)/i,
    /memorix.*(?:v\d|版本|version)/i, /memorix.*(?:兼容|compat)/i,
    /memorix.*(?:测试|test)/i, /memmcp/i,
];

/** Check if an observation title matches low-quality patterns */
function isLowQuality(title: string): boolean {
    return LOW_QUALITY_PATTERNS.some(p => p.test(title.trim()));
}

/** Check if observation text matches noise/demo/test/system-self patterns */
function isNoisePollution(obs: { title?: string; narrative?: string; entityName?: string; facts?: string[]; concepts?: string[] }): { isNoise: boolean; reason: string } {
    const text = [obs.title, obs.narrative, obs.entityName, ...(obs.facts ?? []), ...(obs.concepts ?? [])]
        .filter(Boolean).join('\n');
    for (const p of SYSTEM_SELF_PATTERNS) {
        if (p.test(text)) return { isNoise: true, reason: 'system-self' };
    }
    for (const p of NOISE_PATTERNS) {
        if (p.test(text)) return { isNoise: true, reason: 'demo/test/noise' };
    }
    return { isNoise: false, reason: '' };
}

export default defineCommand({
    meta: {
        name: 'cleanup',
        description: 'Remove low-quality auto-generated observations',
    },
    args: {
        dry: {
            type: 'boolean',
            description: 'Preview only — do not delete anything',
            default: false,
        },
        force: {
            type: 'boolean',
            description: 'Delete without confirmation',
            default: false,
        },
        noise: {
            type: 'boolean',
            description: 'Also archive demo/test/system-self pollution observations',
            default: false,
        },
        project: {
            type: 'string',
            description: 'Target a specific projectId (e.g., AVIDS2/blog)',
        },
    },
    async run({ args }) {
        let projectId: string;
        let projectName: string;

        if (args.project) {
            projectId = args.project;
            projectName = args.project.split('/').pop() || args.project;
        } else {
            const project = detectProject();
            if (!project) {
                console.error('[ERROR] No .git found — not a project directory.');
                console.error('Use --project <id> to target a specific project, or run from a git repo.');
                process.exit(1);
            }
            projectId = project.id;
            projectName = project.name;
        }

        console.log(`\nProject: ${projectName} (${projectId})\n`);

        const dataDir = await getProjectDataDir(projectId);
        const allObs = await getObservationStore().loadAll() as Array<{
            id?: number;
            type?: string;
            title?: string;
            narrative?: string;
            entityName?: string;
            facts?: string[];
            concepts?: string[];
            timestamp?: string;
            projectId?: string;
            status?: string;
        }>;

        if (allObs.length === 0) {
            console.log('[OK] No observations found - nothing to clean up.');
            return;
        }

        // Filter to project-scoped observations only
        const projectObs = allObs.filter(o => o.projectId === projectId && (o.status ?? 'active') === 'active');

        // Categorize: low-quality
        const lowQuality = projectObs.filter(o => isLowQuality(o.title ?? ''));
        const highQuality = projectObs.filter(o => !isLowQuality(o.title ?? ''));

        // Find duplicates (same title + type + entity)
        const seen = new Set<string>();
        const duplicates: typeof projectObs = [];
        const unique: typeof projectObs = [];
        for (const obs of highQuality) {
            const key = `${obs.type}|${obs.title}|${obs.entityName}`;
            if (seen.has(key)) {
                duplicates.push(obs);
            } else {
                seen.add(key);
                unique.push(obs);
            }
        }

        // Find noise pollution (demo/test/system-self)
        const noiseHits: Array<{ obs: typeof projectObs[0]; reason: string }> = [];
        if (args.noise) {
            for (const obs of projectObs) {
                if (lowQuality.includes(obs) || duplicates.includes(obs)) continue;
                const { isNoise, reason } = isNoisePollution(obs);
                if (isNoise) noiseHits.push({ obs, reason });
            }
        }

        const toRemove = [...lowQuality, ...duplicates];
        const toArchive = noiseHits.map(h => h.obs);

        console.log(`Analysis (active observations for ${projectId}):`);
        console.log(`   Total active:       ${projectObs.length}`);
        console.log(`   High quality:       ${unique.length - toArchive.length}`);
        console.log(`   Low quality:        ${lowQuality.length}`);
        console.log(`   Duplicates:         ${duplicates.length}`);
        if (args.noise) {
            console.log(`   Noise pollution:    ${toArchive.length}`);
        }
        console.log(`   To delete:          ${toRemove.length}`);
        if (args.noise) {
            console.log(`   To archive:         ${toArchive.length}`);
        }
        console.log();

        if (toRemove.length === 0 && toArchive.length === 0) {
            console.log('[OK] All observations are clean — nothing to clean up!');
            return;
        }

        // Preview deletions
        if (toRemove.length > 0) {
            console.log('Items to DELETE:');
            toRemove.slice(0, 10).forEach(o => {
                const tag = isLowQuality(o.title ?? '') ? '(low-quality)' : '(duplicate)';
                console.log(`   ${tag} #${o.id ?? '?'} "${o.title}" [${o.type}]`);
            });
            if (toRemove.length > 10) {
                console.log(`   ... and ${toRemove.length - 10} more`);
            }
            console.log();
        }

        // Preview noise archival
        if (toArchive.length > 0) {
            console.log('Items to ARCHIVE (noise pollution):');
            noiseHits.slice(0, 15).forEach(({ obs, reason }) => {
                console.log(`   (${reason}) #${obs.id ?? '?'} "${obs.title}" [${obs.type}] entity=${obs.entityName}`);
            });
            if (toArchive.length > 15) {
                console.log(`   ... and ${toArchive.length - 15} more`);
            }
            console.log();
        }

        if (args.dry) {
            console.log('[DRY RUN] No changes made.');
            return;
        }

        if (!args.force) {
            const readline = await import('node:readline');
            const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
            const desc = [
                toRemove.length > 0 ? `delete ${toRemove.length}` : '',
                toArchive.length > 0 ? `archive ${toArchive.length}` : '',
            ].filter(Boolean).join(' and ');
            const answer = await new Promise<string>(resolve => {
                rl.question(`Proceed to ${desc} observations? (y/N) `, resolve);
            });
            rl.close();

            if (answer.trim().toLowerCase() !== 'y') {
                console.log('Cancelled.');
                return;
            }
        }

        // Archive noise observations (set status to 'archived' instead of deleting)
        const archiveIds = new Set(toArchive.map(o => o.id));
        let archivedCount = 0;
        for (const obs of allObs) {
            if (archiveIds.has(obs.id)) {
                (obs as any).status = 'archived';
                archivedCount++;
            }
        }

        // Delete low-quality/duplicate observations
        const removeIds = new Set(toRemove.map(o => JSON.stringify(o)));
        const remaining = allObs.filter(o => !removeIds.has(JSON.stringify(o)));

        await getObservationStore().bulkReplace(remaining as any);

        const parts: string[] = [];
        if (toRemove.length > 0) parts.push(`deleted ${toRemove.length}`);
        if (archivedCount > 0) parts.push(`archived ${archivedCount}`);
        console.log(`[OK] ${parts.join(', ')}. ${remaining.length} observations remaining.`);
    },
});
