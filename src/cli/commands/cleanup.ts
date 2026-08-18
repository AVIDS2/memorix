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
import type { Observation } from '../../types.js';
import { detectProject } from '../../project/detector.js';
import { getProjectDataDir } from '../../store/persistence.js';
import { getObservationStore, initObservationStore } from '../../store/obs-store.js';
import { filterReadableObservations } from '../../memory/visibility.js';
import {
    analyzeCleanupObservations,
    applyCleanupMutations,
    isLowQualityObservation,
} from '../../memory/cleanup.js';

export { applyCleanupMutations } from '../../memory/cleanup.js';

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
        await initObservationStore(dataDir);
        const store = getObservationStore();
        const projectObs = filterReadableObservations(
            await store.loadByProject(projectId, { status: 'active' }),
            { projectId },
        ) as Array<{
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

        if (projectObs.length === 0) {
            console.log('[OK] No observations found - nothing to clean up.');
            return;
        }

        const analysis = analyzeCleanupObservations(projectObs as Observation[], { includeNoise: args.noise });
        const { lowQuality, duplicates, noise: noiseHits, toRemove, toArchive } = analysis;

        console.log(`Analysis (active observations for ${projectId}):`);
        console.log(`   Total active:       ${analysis.totalActive}`);
        console.log(`   High quality:       ${analysis.highQuality}`);
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
                const tag = isLowQualityObservation(o.title ?? '') ? '(low-quality)' : '(duplicate)';
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
            noiseHits.slice(0, 15).forEach(({ observation, reason }) => {
                console.log(`   (${reason}) #${observation.id ?? '?'} "${observation.title}" [${observation.type}] entity=${observation.entityName}`);
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

        const mutation = await applyCleanupMutations(
            store,
            toArchive as Observation[],
            toRemove as Observation[],
        );
        const remainingActive = projectObs.length - mutation.archived - mutation.removed;

        const parts: string[] = [];
        if (mutation.removed > 0) parts.push(`deleted ${mutation.removed}`);
        if (mutation.archived > 0) parts.push(`archived ${mutation.archived}`);
        console.log(`[OK] ${parts.join(', ')}. ${remainingActive} active observations remain in ${projectId}.`);
    },
});
