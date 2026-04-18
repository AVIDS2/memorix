/**
 * memorix dashboard — Launch the Memorix Web Dashboard (Standalone mode)
 *
 * Starts a Standalone Dashboard server with no MCP or Team features.
 * For the full Control Plane (MCP + Dashboard + Team), use `memorix serve-http`.
 *
 * Mode semantics:
 *   - "Standalone" = Dashboard only, no MCP/team (this command, default port 3210)
 *   - "Control Plane" = HTTP MCP + Dashboard + Team (memorix serve-http, default port 3211)
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
        if (!project) {
            console.error('Memorix requires a git repo to establish project identity. Run `git init` in this workspace first.');
            process.exit(1);
        }
        const dataDir = await getProjectDataDir(project.id);
        const port = parseInt(args.port as string, 10) || 3210;

        // Resolve static directory relative to the compiled CLI entry point
        // CLI is at dist/cli/index.js → static files are at dist/dashboard/static
        const cliDir = path.dirname(fileURLToPath(import.meta.url));
        const staticDir = path.join(cliDir, '..', 'dashboard', 'static');

        await startDashboard(dataDir, port, staticDir, project.id, project.name, true, undefined, project.rootPath, true);

        // Keep alive
        await new Promise(() => { });
    },
});
