/**
 * memorix dashboard - Launch the Memorix Web Dashboard (Standalone mode)
 *
 * Starts a read-mostly project dashboard with memory, sessions, and
 * orchestration coordination state. For shared MCP access, use `memorix serve-http`.
 *
 * Mode semantics:
 *   - "Standalone" = Local read-mostly dashboard (this command, default port 3210)
 *   - "Control Plane" = HTTP MCP + multi-session live dashboard (memorix serve-http, default port 3211)
 */

import { defineCommand } from 'citty';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseTcpPortOrReport } from '../port.js';

export default defineCommand({
    meta: {
        name: 'dashboard',
        description: 'Launch a standalone read-mostly project dashboard',
    },
    args: {
        port: {
            type: 'string',
            description: 'Port to run the dashboard on (default: [server].dashboardPort or 3210)',
            required: false,
        },
    },
    run: async ({ args }) => {
        const { detectProject } = await import('../../project/detector.js');
        const { getProjectDataDir } = await import('../../store/persistence.js');
        const { startDashboard } = await import('../../dashboard/server.js');

        // The [server].dashboardPort config is a real default source; the
        // explicit --port flag always wins.
        let configuredDashboardPort: number | undefined;
        try {
            const { getServerConfig } = await import('../../config.js');
            const serverConfig = getServerConfig();
            configuredDashboardPort = typeof serverConfig.dashboardPort === 'number'
                ? serverConfig.dashboardPort
                : undefined;
        } catch { /* config files are optional */ }

        const project = detectProject();
        if (!project) {
            console.error('Memorix requires a git repo to establish project identity. Run `git init` in this workspace first.');
            process.exit(1);
        }
        const dataDir = await getProjectDataDir(project.id);
        const port = parseTcpPortOrReport(args.port as string | undefined, configuredDashboardPort ?? 3210);
        if (port === undefined) {
            process.exitCode = 1;
            return;
        }

        // Resolve static directory relative to the compiled CLI entry point
        // CLI is at dist/cli/index.js; static files are at dist/dashboard/static.
        const cliDir = path.dirname(fileURLToPath(import.meta.url));
        const staticDir = path.join(cliDir, '..', 'dashboard', 'static');

        await startDashboard(dataDir, port, staticDir, project.id, project.name, true, project.rootPath, true);

        // Keep alive
        await new Promise(() => { });
    },
});
