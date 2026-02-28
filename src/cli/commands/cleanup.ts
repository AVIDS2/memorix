/**
 * CLI Command: memorix cleanup
 *
 * Identifies and removes low-quality auto-generated observations.
 * Inspired by Mem0's memory consolidation and Graphiti's temporal pruning.
 *
 * Usage:
 *   memorix cleanup          — Interactive: preview & confirm deletion
 *   memorix cleanup --dry    — Preview only, no deletions
 *   memorix cleanup --force  — Delete without confirmation
 */

import { defineCommand } from 'citty';
import { detectProject } from '../../project/detector.js';
import { getProjectDataDir, loadObservationsJson, saveObservationsJson } from '../../store/persistence.js';

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

/** Check if an observation title matches low-quality patterns */
function isLowQuality(title: string): boolean {
    return LOW_QUALITY_PATTERNS.some(p => p.test(title.trim()));
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
    },
    async run({ args }) {
        const project = detectProject();

        if (project.id.startsWith('placeholder/')) {
            console.error('⚠️ Not in a valid project directory — using degraded mode.');
            console.error('Set MEMORIX_PROJECT_ROOT or --cwd for best results.');
        }

        console.log(`\n📦 Project: ${project.name} (${project.id})\n`);

        const dataDir = await getProjectDataDir(project.id);
        const allObs = await loadObservationsJson(dataDir) as Array<{
            id?: number;
            type?: string;
            title?: string;
            narrative?: string;
            entityName?: string;
            facts?: string[];
            timestamp?: string;
        }>;

        if (allObs.length === 0) {
            console.log('✅ No observations found — nothing to clean up.');
            return;
        }

        // Categorize
        const lowQuality = allObs.filter(o => isLowQuality(o.title ?? ''));
        const highQuality = allObs.filter(o => !isLowQuality(o.title ?? ''));

        // Also find duplicates (same title + type + entity)
        const seen = new Set<string>();
        const duplicates: typeof allObs = [];
        const unique: typeof allObs = [];
        for (const obs of highQuality) {
            const key = `${obs.type}|${obs.title}|${obs.entityName}`;
            if (seen.has(key)) {
                duplicates.push(obs);
            } else {
                seen.add(key);
                unique.push(obs);
            }
        }

        const toRemove = [...lowQuality, ...duplicates];

        console.log(`📊 Analysis:`);
        console.log(`   Total observations:   ${allObs.length}`);
        console.log(`   🟢 High quality:       ${unique.length}`);
        console.log(`   🔴 Low quality:        ${lowQuality.length}`);
        console.log(`   🟡 Duplicates:         ${duplicates.length}`);
        console.log(`   🗑️  To remove:          ${toRemove.length}`);
        console.log();

        if (toRemove.length === 0) {
            console.log('✅ All observations are high quality — nothing to clean up!');
            return;
        }

        // Preview
        console.log('🔍 Examples of items to remove:');
        toRemove.slice(0, 10).forEach(o => {
            const tag = isLowQuality(o.title ?? '') ? '(low-quality)' : '(duplicate)';
            console.log(`   ${tag} #${o.id ?? '?'} "${o.title}" [${o.type}]`);
        });
        if (toRemove.length > 10) {
            console.log(`   ... and ${toRemove.length - 10} more`);
        }
        console.log();

        if (args.dry) {
            console.log('🔒 Dry run — no changes made.');
            return;
        }

        if (!args.force) {
            // Simple confirmation via stdin
            const readline = await import('node:readline');
            const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
            const answer = await new Promise<string>(resolve => {
                rl.question(`⚠️  Delete ${toRemove.length} observations? (y/N) `, resolve);
            });
            rl.close();

            if (answer.trim().toLowerCase() !== 'y') {
                console.log('❌ Cancelled.');
                return;
            }
        }

        // Remove
        const removeIds = new Set(toRemove.map(o => JSON.stringify(o)));
        const remaining = allObs.filter(o => !removeIds.has(JSON.stringify(o)));

        await saveObservationsJson(dataDir, remaining);

        console.log(`✅ Removed ${toRemove.length} observations. ${remaining.length} remaining.`);
    },
});
