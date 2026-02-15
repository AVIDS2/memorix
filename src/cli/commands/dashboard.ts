/**
 * memorix dashboard — Launch the Memorix Web Dashboard
 */

import { defineCommand } from 'citty';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export default defineCommand({
    meta: {
        name: 'dashboard',
        description: 'Launch the Memorix Web Dashboard',
    },
    args: {
        port: {
            type: 'string',
            description: 'Port to run the dashboard on (default: 3210)',
            default: '3210',
        },
    },
    run: async ({ args }) => {
        const { detectProject } = await import('../../project/detector.js');
        const { getProjectDataDir } = await import('../../store/persistence.js');
        const { startDashboard } = await import('../../dashboard/server.js');

        const project = detectProject();
        const dataDir = await getProjectDataDir(project.id);
        const port = parseInt(args.port as string, 10) || 3210;

        // Resolve static directory relative to the compiled CLI entry point
        // CLI is at dist/cli/index.js → static files are at dist/dashboard/static
        const cliDir = path.dirname(fileURLToPath(import.meta.url));
        const staticDir = path.join(cliDir, '..', 'dashboard', 'static');

        await startDashboard(dataDir, port, staticDir, project.id, project.name);

        // Keep alive
        await new Promise(() => { });
    },
});
