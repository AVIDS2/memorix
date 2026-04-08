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

import { loadGraphJsonl, saveGraphJsonl, loadIdCounter, getBaseDataDir } from '../store/persistence.js';
import { getObservationStore, initObservationStore } from '../store/obs-store.js';
import { getSessionStore, initSessionStore } from '../store/session-store.js';

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
    // In flat storage, all projects share the same dataDir — only the projectId filter changes
    const requestedProject = url.searchParams.get('project');
    let effectiveDataDir = dataDir;
    let effectiveProjectId = projectId;
    let effectiveProjectName = projectName;
    if (requestedProject && requestedProject !== projectId) {
        effectiveDataDir = baseDir;  // flat storage: all data in one dir
        effectiveProjectId = requestedProject;
        effectiveProjectName = requestedProject.split('/').pop() || requestedProject;
    }

    try {
        switch (apiPath) {
            case '/projects': {
                // List all unique project IDs from observations data (flat storage)
                // Deduplicate using alias registry — aliased IDs are merged under canonical
                try {
                    const allObs = await getObservationStore().loadAll() as Array<{ projectId?: string }>;
                    const projectSet = new Map<string, number>();
                    for (const obs of allObs) {
                        if (obs.projectId) {
                            projectSet.set(obs.projectId, (projectSet.get(obs.projectId) || 0) + 1);
                        }
                    }

                    // Merge aliased project IDs into their canonical form
                    let mergedSet = projectSet;
                    try {
                        const { getCanonicalId } = await import('../project/aliases.js');
                        mergedSet = new Map<string, number>();
                        for (const [id, count] of projectSet) {
                            const canonical = await getCanonicalId(id);
                            mergedSet.set(canonical, (mergedSet.get(canonical) || 0) + count);
                        }
                    } catch { /* alias module not available, use raw IDs */ }

                    const projects = Array.from(mergedSet.entries())
                        .sort((a, b) => b[1] - a[1])  // Most observations first
                        .map(([id, count]) => ({
                            id,
                            name: id.split('/').pop() || id,
                            count,
                            isCurrent: id === projectId,
                        }));
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
                // Project-scope the graph: only include entities that have observations in this project
                const graphObs = await getObservationStore().loadAll() as Array<{ projectId?: string; entityName?: string; status?: string }>;
                const projectEntityNames = new Set(
                    graphObs
                        .filter(o => o.projectId === effectiveProjectId && (o.status ?? 'active') === 'active' && o.entityName)
                        .map(o => o.entityName!),
                );
                const entities = graph.entities.filter(e => projectEntityNames.has(e.name));
                const entityNameSet = new Set(entities.map(e => e.name));
                const relations = graph.relations.filter(r => entityNameSet.has(r.from) && entityNameSet.has(r.to));
                sendJson(res, { entities, relations });
                break;
            }

            case '/observations': {
                const allObs = await getObservationStore().loadAll();
                const observations = filterByProject(allObs as Array<{ projectId?: string }>, effectiveProjectId);
                sendJson(res, observations);
                break;
            }

            case '/sessions': {
                const allSessions = await getSessionStore().loadAll();
                const sessions = filterByProject(allSessions as Array<{ projectId?: string }>, effectiveProjectId);
                sendJson(res, sessions);
                break;
            }

            case '/stats': {
                const graph = await loadGraphJsonl(effectiveDataDir);
                const allObs = await getObservationStore().loadAll();
                const observations = filterByProject(allObs as Array<{ projectId?: string; type?: string; id?: number; createdAt?: string; title?: string; entityName?: string }>, effectiveProjectId);
                const nextId = await loadIdCounter(effectiveDataDir);

                // Type counts
                const typeCounts: Record<string, number> = {};
                for (const obs of observations) {
                    const t = obs.type || 'unknown';
                    typeCounts[t] = (typeCounts[t] || 0) + 1;
                }

                // Source breakdown (git / agent / manual)
                const sourceCounts: Record<string, number> = { git: 0, agent: 0, manual: 0 };
                const gitMemories: Array<any> = [];
                const now = Date.now();
                const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
                let recentGitCount = 0;

                for (const obs of observations) {
                    const src = (obs as any).source || 'agent';
                    sourceCounts[src] = (sourceCounts[src] || 0) + 1;
                    if (src === 'git') {
                        gitMemories.push(obs);
                        if (obs.createdAt && new Date(obs.createdAt).getTime() > sevenDaysAgo) {
                            recentGitCount++;
                        }
                    }
                }

                // Git memory summary
                const gitSorted = [...gitMemories].sort((a, b) => (b.id || 0) - (a.id || 0));
                const recentGitMemories = gitSorted.slice(0, 8).map(o => ({
                    id: o.id, title: o.title, type: o.type,
                    commitHash: (o as any).commitHash,
                    entityName: o.entityName, createdAt: o.createdAt,
                    filesModified: (o as any).filesModified,
                }));

                // Retention summary
                let retentionSummary = { active: 0, stale: 0, archive: 0, immune: 0 };
                for (const obs of observations) {
                    const age = now - new Date((obs as any).createdAt || now).getTime();
                    const ageHours = age / (1000 * 60 * 60);
                    const importance = (obs as any).importance ?? 5;
                    const accessCount = (obs as any).accessCount ?? 0;
                    const lambda = 0.01;
                    const score = Math.min(importance * Math.exp(-lambda * ageHours) + Math.min(accessCount * 0.5, 3), 10);
                    const isImmune = importance >= 8 || obs.type === 'gotcha' || obs.type === 'decision';
                    if (isImmune) retentionSummary.immune++;
                    if (score >= 3) retentionSummary.active++;
                    else if (score >= 1) retentionSummary.stale++;
                    else retentionSummary.archive++;
                }

                // Recent observations (last 10)
                const sorted = [...observations]
                    .sort((a, b) => (b.id || 0) - (a.id || 0))
                    .slice(0, 10);

                // Embedding provider status
                let embeddingStatus = { enabled: false, provider: '', dimensions: 0 };
                try {
                    const { getEmbeddingProvider } = await import('../embedding/provider.js');
                    const embProvider = await getEmbeddingProvider();
                    embeddingStatus = {
                        enabled: embProvider !== null,
                        provider: embProvider?.name || '',
                        dimensions: embProvider?.dimensions || 0,
                    };
                } catch { /* embedding module not available */ }

                // Storage backend info
                const store = getObservationStore();
                const storageInfo = {
                    backend: store.getBackendName(),
                    generation: store.getGeneration(),
                };

                sendJson(res, {
                    entities: graph.entities.length,
                    relations: graph.relations.length,
                    observations: observations.length,
                    nextId,
                    typeCounts,
                    sourceCounts,
                    recentObservations: sorted,
                    embedding: embeddingStatus,
                    storage: storageInfo,
                    gitSummary: {
                        total: gitMemories.length,
                        recentWeek: recentGitCount,
                        recentMemories: recentGitMemories,
                    },
                    retentionSummary,
                });
                break;
            }

            case '/retention': {
                const allObs = await getObservationStore().loadAll() as Array<{
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

            case '/config': {
                // Config provenance — shows where each config value comes from
                const os = await import('node:os');
                const { existsSync } = await import('node:fs');
                const { join } = await import('node:path');

                let yml: any = {};
                try {
                    const { loadYamlConfig } = await import('../config/yaml-loader.js');
                    yml = loadYamlConfig(effectiveProjectId.includes('/') ? undefined : undefined);
                } catch { /* best effort */ }

                // Check which config files exist
                const projectRoot = process.cwd(); // approximate — dashboard may not have project root
                const files: Record<string, { exists: boolean; path: string }> = {
                    'project memorix.yml': { exists: false, path: '' },
                    'user memorix.yml': { exists: false, path: '' },
                    'project .env': { exists: false, path: '' },
                    'user .env': { exists: false, path: '' },
                    'legacy config.json': { exists: false, path: '' },
                };
                try {
                    const home = os.homedir();
                    const paths: Record<string, string> = {
                        'project memorix.yml': join(projectRoot, 'memorix.yml'),
                        'user memorix.yml': join(home, '.memorix', 'memorix.yml'),
                        'project .env': join(projectRoot, '.env'),
                        'user .env': join(home, '.memorix', '.env'),
                        'legacy config.json': join(home, '.memorix', 'config.json'),
                    };
                    for (const [key, fpath] of Object.entries(paths)) {
                        files[key] = { exists: existsSync(fpath), path: fpath };
                    }
                } catch { /* best effort */ }

                // Config values with provenance
                const values: Array<{ key: string; value: string; source: string; sensitive?: boolean }> = [];

                // LLM
                const llmProvider = process.env.MEMORIX_LLM_PROVIDER || yml.llm?.provider;
                if (llmProvider) values.push({ key: 'llm.provider', value: llmProvider, source: process.env.MEMORIX_LLM_PROVIDER ? 'env' : 'memorix.yml' });

                const llmModel = process.env.MEMORIX_LLM_MODEL || yml.llm?.model;
                if (llmModel) values.push({ key: 'llm.model', value: llmModel, source: process.env.MEMORIX_LLM_MODEL ? 'env' : 'memorix.yml' });

                const llmKey = process.env.MEMORIX_LLM_API_KEY || process.env.MEMORIX_API_KEY || yml.llm?.apiKey || process.env.OPENAI_API_KEY;
                if (llmKey) {
                    let src = 'unknown';
                    if (process.env.MEMORIX_LLM_API_KEY) src = 'env:MEMORIX_LLM_API_KEY';
                    else if (process.env.MEMORIX_API_KEY) src = 'env:MEMORIX_API_KEY';
                    else if (yml.llm?.apiKey) src = 'memorix.yml (move to .env!)';
                    else if (process.env.OPENAI_API_KEY) src = 'env:OPENAI_API_KEY';
                    values.push({ key: 'llm.apiKey', value: '****' + llmKey.slice(-4), source: src, sensitive: true });
                } else {
                    values.push({ key: 'llm.apiKey', value: 'not set', source: 'none' });
                }

                // Embedding
                const embProvider = process.env.MEMORIX_EMBEDDING || yml.embedding?.provider || 'off';
                values.push({ key: 'embedding.provider', value: embProvider, source: process.env.MEMORIX_EMBEDDING ? 'env' : yml.embedding?.provider ? 'memorix.yml' : 'default' });

                // Git
                values.push({ key: 'git.autoHook', value: String(yml.git?.autoHook ?? false), source: yml.git?.autoHook !== undefined ? 'memorix.yml' : 'default' });
                values.push({ key: 'git.skipMergeCommits', value: String(yml.git?.skipMergeCommits ?? true), source: yml.git?.skipMergeCommits !== undefined ? 'memorix.yml' : 'default' });

                // Behavior
                if (yml.behavior?.formationMode) values.push({ key: 'behavior.formationMode', value: yml.behavior.formationMode, source: 'memorix.yml' });
                if (yml.behavior?.sessionInject) values.push({ key: 'behavior.sessionInject', value: yml.behavior.sessionInject, source: 'memorix.yml' });

                // Server
                values.push({ key: 'server.transport', value: yml.server?.transport || 'stdio', source: yml.server?.transport ? 'memorix.yml' : 'default' });
                values.push({ key: 'server.dashboard', value: String(yml.server?.dashboard ?? true), source: yml.server?.dashboard !== undefined ? 'memorix.yml' : 'default' });

                sendJson(res, { files, values });
                break;
            }

            case '/identity': {
                // Project identity health
                const allObs = await getObservationStore().loadAll() as Array<{ projectId?: string }>;
                const allProjectIds = [...new Set(allObs.map(o => o.projectId).filter(Boolean))] as string[];

                // Known dirty patterns
                const dirtyPatterns = [
                    /^placeholder\//,
                    /System32/i,
                    /Microsoft VS Code/i,
                    /node_modules/i,
                    /\.vscode/i,
                    /^local\/[A-Z]:\\/,
                ];
                const dirtyIds = allProjectIds.filter(id => dirtyPatterns.some(p => p.test(id)));

                // Get alias info
                let aliasGroups: any[] = [];
                let canonicalId = effectiveProjectId;
                try {
                    const aliasModule = await import('../project/aliases.js');
                    canonicalId = await aliasModule.getCanonicalId(effectiveProjectId);

                    // Load full registry to get all groups
                    const { promises: fsP } = await import('node:fs');
                    const registryPath = path.join(baseDir, '.project-aliases.json');
                    const raw = await fsP.readFile(registryPath, 'utf-8');
                    const registry = JSON.parse(raw);
                    aliasGroups = registry.groups || [];
                } catch { /* alias module may not be available */ }

                const currentGroup = aliasGroups.find((g: any) => g.aliases?.includes(effectiveProjectId) || g.canonical === effectiveProjectId);
                const aliases = currentGroup?.aliases || [effectiveProjectId];

                // Health assessment
                const hasDirtyIds = dirtyIds.length > 0;
                const hasMultipleUnmerged = allProjectIds.length > aliasGroups.length + 1;
                const isHealthy = !hasDirtyIds && !hasMultipleUnmerged;

                sendJson(res, {
                    currentProjectId: effectiveProjectId,
                    canonicalId,
                    aliases,
                    allProjectIds,
                    dirtyIds,
                    aliasGroups: aliasGroups.length,
                    isHealthy,
                    healthIssues: [
                        ...(hasDirtyIds ? [`${dirtyIds.length} dirty project ID(s) detected`] : []),
                        ...(hasMultipleUnmerged ? ['Possible unmerged project identity splits'] : []),
                    ],
                });
                break;
            }

            default: {
                // Handle dynamic routes
                const deleteMatch = apiPath.match(/^\/observations\/(\d+)$/);
                if (deleteMatch && req.method === 'DELETE') {
                    const obsId = parseInt(deleteMatch[1], 10);
                    const obsStore = getObservationStore();
                    const allObs = await obsStore.loadAll();
                    const matchObs = allObs.find(o => o.id === obsId);
                    if (!matchObs) {
                        sendError(res, 'Observation not found', 404);
                    } else if (matchObs.projectId !== effectiveProjectId) {
                        // Cross-project deletion guard: reject if obs belongs to a different project
                        sendError(res, `Observation #${obsId} belongs to project "${matchObs.projectId}", not "${effectiveProjectId}"`, 403);
                    } else {
                        await obsStore.remove(obsId);

                        // Sync: clean up graph entity references for this observation
                        try {
                            const graph = await loadGraphJsonl(effectiveDataDir);
                            const prefix = `[#${obsId}] `;
                            let graphChanged = false;
                            for (const entity of graph.entities) {
                                const before = entity.observations.length;
                                entity.observations = entity.observations.filter(o => !o.startsWith(prefix));
                                if (entity.observations.length < before) graphChanged = true;
                            }
                            if (graphChanged) {
                                await saveGraphJsonl(effectiveDataDir, graph.entities, graph.relations);
                            }
                        } catch { /* graph sync is best-effort */ }

                        sendJson(res, { ok: true, deleted: obsId });
                    }
                    break;
                }

                if (apiPath === '/export') {
                    const fullGraph = await loadGraphJsonl(effectiveDataDir);
                    const allObs = await getObservationStore().loadAll();
                    const observations = filterByProject(allObs as Array<{ projectId?: string; entityName?: string; status?: string }>, effectiveProjectId);
                    const nextId = await loadIdCounter(effectiveDataDir);
                    // Project-scope the graph: only entities referenced by this project's observations
                    const exportEntityNames = new Set(
                        observations
                            .filter(o => (o.status ?? 'active') === 'active' && o.entityName)
                            .map(o => o.entityName!),
                    );
                    const exportEntities = fullGraph.entities.filter(e => exportEntityNames.has(e.name));
                    const exportEntitySet = new Set(exportEntities.map(e => e.name));
                    const exportRelations = fullGraph.relations.filter(r => exportEntitySet.has(r.from) && exportEntitySet.has(r.to));
                    const exportData = {
                        project: { id: effectiveProjectId, name: effectiveProjectName },
                        exportedAt: new Date().toISOString(),
                        graph: { entities: exportEntities, relations: exportRelations },
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

/** Mutable dashboard state — updated at runtime when project changes */
interface DashboardState {
    projectId: string;
    projectName: string;
    dataDir: string;
}

/** Optional team collaboration instances passed from MCP server */
export interface TeamInstances {
    registry: { listAgents: (filter?: any) => any[]; getActiveCount: () => number; getAgent: (id: string) => any };
    fileLocks: { listLocks: (agentId?: string) => any[]; cleanExpired: () => void };
    taskManager: { list: (filter?: any) => any[]; getAvailable: () => any[] };
    messageBus: { getUnreadCount: (agentId: string) => number };
}

/** Read full POST body as string */
function readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
        req.on('error', reject);
    });
}

export async function startDashboard(
    dataDir: string,
    port: number,
    staticDir: string,
    projectId: string,
    projectName: string,
    autoOpen = true,
    teamInstances?: TeamInstances,
): Promise<void> {
    await initObservationStore(dataDir);
    await initSessionStore(dataDir);
    const resolvedStaticDir = staticDir;
    // Derive baseDir from dataDir (parent directory of project-specific dir)
    const baseDir = getBaseDataDir();

    // Mutable state — can be updated via /api/set-current-project
    const state: DashboardState = { projectId, projectName, dataDir };

    const server = createServer(async (req, res) => {
        const url = req.url || '/';

        // POST /api/set-current-project — update the dashboard's current project
        // In flat storage, switching project only changes the projectId filter, not the data dir
        if (url.startsWith('/api/set-current-project') && req.method === 'POST') {
            try {
                const body = JSON.parse(await readBody(req));
                if (body.projectId) {
                    state.projectId = body.projectId;
                    state.projectName = body.projectName || body.projectId.split('/').pop() || body.projectId;
                    state.dataDir = baseDir;  // flat storage: always use base dir
                    console.error(`[dashboard] Switched current project to: ${state.projectId}`);
                    sendJson(res, { ok: true, projectId: state.projectId, projectName: state.projectName });
                } else {
                    sendError(res, 'Missing projectId in body', 400);
                }
            } catch {
                sendError(res, 'Invalid JSON body', 400);
            }
            return;
        }

        if (url.startsWith('/api/team')) {
            if (!teamInstances) {
                sendJson(res, { unavailable: true, reason: 'http-transport-required' });
                return;
            }
            try {
                teamInstances.fileLocks.cleanExpired();
                const agents = teamInstances.registry.listAgents();
                const locks = teamInstances.fileLocks.listLocks();
                const tasks = teamInstances.taskManager.list();
                const available = teamInstances.taskManager.getAvailable();
                sendJson(res, {
                    agents: agents.map((a: any) => ({
                        ...a,
                        unread: teamInstances!.messageBus.getUnreadCount(a.id),
                    })),
                    activeCount: teamInstances.registry.getActiveCount(),
                    locks,
                    tasks,
                    availableTasks: available.length,
                });
            } catch {
                sendJson(res, { agents: [], activeCount: 0, locks: [], tasks: [], availableTasks: 0 });
            }
            return;
        }

        if (url.startsWith('/api/')) {
            await handleApi(req, res, state.dataDir, state.projectId, state.projectName, baseDir);
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
