/**
 * Memorix Dashboard Server
 *
 * Lightweight HTTP server that serves:
 * - REST API endpoints for reading memorix data
 * - Static frontend files (SPA)
 *
 * Zero external dependencies — uses Node.js built-in http module.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';

import { loadGraphJsonl, loadObservationsJson, saveObservationsJson, loadIdCounter, getBaseDataDir } from '../store/persistence.js';

// MIME types for static file serving
const MIME_TYPES: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
};

/**
 * Send a JSON response
 */
function sendJson(res: ServerResponse, data: unknown, status = 200) {
    res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
    });
    res.end(JSON.stringify(data));
}

/**
 * Send an error response
 */
function sendError(res: ServerResponse, message: string, status = 500) {
    sendJson(res, { error: message }, status);
}

/**
 * Filter observations by projectId
 */
function filterByProject<T extends { projectId?: string }>(items: T[], projectId: string): T[] {
    return items.filter(item => item.projectId === projectId);
}

/**
 * API route handlers
 */
async function handleApi(
    req: IncomingMessage,
    res: ServerResponse,
    dataDir: string,
    projectId: string,
    projectName: string,
    baseDir: string,
) {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    const apiPath = url.pathname.replace('/api', '');

    // Support ?project=xxx to switch view to another project
    const requestedProject = url.searchParams.get('project');
    let effectiveDataDir = dataDir;
    let effectiveProjectId = projectId;
    let effectiveProjectName = projectName;
    if (requestedProject && requestedProject !== projectId) {
        const sanitized = requestedProject.replace(/\//g, '--').replace(/[<>:"|?*\\]/g, '_');
        const candidateDir = path.join(baseDir, sanitized);
        try {
            await fs.access(candidateDir);
            effectiveDataDir = candidateDir;
            effectiveProjectId = requestedProject;
            effectiveProjectName = requestedProject.split('/').pop() || requestedProject;
        } catch {
            // requested project dir doesn't exist, fall through to default
        }
    }

    try {
        switch (apiPath) {
            case '/projects': {
                // List all project directories
                try {
                    const entries = await fs.readdir(baseDir, { withFileTypes: true });
                    const projects = entries
                        .filter((e: { isDirectory: () => boolean; name: string }) =>
                            e.isDirectory() && e.name.includes('--'))  // Only git-based projects (owner--repo)
                        .map((e: { name: string }) => {
                            const dirName = e.name;
                            const id = dirName.replace(/--/g, '/');
                            return {
                                id,
                                name: id.split('/').pop() || id,
                                dirName,
                                isCurrent: id === projectId,
                            };
                        });
                    sendJson(res, projects);
                } catch {
                    sendJson(res, []);
                }
                break;
            }

            case '/project': {
                sendJson(res, { id: effectiveProjectId, name: effectiveProjectName });
                break;
            }

            case '/graph': {
                const graph = await loadGraphJsonl(effectiveDataDir);
                sendJson(res, graph);
                break;
            }

            case '/observations': {
                const allObs = await loadObservationsJson(effectiveDataDir);
                const observations = filterByProject(allObs as Array<{ projectId?: string }>, effectiveProjectId);
                sendJson(res, observations);
                break;
            }

            case '/stats': {
                const graph = await loadGraphJsonl(effectiveDataDir);
                const allObs = await loadObservationsJson(effectiveDataDir);
                const observations = filterByProject(allObs as Array<{ projectId?: string; type?: string; id?: number; createdAt?: string; title?: string; entityName?: string }>, effectiveProjectId);
                const nextId = await loadIdCounter(effectiveDataDir);

                // Type counts
                const typeCounts: Record<string, number> = {};
                for (const obs of observations) {
                    const t = obs.type || 'unknown';
                    typeCounts[t] = (typeCounts[t] || 0) + 1;
                }

                // Recent observations (last 10)
                const sorted = [...observations]
                    .sort((a, b) => (b.id || 0) - (a.id || 0))
                    .slice(0, 10);

                sendJson(res, {
                    entities: graph.entities.length,
                    relations: graph.relations.length,
                    observations: observations.length,
                    nextId,
                    typeCounts,
                    recentObservations: sorted,
                });
                break;
            }

            case '/retention': {
                const allObs = await loadObservationsJson(effectiveDataDir) as Array<{
                    id?: number;
                    title?: string;
                    type?: string;
                    importance?: number;
                    accessCount?: number;
                    lastAccessedAt?: string;
                    createdAt?: string;
                    entityName?: string;
                    projectId?: string;
                }>;
                const observations = filterByProject(allObs, effectiveProjectId);

                const now = Date.now();
                const scored = observations.map((obs) => {
                    const age = now - new Date(obs.createdAt || now).getTime();
                    const ageHours = age / (1000 * 60 * 60);
                    const importance = obs.importance ?? 5;
                    const accessCount = obs.accessCount ?? 0;

                    // Exponential decay: score = importance * e^(-λt) + access_bonus
                    const lambda = 0.01;
                    const decayScore = importance * Math.exp(-lambda * ageHours);
                    const accessBonus = Math.min(accessCount * 0.5, 3);
                    const score = Math.min(decayScore + accessBonus, 10);

                    // Immune if importance >= 8 or type is 'gotcha' or 'decision'
                    const isImmune = importance >= 8 || obs.type === 'gotcha' || obs.type === 'decision';

                    return {
                        id: obs.id,
                        title: obs.title,
                        type: obs.type,
                        entityName: obs.entityName,
                        score: Math.round(score * 100) / 100,
                        isImmune,
                        ageHours: Math.round(ageHours * 10) / 10,
                        accessCount,
                    };
                });

                // Sort by score descending
                scored.sort((a, b) => b.score - a.score);

                const activeCount = scored.filter((s) => s.score >= 3).length;
                const staleCount = scored.filter((s) => s.score < 3 && s.score >= 1).length;
                const archiveCount = scored.filter((s) => s.score < 1).length;
                const immuneCount = scored.filter((s) => s.isImmune).length;

                sendJson(res, {
                    summary: { active: activeCount, stale: staleCount, archive: archiveCount, immune: immuneCount },
                    items: scored,
                });
                break;
            }

            default: {
                // Handle dynamic routes
                const deleteMatch = apiPath.match(/^\/observations\/(\d+)$/);
                if (deleteMatch && req.method === 'DELETE') {
                    const obsId = parseInt(deleteMatch[1], 10);
                    const allObs = await loadObservationsJson(effectiveDataDir) as Array<{ id?: number;[k: string]: unknown }>;
                    const idx = allObs.findIndex(o => o.id === obsId);
                    if (idx === -1) {
                        sendError(res, 'Observation not found', 404);
                    } else {
                        allObs.splice(idx, 1);
                        await saveObservationsJson(effectiveDataDir, allObs);
                        sendJson(res, { ok: true, deleted: obsId });
                    }
                    break;
                }

                if (apiPath === '/export') {
                    const graph = await loadGraphJsonl(effectiveDataDir);
                    const allObs = await loadObservationsJson(effectiveDataDir);
                    const observations = filterByProject(allObs as Array<{ projectId?: string }>, effectiveProjectId);
                    const nextId = await loadIdCounter(effectiveDataDir);
                    const exportData = {
                        project: { id: effectiveProjectId, name: effectiveProjectName },
                        exportedAt: new Date().toISOString(),
                        graph,
                        observations,
                        nextId,
                    };
                    res.writeHead(200, {
                        'Content-Type': 'application/json',
                        'Content-Disposition': `attachment; filename="memorix-${effectiveProjectId.replace(/\//g, '-')}-export.json"`,
                    });
                    res.end(JSON.stringify(exportData, null, 2));
                    break;
                }

                sendError(res, 'Not found', 404);
            }
        }
    } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        sendError(res, message);
    }
}

/**
 * Serve static files from the dashboard/static directory
 */
async function serveStatic(req: IncomingMessage, res: ServerResponse, staticDir: string) {
    let urlPath = new URL(req.url || '/', `http://${req.headers.host}`).pathname;

    // SPA: serve index.html for all non-file routes
    if (urlPath === '/' || !urlPath.includes('.')) {
        urlPath = '/index.html';
    }

    const filePath = path.join(staticDir, urlPath);

    // Security: prevent directory traversal
    if (!filePath.startsWith(staticDir)) {
        sendError(res, 'Forbidden', 403);
        return;
    }

    try {
        const data = await fs.readFile(filePath);
        const ext = path.extname(filePath);
        res.writeHead(200, {
            'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
            'Cache-Control': 'no-cache',
        });
        res.end(data);
    } catch {
        // Fallback to index.html for SPA routing
        try {
            const indexData = await fs.readFile(path.join(staticDir, 'index.html'));
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(indexData);
        } catch {
            sendError(res, 'Not found', 404);
        }
    }
}

/**
 * Start the dashboard server
 */

/** Cross-platform open URL in default browser */
function openBrowser(url: string) {
    const cmd =
        process.platform === 'win32' ? `start "" "${url}"` :
            process.platform === 'darwin' ? `open "${url}"` :
                `xdg-open "${url}"`;
    exec(cmd, () => { /* ignore errors */ });
}

export async function startDashboard(
    dataDir: string,
    port: number,
    staticDir: string,
    projectId: string,
    projectName: string,
    autoOpen = true,
): Promise<void> {
    const resolvedStaticDir = staticDir;
    // Derive baseDir from dataDir (parent directory of project-specific dir)
    const baseDir = getBaseDataDir();

    const server = createServer(async (req, res) => {
        const url = req.url || '/';

        if (url.startsWith('/api/')) {
            await handleApi(req, res, dataDir, projectId, projectName, baseDir);
        } else {
            await serveStatic(req, res, resolvedStaticDir);
        }
    });

    return new Promise((resolve, reject) => {
        server.on('error', (err: NodeJS.ErrnoException) => {
            if (err.code === 'EADDRINUSE') {
                console.error(`Port ${port} is already in use. Try: memorix dashboard --port ${port + 1}`);
                reject(err);
            } else {
                reject(err);
            }
        });

        server.listen(port, () => {
            const url = `http://localhost:${port}`;
            console.error(`\n  Memorix Dashboard`);
            console.error(`  ───────────────────────`);
            console.error(`  Project:  ${projectName} (${projectId})`);
            console.error(`  Local:    ${url}`);
            console.error(`  Data dir: ${dataDir}`);
            console.error(`\n  Press Ctrl+C to stop\n`);

            // Auto-open browser
            if (autoOpen) openBrowser(url);

            resolve();
        });
    });
}
