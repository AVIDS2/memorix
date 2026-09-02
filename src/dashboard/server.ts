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

import { getBaseDataDir } from '../store/persistence.js';
import { getObservationStore, initObservationStore } from '../store/obs-store.js';
import { getSessionStore, initSessionStore } from '../store/session-store.js';
import { initGraphStore, getGraphStore } from '../store/graph-store.js';
import type { TeamStore } from '../team/team-store.js';
import { loadDotenv } from '../config/dotenv-loader.js';
import { resetDotenv } from '../config/dotenv-loader.js';
import { initProjectRoot } from '../config/yaml-loader.js';
import { clearProjectRoot } from '../config/yaml-loader.js';
import { getResolvedConfig } from '../config/resolved-config.js';
import { scopeKnowledgeGraphToProject } from '../memory/graph-scope.js';
import { projectObservationRetention, summarizeRetentionProjections } from '../memory/retention.js';
import { canManageObservation, filterReadableObservations } from '../memory/visibility.js';
import type { Observation } from '../types.js';
import { EvidenceCardStore } from '../store/evidence-store.js';
import { MemoryFeedbackStore } from '../memory/feedback.js';
import {
    DashboardMaintenanceError,
    executeCleanup,
    executeConsolidate,
    executeDeduplicate,
    executeRetentionArchive,
    previewCleanup,
    previewConsolidate,
    previewDeduplicate,
    previewRetentionArchive,
} from './maintenance.js';
import { resolveDashboardKeySource } from './config-provenance.js';

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
 * The dashboard has no per-agent authentication. Treat it as an unbound reader:
 * project facts remain inspectable, while personal and team-scoped records stay
 * in their owning MCP session.
 */
function filterDashboardObservations(observations: Observation[], projectId: string): Observation[] {
    return filterReadableObservations(observations, { projectId });
}

function isActiveStatus(status?: string): boolean {
    return (status ?? 'active') === 'active';
}

async function handleMaintenanceMutation(
    apiPath: string,
    req: IncomingMessage,
    res: ServerResponse,
    context: {
        dataDir: string;
        projectId: string;
        projectRoot: string | null;
    },
): Promise<void> {
    if (req.method !== 'POST') {
        throw new DashboardMaintenanceError('Maintenance actions require POST.', 405);
    }

    let body: Record<string, unknown> = {};
    const raw = await readBody(req);
    if (raw.trim()) {
        try {
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('object required');
            body = parsed as Record<string, unknown>;
        } catch {
            throw new DashboardMaintenanceError('Invalid maintenance request body.', 400);
        }
    }

    const maintenanceContext = {
        ...context,
        store: getObservationStore(),
    };
    let result: unknown;
    switch (apiPath) {
        case '/maintenance/cleanup/preview':
            result = await previewCleanup(maintenanceContext, body.includeNoise === true);
            break;
        case '/maintenance/cleanup/execute':
            result = await executeCleanup(maintenanceContext, body.payload, body.token);
            break;
        case '/maintenance/deduplicate/preview':
            result = await previewDeduplicate(maintenanceContext);
            break;
        case '/maintenance/deduplicate/execute':
            result = await executeDeduplicate(maintenanceContext, body.payload, body.token);
            break;
        case '/maintenance/consolidate/preview':
            result = await previewConsolidate(maintenanceContext);
            break;
        case '/maintenance/consolidate/execute':
            result = await executeConsolidate(maintenanceContext, body.payload, body.token);
            break;
        case '/maintenance/retention/preview':
            result = await previewRetentionArchive(maintenanceContext);
            break;
        case '/maintenance/retention/execute':
            result = await executeRetentionArchive(maintenanceContext, body.payload, body.token);
            break;
        default:
            throw new DashboardMaintenanceError('Unknown maintenance action.', 404);
    }
    sendJson(res, result);
}

/**
 * Prepare project-scoped dashboard config before any route initializes providers.
 * This keeps standalone dashboard behavior aligned with CLI/TUI commands: project
 * .env is visible before embedding/LLM status modules read process.env.
 */
let preparedDashboardProjectRoot: string | null = null;

export function prepareDashboardConfig(projectRoot: string | null): void {
    if (!projectRoot) {
        if (preparedDashboardProjectRoot !== null) {
            resetDotenv();
            preparedDashboardProjectRoot = null;
        }
        clearProjectRoot();
        return;
    }
    try {
        if (preparedDashboardProjectRoot !== null && preparedDashboardProjectRoot !== projectRoot) {
            resetDotenv();
        }
        initProjectRoot(projectRoot);
        loadDotenv(projectRoot);
        preparedDashboardProjectRoot = projectRoot;
    } catch {
        // Best effort only. Dashboard status routes must remain available even if config loading fails.
    }
}

/**
 * Compute project-scoped graph counts from observations.
 * Active observation entities and their explicit cross-references are counted.
 */
function computeProjectGraphCounts(
    allEntities: Array<{ name: string }>,
    allRelations: Array<{ from: string; to: string }>,
    projectObs: Array<{ entityName?: string; relatedEntities?: string[]; status?: string }>,
): { entities: number; relations: number; entityNames: Set<string> } {
    const scoped = scopeKnowledgeGraphToProject({ entities: allEntities, relations: allRelations }, projectObs);
    return { entities: scoped.entities.length, relations: scoped.relations.length, entityNames: scoped.entityNames };
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
    projectRoot: string | null,
    projectResolved: boolean,
    mode: 'standalone' | 'control-plane' = 'standalone',
    port: number = 3210,
) {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    const apiPath = url.pathname.replace('/api', '');

    // Support ?project=xxx to switch view to another project
    // In flat storage, all projects share the same dataDir — only the projectId filter changes
    const requestedProject = url.searchParams.get('project');
    let effectiveDataDir = dataDir;
    let effectiveProjectId = projectId;
    let effectiveProjectName = projectName;
    let effectiveProjectRoot = projectRoot;
    let effectiveProjectResolved = projectResolved;
    if (requestedProject && requestedProject !== projectId) {
        effectiveDataDir = baseDir;  // flat storage: all data in one dir
        effectiveProjectId = requestedProject;
        effectiveProjectName = requestedProject.split('/').pop() || requestedProject;
        // Switched project is considered resolved (user selected it from known projects)
        effectiveProjectResolved = true;
        effectiveProjectRoot = null; // root unknown for switched project
    }

    prepareDashboardConfig(effectiveProjectRoot);

    try {
        switch (apiPath) {
            case '/maintenance/cleanup/preview':
            case '/maintenance/cleanup/execute':
            case '/maintenance/deduplicate/preview':
            case '/maintenance/deduplicate/execute':
            case '/maintenance/consolidate/preview':
            case '/maintenance/consolidate/execute':
            case '/maintenance/retention/preview':
            case '/maintenance/retention/execute': {
                await handleMaintenanceMutation(apiPath, req, res, {
                    dataDir: effectiveDataDir,
                    projectId: effectiveProjectId,
                    projectRoot: effectiveProjectRoot,
                });
                break;
            }

            case '/projects': {
                // List all unique project IDs from observations data (flat storage)
                // Deduplicate using alias registry – aliased IDs are merged under canonical
                try {
                    const allObs = filterReadableObservations(
                        await getObservationStore().loadAll(),
                        {},
                    ) as Array<{ projectId?: string; status?: string }>;
                    const projectSet = new Map<string, number>();
                    for (const obs of allObs) {
                        if (!isActiveStatus(obs.status)) continue;
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

                    // Classify projects as real/temporary/placeholder + dirty flag
                    const { classifyProjectId, isDirtyProjectId } = await import('./project-classification.js');

                    const projects = Array.from(mergedSet.entries())
                        .sort((a, b) => b[1] - a[1])  // Most observations first
                        .map(([id, count]) => ({
                            id,
                            name: id.split('/').pop() || id,
                            count,
                            isCurrent: id === projectId,
                            kind: classifyProjectId(id),
                            dirty: isDirtyProjectId(id),
                        }));
                    sendJson(res, projects);
                } catch {
                    sendJson(res, []);
                }
                break;
            }

            case '/project': {
                sendJson(res, {
                    id: effectiveProjectId,
                    name: effectiveProjectName,
                    resolved: effectiveProjectResolved,
                    rootPath: effectiveProjectRoot,
                    mode,
                    port,
                    mcpEndpoint: mode === 'control-plane' ? `http://127.0.0.1:${port}/mcp` : null,
                });
                break;
            }

            case '/graph': {
                await initGraphStore(effectiveDataDir);
                const gStore = getGraphStore();
                const graph = { entities: gStore.loadEntities(), relations: gStore.loadRelations() };
                const graphObs = filterDashboardObservations(
                    await getObservationStore().loadByProject(effectiveProjectId, { status: 'active' }),
                    effectiveProjectId,
                );
                const scoped = scopeKnowledgeGraphToProject(graph, graphObs);
                sendJson(res, { entities: scoped.entities, relations: scoped.relations });
                break;
            }

            case '/codegraph': {
                const { getCodeGraphDashboardStatus } = await import('../codegraph/dashboard.js');
                sendJson(res, await getCodeGraphDashboardStatus(effectiveDataDir, effectiveProjectId));
                break;
            }

            case '/observations': {
                const observations = filterDashboardObservations(
                    await getObservationStore().loadByProject(effectiveProjectId, { status: 'active' }),
                    effectiveProjectId,
                );
                sendJson(res, observations);
                break;
            }

            case '/evidence': {
                const observations = filterDashboardObservations(
                    await getObservationStore().loadByProject(effectiveProjectId, { status: 'active' }),
                    effectiveProjectId,
                );
                const evidenceStore = new EvidenceCardStore();
                await evidenceStore.init(effectiveDataDir);
                evidenceStore.syncObservations(observations);
                const query = url.searchParams.get('q') || '';
                const limit = Number(url.searchParams.get('limit') || 20);
                const cards = evidenceStore.list(effectiveProjectId, { limit: Math.min(100, Math.max(1, limit)) })
                    .filter((card) => !query || [card.title, card.summary, card.sourceRef, card.locator ?? ''].join(' ').toLowerCase().includes(query.toLowerCase()));
                sendJson(res, { cards, projectId: effectiveProjectId });
                break;
            }

            case '/sessions': {
                const allSessions = await getSessionStore().loadAll();
                const sessions = filterByProject(allSessions as Array<{ projectId?: string }>, effectiveProjectId);
                sendJson(res, sessions);
                break;
            }

            case '/stats': {
                await initGraphStore(effectiveDataDir);
                const graph = { entities: getGraphStore().loadEntities(), relations: getGraphStore().loadRelations() };
                const observations = filterDashboardObservations(
                    await getObservationStore().loadByProject(effectiveProjectId, { status: 'active' }),
                    effectiveProjectId,
                );
                const nextId = await getObservationStore().loadIdCounter();

                // Project-scoped graph counts (must match /api/graph and /api/export)
                const projectGraphCounts = computeProjectGraphCounts(graph.entities, graph.relations, observations);

                // Type counts (exclude probe -- operational heartbeats, not durable knowledge)
                const typeCounts: Record<string, number> = {};
                for (const obs of observations) {
                    const t = obs.type || 'unknown';
                    if (t === 'probe') continue;
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

                const retentionReferenceTime = new Date(now);
                const feedback = new MemoryFeedbackStore();
                await feedback.init(effectiveDataDir).catch(() => undefined);
                const retention = summarizeRetentionProjections(
                    observations
                        .filter((observation) => observation.type !== 'probe')
                        .map((observation) => projectObservationRetention(observation, {
                            referenceTime: retentionReferenceTime,
                            feedback: feedback.getState(effectiveProjectId, 'observation', String(observation.id)),
                        })),
                );
                const retentionSummary = {
                    active: retention.active,
                    stale: retention.stale,
                    archive: retention.archiveCandidates,
                    immune: retention.immune,
                };

                // Recent observations (last 10, exclude probe)
                const sorted = [...observations].filter(o => o.type !== 'probe')
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

                let maintenance = { total: 0, pending: 0, running: 0, retrying: 0, completed: 0, failed: 0 };
                let lifecycle: unknown;
                try {
                    const { MaintenanceJobStore } = await import('../runtime/maintenance-jobs.js');
                    maintenance = new MaintenanceJobStore(effectiveDataDir).summary(effectiveProjectId);
                    const { collectLifecycleDiagnostics } = await import('../runtime/lifecycle-status.js');
                    lifecycle = await collectLifecycleDiagnostics({
                        dataDir: effectiveDataDir,
                        projectId: effectiveProjectId,
                    });
                } catch { /* optional maintenance diagnostics */ }

                sendJson(res, {
                    entities: projectGraphCounts.entities,
                    relations: projectGraphCounts.relations,
                    observations: observations.length,
                    nextId,
                    typeCounts,
                    sourceCounts,
                    recentObservations: sorted,
                    embedding: embeddingStatus,
                    // A standalone dashboard has no access to an active MCP
                    // process's in-memory Orama index. Keep this explicit so the
                    // UI never presents an empty local singleton as a healthy
                    // all-vectors-indexed result.
                    vectorStatus: {
                        available: false,
                        total: 0,
                        missing: 0,
                        missingIds: [],
                        backfillRunning: false,
                    },
                    storage: storageInfo,
                    maintenance,
                    ...(lifecycle ? { lifecycle } : {}),
                    gitSummary: {
                        total: gitMemories.length,
                        recentWeek: recentGitCount,
                        recentMemories: recentGitMemories,
                    },
                    retentionSummary,
                });
                break;
            }

            case '/maintenance': {
                const [{ MaintenanceJobStore }, { collectLifecycleDiagnostics }] = await Promise.all([
                    import('../runtime/maintenance-jobs.js'),
                    import('../runtime/lifecycle-status.js'),
                ]);
                const jobs = new MaintenanceJobStore(effectiveDataDir).list({
                    projectId: effectiveProjectId,
                    limit: 50,
                });
                sendJson(res, {
                    summary: new MaintenanceJobStore(effectiveDataDir).summary(effectiveProjectId),
                    jobs,
                    lifecycle: await collectLifecycleDiagnostics({
                        dataDir: effectiveDataDir,
                        projectId: effectiveProjectId,
                    }),
                });
                break;
            }

            case '/retention': {
                const observations = filterDashboardObservations(
                    await getObservationStore().loadByProject(effectiveProjectId, { status: 'active' }),
                    effectiveProjectId,
                );

                const referenceTime = new Date();
                const feedback = new MemoryFeedbackStore();
                await feedback.init(effectiveDataDir).catch(() => undefined);
                const rows = observations
                    .filter((observation) => observation.type !== 'probe')
                    .map((observation) => ({
                        observation,
                        retention: projectObservationRetention(observation, {
                            referenceTime,
                            feedback: feedback.getState(effectiveProjectId, 'observation', String(observation.id)),
                        }),
                    }))
                    .sort((a, b) => b.retention.displayScore - a.retention.displayScore);
                const summary = summarizeRetentionProjections(rows.map((row) => row.retention));
                const scored = rows.map(({ observation, retention }) => ({
                    id: observation.id,
                    title: observation.title,
                    type: observation.type,
                    entityName: observation.entityName,
                    score: retention.displayScore,
                    isImmune: retention.immune,
                    zone: retention.zone,
                    ageHours: retention.ageHours,
                    accessCount: retention.accessCount,
                    effectiveRetentionDays: retention.effectiveRetentionDays,
                    immunityReason: retention.immunityReason,
                }));

                sendJson(res, {
                    summary: {
                        active: summary.active,
                        stale: summary.stale,
                        archive: summary.archiveCandidates,
                        immune: summary.immune,
                    },
                    items: scored,
                });
                break;
            }

            case '/knowledge': {
                const { generateKnowledgeBase } = await import('../wiki/generator.js');
                const { initMiniSkillStore, getMiniSkillStore } = await import('../store/mini-skill-store.js');

                await initMiniSkillStore(effectiveDataDir);

                const allObs = filterDashboardObservations(
                    await getObservationStore().loadByProject(effectiveProjectId, { status: 'active' }),
                    effectiveProjectId,
                );
                const skills = await getMiniSkillStore().loadByProject(effectiveProjectId);

                const overview = generateKnowledgeBase({
                    projectId: effectiveProjectId,
                    observations: allObs,
                    miniSkills: skills,
                });

                sendJson(res, overview);
                break;
            }

            case '/knowledge-graph': {
                const { generateKnowledgeGraph } = await import('../wiki/knowledge-graph.js');
                const { initMiniSkillStore, getMiniSkillStore } = await import('../store/mini-skill-store.js');
                const { initGraphStore, getGraphStore } = await import('../store/graph-store.js');

                await initMiniSkillStore(effectiveDataDir);
                await initGraphStore(effectiveDataDir);

                const allObs = filterDashboardObservations(
                    await getObservationStore().loadByProject(effectiveProjectId, { status: 'active' }),
                    effectiveProjectId,
                );
                const skills = await getMiniSkillStore().loadByProject(effectiveProjectId);

                const fullGraph = { entities: getGraphStore().loadEntities(), relations: getGraphStore().loadRelations() };
                const scoped = scopeKnowledgeGraphToProject(fullGraph, allObs);

                const graph = generateKnowledgeGraph({
                    projectId: effectiveProjectId,
                    observations: allObs,
                    miniSkills: skills,
                    graphEntities: scoped.entities,
                    graphRelations: scoped.relations,
                });

                sendJson(res, graph);
                break;
            }

            case '/config': {
                // Config provenance — shows where each config value comes from
                const os = await import('node:os');
                const { existsSync } = await import('node:fs');
                const { join } = await import('node:path');

                // Use the real project root from dashboard state, not process.cwd()
                const configProjectRoot = effectiveProjectRoot;
                // This is the same TOML-first chain used by status and runtime lanes.
                // Do not fall back to user config if a bound project cannot resolve.
                const resolved = getResolvedConfig({ projectRoot: configProjectRoot });

                // Check which config files exist
                const files: Record<string, { exists: boolean; path: string; unavailable?: boolean }> = {
                    'project memorix.yml': { exists: false, path: '', unavailable: !configProjectRoot },
                    'user memorix.yml': { exists: false, path: '' },
                    'project memorix.toml': { exists: false, path: '', unavailable: !configProjectRoot },
                    'user config.toml': { exists: false, path: '' },
                    'project .env': { exists: false, path: '', unavailable: !configProjectRoot },
                    'user .env': { exists: false, path: '' },
                    'legacy config.json': { exists: false, path: '' },
                };
                try {
                    const home = os.homedir();
                    const paths: Record<string, string | null> = {
                        'project memorix.yml': configProjectRoot ? join(configProjectRoot, 'memorix.yml') : null,
                        'user memorix.yml': join(home, '.memorix', 'memorix.yml'),
                        'project memorix.toml': configProjectRoot ? join(configProjectRoot, 'memorix.toml') : null,
                        'user config.toml': join(home, '.memorix', 'config.toml'),
                        'project .env': configProjectRoot ? join(configProjectRoot, '.env') : null,
                        'user .env': join(home, '.memorix', '.env'),
                        'legacy config.json': join(home, '.memorix', 'config.json'),
                    };
                    for (const [key, fpath] of Object.entries(paths)) {
                        if (fpath === null) {
                            files[key] = { exists: false, path: 'unavailable', unavailable: true };
                        } else {
                            files[key] = { exists: existsSync(fpath), path: fpath };
                        }
                    }
                } catch { /* best effort */ }

                // Config values with provenance
                const values: Array<{ key: string; value: string; source: string; sensitive?: boolean }> = [];

                // LLM
                const tomlSource = configProjectRoot && files['project memorix.toml'].exists
                    ? 'memorix.toml'
                    : files['user config.toml'].exists ? 'config.toml' : 'default';
                const legacySource = files['project memorix.yml'].exists || files['user memorix.yml'].exists
                    ? 'memorix.yml'
                    : files['legacy config.json'].exists ? 'config.json' : 'default';
                const configSource = resolved.sources.toml.length > 0 ? tomlSource
                    : resolved.sources.legacy.length > 0 ? legacySource : 'default';
                const source = (envKey: string): string => resolveDashboardKeySource({
                    value: process.env[envKey] ?? '',
                    envKeys: [envKey],
                    configSource,
                });

                if (resolved.memory.llm.provider) values.push({ key: 'llm.provider', value: resolved.memory.llm.provider, source: source('MEMORIX_LLM_PROVIDER') });

                if (resolved.memory.llm.model) values.push({ key: 'llm.model', value: resolved.memory.llm.model, source: source('MEMORIX_LLM_MODEL') });

                const llmKey = resolved.memory.llm.apiKey;
                const memoryKeyEnv = [
                    'MEMORIX_LLM_API_KEY',
                    'MEMORIX_API_KEY',
                    'OPENAI_API_KEY',
                    'ANTHROPIC_API_KEY',
                    ...(resolved.memory.llm.provider === 'openrouter' || resolved.memory.llm.baseUrl?.includes('openrouter.ai')
                        ? ['OPENROUTER_API_KEY']
                        : []),
                ];
                if (llmKey) {
                    const src = resolveDashboardKeySource({ value: llmKey, envKeys: memoryKeyEnv, configSource });
                    values.push({ key: 'llm.apiKey', value: '****' + llmKey.slice(-4), source: src, sensitive: true });
                } else {
                    values.push({ key: 'llm.apiKey', value: 'not set', source: 'none' });
                }

                if (resolved.agent.provider) {
                    values.push({ key: 'agent.provider', value: resolved.agent.provider, source: source('MEMORIX_AGENT_PROVIDER') });
                }

                if (resolved.agent.model) {
                    values.push({ key: 'agent.model', value: resolved.agent.model, source: source('MEMORIX_AGENT_MODEL') });
                }

                const agentKey = resolved.agent.apiKey;
                if (agentKey) {
                    const src = resolveDashboardKeySource({
                        value: agentKey,
                        envKeys: ['MEMORIX_AGENT_API_KEY', 'MEMORIX_AGENT_LLM_API_KEY'],
                        configSource,
                    });
                    values.push({ key: 'agent.apiKey', value: '****' + agentKey.slice(-4), source: src, sensitive: true });
                } else {
                    values.push({
                        key: 'agent.apiKey',
                        value: 'fallback to llm.apiKey',
                        source: llmKey
                            ? resolveDashboardKeySource({ value: llmKey, envKeys: memoryKeyEnv, configSource })
                            : 'default',
                    });
                }

                // Embedding
                values.push({ key: 'embedding.provider', value: resolved.embedding.provider || 'off', source: source('MEMORIX_EMBEDDING') });
                if (resolved.embedding.model) values.push({ key: 'embedding.model', value: resolved.embedding.model, source: source('MEMORIX_EMBEDDING_MODEL') });

                if (resolved.rerank.provider !== 'off') {
                    values.push({ key: 'rerank.provider', value: resolved.rerank.provider, source: source('MEMORIX_RERANK_PROVIDER') });
                    if (resolved.rerank.model) values.push({ key: 'rerank.model', value: resolved.rerank.model, source: source('MEMORIX_RERANK_MODEL') });
                }

                // Git
                values.push({ key: 'git.autoHook', value: String(resolved.git.autoHook ?? false), source: configSource });
                values.push({ key: 'git.skipMergeCommits', value: String(resolved.git.skipMergeCommits ?? true), source: configSource });

                // Server
                values.push({ key: 'server.transport', value: resolved.server.transport || 'stdio', source: configSource });
                values.push({ key: 'server.dashboard', value: String(resolved.server.dashboard ?? true), source: configSource });

                sendJson(res, { files, values });
                break;
            }

            case '/identity': {
                // Project identity health — with classification layering (matches control-plane contract)
                const allObs = filterReadableObservations(await getObservationStore().loadAll(), {}) as Array<{ projectId?: string }>;
                const allProjectIds = [...new Set(allObs.map(o => o.projectId).filter(Boolean))] as string[];

                // Classify every known ID (real / temporary / placeholder) + dirty axis
                let classifyProjectId: (id: string) => string = () => 'real';
                let isDirtyProjectId: (id: string) => boolean = () => false;
                try {
                    const cls = await import('../dashboard/project-classification.js');
                    classifyProjectId = cls.classifyProjectId;
                    isDirtyProjectId = cls.isDirtyProjectId;
                } catch { /* classification module not available */ }

                const classified = allProjectIds.map(id => ({
                    id,
                    kind: classifyProjectId(id),
                    dirty: isDirtyProjectId(id),
                    isCurrent: id === effectiveProjectId,
                }));

                const realIds = classified.filter(c => c.kind === 'real').map(c => c.id);
                const temporaryIds = classified.filter(c => c.kind === 'temporary').map(c => c.id);
                const placeholderIds = classified.filter(c => c.kind === 'placeholder').map(c => c.id);
                const dirtyIds = classified.filter(c => c.dirty).map(c => c.id);

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

                // Alias groups intersecting real (non-temporary, non-placeholder) IDs
                const realIdSet = new Set(realIds);
                const aliasGroupsReal = aliasGroups.filter((g: any) => {
                    const members = [g.canonical, ...(g.aliases || [])].filter(Boolean);
                    return members.some((m: string) => realIdSet.has(m));
                }).length;

                // Current project dirty flag
                const currentDirty = isDirtyProjectId(effectiveProjectId);
                // Unmerged real fragments = real IDs not covered by any alias group
                const aliasCoveredReal = new Set<string>();
                for (const g of aliasGroups) {
                    for (const m of [g.canonical, ...(g.aliases || [])]) {
                        if (m && realIdSet.has(m)) aliasCoveredReal.add(m);
                    }
                }
                const unmergedRealFragments = realIds.filter(id => !aliasCoveredReal.has(id));
                const hasMultipleUnmerged = unmergedRealFragments.length > 1;
                const isHealthy = !currentDirty && !hasMultipleUnmerged;

                sendJson(res, {
                    currentProjectId: effectiveProjectId,
                    canonicalId,
                    aliases,
                    currentKind: classifyProjectId(effectiveProjectId),
                    currentDirty,
                    // Primary counts — the ones UI should headline
                    realKnownIds: realIds,
                    // De-emphasized / historical
                    temporaryKnownIds: temporaryIds,
                    placeholderKnownIds: placeholderIds,
                    // Back-compat: full list for legacy consumers
                    allProjectIds,
                    dirtyIds,
                    // Alias registry: both raw count and real-scoped count
                    aliasGroups: aliasGroups.length,
                    aliasGroupsReal,
                    unmergedRealFragments,
                    isHealthy,
                    healthIssues: [
                        ...(currentDirty ? ['Current project ID is dirty (broken canonical)'] : []),
                        ...(hasMultipleUnmerged ? [`${unmergedRealFragments.length} unmerged real project fragments detected`] : []),
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
                    const matchObs = await obsStore.getById(obsId);
                    if (!matchObs) {
                        sendError(res, 'Observation not found', 404);
                    } else if (matchObs.projectId !== effectiveProjectId) {
                        // Cross-project deletion guard: reject if obs belongs to a different project
                        sendError(res, `Observation #${obsId} belongs to project "${matchObs.projectId}", not "${effectiveProjectId}"`, 403);
                    } else if (!canManageObservation(matchObs, { projectId: effectiveProjectId })) {
                        sendError(res, `Observation #${obsId} is not manageable from the unbound dashboard.`, 403);
                    } else {
                        await obsStore.remove(obsId);

                        // Sync: clean up graph entity references for this observation
                        try {
                            await initGraphStore(effectiveDataDir);
                            const gStore = getGraphStore();
                            const prefix = `[#${obsId}] `;
                            const deletions: { entityName: string; observations: string[] }[] = [];
                            for (const entity of gStore.loadEntities()) {
                                const toRemove = entity.observations.filter((o: string) => o.startsWith(prefix));
                                if (toRemove.length > 0) deletions.push({ entityName: entity.name, observations: toRemove });
                            }
                            if (deletions.length > 0) gStore.deleteObservations(deletions);
                        } catch { /* graph sync is best-effort */ }

                        sendJson(res, { ok: true, deleted: obsId });
                    }
                    break;
                }

                if (apiPath === '/export') {
                    await initGraphStore(effectiveDataDir);
                    const fullGraph = { entities: getGraphStore().loadEntities(), relations: getGraphStore().loadRelations() };
                    const observations = filterDashboardObservations(
                        await getObservationStore().loadByProject(effectiveProjectId, { status: 'active' }),
                        effectiveProjectId,
                    );
                    const nextId = await getObservationStore().loadIdCounter();
                    const scoped = scopeKnowledgeGraphToProject(fullGraph, observations);
                    const exportData = {
                        project: { id: effectiveProjectId, name: effectiveProjectName },
                        exportedAt: new Date().toISOString(),
                        graph: { entities: scoped.entities, relations: scoped.relations },
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
        const status = err instanceof DashboardMaintenanceError ? err.status : 500;
        sendError(res, message, status);
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
            'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
            'Pragma': 'no-cache',
            'Expires': '0',
        });
        res.end(data);
    } catch {
        // Fallback to index.html for SPA routing
        try {
            const indexData = await fs.readFile(path.join(staticDir, 'index.html'));
            res.writeHead(200, {
                'Content-Type': 'text/html; charset=utf-8',
                'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
                'Pragma': 'no-cache',
                'Expires': '0',
            });
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
    exec(cmd, { windowsHide: true }, () => { /* ignore errors */ });
}

/** Mutable dashboard state — updated at runtime when project changes */
interface DashboardState {
    projectId: string;
    projectName: string;
    dataDir: string;
    projectRoot: string | null;
    projectResolved: boolean;
    mode: 'standalone';
    port: number;
}

function parseJsonField(value: unknown, fallback: unknown): unknown {
    if (typeof value !== 'string') return value ?? fallback;
    try {
        return JSON.parse(value || JSON.stringify(fallback));
    } catch {
        return fallback;
    }
}

function normalizeDashboardAgent(teamStore: TeamStore, projectId: string, agent: any) {
    const id = agent.agent_id ?? agent.id ?? '';
    const agentProjectId = agent.project_id ?? agent.projectId ?? projectId;
    return {
        id,
        projectId: agentProjectId,
        instanceId: agent.instance_id ?? agent.instanceId,
        agentType: agent.agent_type ?? agent.agentType,
        name: agent.name,
        role: agent.role,
        capabilities: parseJsonField(agent.capabilities, []),
        status: agent.status,
        joinedAt: agent.joined_at ?? agent.joinedAt,
        lastSeenAt: agent.last_heartbeat ?? agent.last_seen_at ?? agent.lastSeenAt,
        leftAt: agent.left_at ?? agent.leftAt,
        unread: id ? teamStore.getUnreadCount(agentProjectId, id) : 0,
        source: agent.source || 'sqlite',
    };
}

function normalizeDashboardLock(lock: any) {
    return {
        file: lock.file,
        projectId: lock.project_id ?? lock.projectId,
        lockedBy: lock.locked_by ?? lock.lockedBy,
        lockedAt: lock.locked_at ?? lock.lockedAt,
        expiresAt: lock.expires_at ?? lock.expiresAt,
    };
}

function normalizeDashboardTask(task: any) {
    return {
        id: task.task_id ?? task.id,
        projectId: task.project_id ?? task.projectId,
        description: task.description,
        status: task.status,
        assignee: task.assignee_agent_id ?? task.assignee,
        result: task.result,
        metadata: parseJsonField(task.metadata, null),
        createdBy: task.created_by ?? task.createdBy,
        createdAt: task.created_at ?? task.createdAt,
        updatedAt: task.updated_at ?? task.updatedAt,
        deps: task.deps || [],
        requiredRole: task.required_role ?? task.requiredRole ?? null,
        preferredRole: task.preferred_role ?? task.preferredRole ?? null,
    };
}

type TeamSnapshotStatus = 'ok' | 'degraded' | 'error';

interface TeamSnapshot {
    status: TeamSnapshotStatus;
    mode: DashboardState['mode'];
    readOnly: true;
    scope: string;
    agents: any[];
    activeCount: number;
    recentCount: number;
    historicalCount: number;
    totalAgents: number;
    recentWindowDays: number;
    locks: any[];
    tasks: any[];
    availableTasks: number;
    sessions: number;
    roles: any[];
    roleOccupancy: any[];
    handoffs: any[];
    openTasks: number;
    openHandoffs: number;
    totalUnread: number;
    activeSessions: number;
    error?: string;
    errorCode?: string;
}

function emptyTeamSnapshot(
    mode: DashboardState['mode'],
    scope: string,
    status: Exclude<TeamSnapshotStatus, 'ok'>,
): TeamSnapshot {
    return {
        status,
        mode,
        readOnly: true,
        scope,
        agents: [],
        activeCount: 0,
        recentCount: 0,
        historicalCount: 0,
        totalAgents: 0,
        recentWindowDays: 7,
        locks: [],
        tasks: [],
        availableTasks: 0,
        sessions: 0,
        roles: [],
        roleOccupancy: [],
        handoffs: [],
        openTasks: 0,
        openHandoffs: 0,
        totalUnread: 0,
        activeSessions: 0,
        error: status === 'error' ? 'Coordination state unavailable' : 'Coordination state is incomplete',
        errorCode: status === 'error' ? 'COORDINATION_STATE_UNAVAILABLE' : 'COORDINATION_STATE_DEGRADED',
    };
}

function logTeamSnapshotFailure(scope: string, status: Exclude<TeamSnapshotStatus, 'ok'>): void {
    const safeScope = scope === 'global' ? 'global' : 'project';
    console.error('[dashboard] coordination snapshot unavailable', { status, scope: safeScope });
}

async function buildTeamSnapshot(dataDir: string, projectId: string, scope: string, mode: DashboardState['mode']): Promise<TeamSnapshot> {
    try {
        const { initTeamStore } = await import('../team/team-store.js');
        const teamStore = await initTeamStore(dataDir);
        const effectiveProjectId = scope === 'global' ? undefined : projectId;
        const rawAgents = effectiveProjectId ? teamStore.listAgents(effectiveProjectId) : teamStore.listAllAgents();
        const rawLocks = effectiveProjectId ? teamStore.listLocks(effectiveProjectId) : teamStore.listAllLocks();
        const rawTasks = effectiveProjectId ? teamStore.listTasks(effectiveProjectId) : teamStore.listAllTasks();
        const available = effectiveProjectId ? teamStore.listTasks(effectiveProjectId, { available: true }) : teamStore.listAllTasks({ available: true });
        const agents = rawAgents.map((agent: any) => normalizeDashboardAgent(teamStore, projectId, agent));
        const locks = rawLocks.map(normalizeDashboardLock);
        const tasks = rawTasks.map(normalizeDashboardTask);
        const recentWindowMs = 7 * 24 * 60 * 60 * 1000;
        const now = Date.now();
        const withTier = agents.map((agent: any) => {
            if (agent.status === 'active') return { ...agent, activityTier: 'active' };
            const seen = Date.parse(agent.lastSeenAt ?? '') || 0;
            return { ...agent, activityTier: now - seen <= recentWindowMs ? 'recent' : 'historical' };
        });
        const activeCount = withTier.filter((agent: any) => agent.activityTier === 'active').length;
        const recentCount = withTier.filter((agent: any) => agent.activityTier === 'recent').length;
        const historicalCount = withTier.filter((agent: any) => agent.activityTier === 'historical').length;
        const roles = effectiveProjectId ? teamStore.listRoles(effectiveProjectId) : [];
        const roleOccupancy = effectiveProjectId ? teamStore.getRoleOccupancy(effectiveProjectId) : [];
        const handoffs = effectiveProjectId ? teamStore.listHandoffs(effectiveProjectId) : [];
        return {
            status: 'ok',
            mode,
            readOnly: true,
            scope,
            agents: withTier,
            activeCount,
            recentCount,
            historicalCount,
            totalAgents: withTier.length,
            recentWindowDays: 7,
            locks,
            tasks,
            availableTasks: available.length,
            sessions: 0,
            roles,
            roleOccupancy,
            handoffs,
            openTasks: tasks.filter((task: any) => task.status === 'pending' || task.status === 'in_progress').length,
            openHandoffs: handoffs.filter((handoff: any) => handoff.handoff_status === 'open' || handoff.handoffStatus === 'open').length,
            totalUnread: withTier.reduce((sum: number, agent: any) => sum + (agent.unread || 0), 0),
            activeSessions: activeCount,
        };
    } catch {
        logTeamSnapshotFailure(scope, 'error');
        return emptyTeamSnapshot(mode, scope, 'error');
    }
}

/** Read full POST body as string */
function readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        let size = 0;
        req.on('data', (c: Buffer) => {
            size += c.length;
            if (size > 64 * 1024) {
                reject(new DashboardMaintenanceError('Request body is too large.', 413));
                return;
            }
            chunks.push(c);
        });
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
    projectRoot: string | null = null,
    projectResolved = true,
): Promise<void> {
    await initObservationStore(dataDir);
    await initSessionStore(dataDir);
    const resolvedStaticDir = staticDir;
    // Derive baseDir from dataDir (parent directory of project-specific dir)
    const baseDir = getBaseDataDir();

    // Mutable state — can be updated via /api/set-current-project
    const state: DashboardState = { projectId, projectName, dataDir, projectRoot, projectResolved, mode: 'standalone', port };

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
                    state.projectRoot = body.projectRoot || null;
                    state.projectResolved = body.projectResolved ?? (body.projectId !== '__unresolved__');
                    console.error(`[dashboard] Switched current project to: ${state.projectId} (resolved: ${state.projectResolved})`);
                    sendJson(res, { ok: true, projectId: state.projectId, projectName: state.projectName, resolved: state.projectResolved });
                } else {
                    sendError(res, 'Missing projectId in body', 400);
                }
            } catch {
                sendError(res, 'Invalid JSON body', 400);
            }
            return;
        }

        const parsedUrl = new URL(url, `http://127.0.0.1:${port}`);
        if (parsedUrl.pathname === '/api/team') {
            if (req.method !== 'GET') {
                sendJson(res, {
                    status: 'error',
                    readOnly: true,
                    error: 'Coordination status is read-only',
                    errorCode: 'COORDINATION_STATUS_READ_ONLY',
                }, 405);
                return;
            }
            const scope = parsedUrl.searchParams.get('scope') || 'project';
            const snapshot = await buildTeamSnapshot(state.dataDir, state.projectId, scope, state.mode);
            sendJson(res, snapshot, snapshot.status === 'error' ? 503 : 200);
            return;
        }

        if (url.startsWith('/api/')) {
            await handleApi(req, res, state.dataDir, state.projectId, state.projectName, baseDir, state.projectRoot, state.projectResolved, state.mode, state.port);
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

        server.listen(port, '127.0.0.1', () => {
            const url = `http://127.0.0.1:${port}`;
            const resolvedLabel = projectResolved ? 'resolved' : 'unresolved';
            const modeLabel = 'Standalone';
            console.error(`  Memorix Dashboard [${modeLabel}]`);
            console.error(`  ───────────────────────`);
            console.error(`  Mode:     ${modeLabel}`);
            console.error(`  Project:  ${projectName} (${projectId}) [${resolvedLabel}]`);
            console.error(`  Local:    ${url}`);
            console.error(`  Data dir: ${dataDir}`);
            console.error(`\n  Press Ctrl+C to stop\n`);
            if (autoOpen) openBrowser(url);
            resolve();
        });
    });
}
