import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { getResolvedConfig } from '../config/resolved-config.js';
import { buildTaskWorkset, type TaskWorkset } from '../knowledge/workset.js';
import type { ProjectInfo } from '../types.js';
import { backfillMissingObservationCodeRefs, type CodeRefBackfillResult } from './binder.js';
import { collectCurrentProjectFacts, type CurrentProjectFacts } from './current-facts.js';
import { refreshProjectLite } from './lite-provider.js';
import {
  buildProjectContextExplain,
  type ProjectContextExplain,
  type ProjectContextObservation,
  type ProjectContextOverview,
} from './project-context.js';
import { CodeGraphStore } from './store.js';
import {
  lensPathCandidates,
  lensVerificationHints,
  rankLensPaths,
  rankLensSources,
  resolveTaskLens,
  shouldShowLensSource,
  type TaskLens,
} from './task-lens.js';

export type AutoContextRefreshMode = 'auto' | 'always' | 'never';

export interface AutoContextRefreshResult {
  mode: AutoContextRefreshMode;
  performed: boolean;
  reason: 'forced' | 'empty-index' | 'missing-scan-time' | 'stale-index' | 'fresh-enough' | 'disabled' | 'queued' | 'failed';
  message: string;
  backfill?: CodeRefBackfillResult;
}

export interface AutoProjectContext {
  project: Pick<ProjectInfo, 'id' | 'name' | 'rootPath'>;
  task?: string;
  lens: TaskLens;
  currentFacts: CurrentProjectFacts;
  overview: ProjectContextOverview;
  explain: ProjectContextExplain;
  refresh: AutoContextRefreshResult;
  workset: TaskWorkset;
}

export interface AutoProjectBrief {
  lens: TaskLens['id'];
  lensDescription: string;
  startHere: string[];
  reliableMemoryIds: number[];
  visibleCautionIds: number[];
  hiddenReliableCount: number;
  hiddenCautionCount: number;
  suggestedVerification: string[];
}

const DEFAULT_MAX_AGE_MS = 10 * 60 * 1000;

function activeProjectObservations(
  observations: ProjectContextObservation[],
  projectId: string,
): ProjectContextObservation[] {
  return observations.filter(obs => obs.projectId === projectId && (obs.status ?? 'active') === 'active');
}

function decideRefresh(input: {
  mode: AutoContextRefreshMode;
  status: ReturnType<CodeGraphStore['status']>;
  maxAgeMs: number;
  nowMs: number;
}): Pick<AutoContextRefreshResult, 'performed' | 'reason' | 'message'> {
  if (input.mode === 'never') {
    return { performed: false, reason: 'disabled', message: 'Automatic project scan disabled.' };
  }
  if (input.mode === 'always') {
    return { performed: true, reason: 'forced', message: 'Project scan refreshed on request.' };
  }
  if (input.status.files === 0) {
    return { performed: true, reason: 'empty-index', message: 'Project scan created because no code memory existed yet.' };
  }
  if (!input.status.indexedAt) {
    return { performed: true, reason: 'missing-scan-time', message: 'Project scan refreshed because scan time was missing.' };
  }

  const indexedAtMs = Date.parse(input.status.indexedAt);
  if (!Number.isFinite(indexedAtMs)) {
    return { performed: true, reason: 'missing-scan-time', message: 'Project scan refreshed because scan time was unreadable.' };
  }
  if (input.nowMs - indexedAtMs > input.maxAgeMs) {
    return { performed: true, reason: 'stale-index', message: 'Project scan refreshed because code memory was stale.' };
  }

  return { performed: false, reason: 'fresh-enough', message: 'Existing project scan is fresh enough.' };
}

export async function buildAutoProjectContext(input: {
  project: Pick<ProjectInfo, 'id' | 'name' | 'rootPath'>;
  dataDir: string;
  observations: ProjectContextObservation[];
  task?: string;
  refresh?: AutoContextRefreshMode;
  maxAgeMs?: number;
  now?: Date;
  exclude?: string[];
  maxFileBytes?: number;
  /**
   * When supplied, a needed refresh is queued instead of running in this
   * request. MCP and hook callers use this to keep their response path fast.
   */
  enqueueRefresh?: () => void | Promise<void>;
}): Promise<AutoProjectContext> {
  const refreshMode = input.refresh ?? 'auto';
  const now = input.now ?? new Date();
  const task = input.task?.trim();
  const lens = resolveTaskLens(task);
  const codegraphConfig = getResolvedConfig({ projectRoot: input.project.rootPath }).codegraph;
  const exclude = input.exclude ?? codegraphConfig.excludePatterns;
  const maxFileBytes = input.maxFileBytes ?? codegraphConfig.maxFileBytes;
  const store = new CodeGraphStore();
  await store.init(input.dataDir);

  const initialStatus = store.status(input.project.id);
  const decision = decideRefresh({
    mode: refreshMode,
    status: initialStatus,
    maxAgeMs: input.maxAgeMs ?? DEFAULT_MAX_AGE_MS,
    nowMs: now.getTime(),
  });

  let refresh: AutoContextRefreshResult = {
    mode: refreshMode,
    ...decision,
  };

  if (decision.performed) {
    if (input.enqueueRefresh) {
      try {
        await input.enqueueRefresh();
        refresh = {
          mode: refreshMode,
          performed: false,
          reason: 'queued',
          message: 'Code Memory refresh queued; this brief uses the latest completed scan.',
        };
      } catch (error) {
        refresh = {
          mode: refreshMode,
          performed: false,
          reason: 'failed',
          message: `Could not queue Code Memory refresh: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    } else {
      try {
        await refreshProjectLite(store, {
          projectId: input.project.id,
          projectRoot: input.project.rootPath,
          exclude,
          maxFileBytes,
        });
        const backfill = await backfillMissingObservationCodeRefs(
          store,
          activeProjectObservations(input.observations, input.project.id) as any,
        );
        refresh = { ...refresh, backfill };
      } catch (error) {
        refresh = {
          mode: refreshMode,
          performed: false,
          reason: 'failed',
          message: `Project scan failed: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }
  }

  const explain = buildProjectContextExplain({
    project: input.project,
    store,
    observations: input.observations,
    exclude,
  });
  const overview = explain.overview;
  const currentFacts = collectCurrentProjectFacts({ project: input.project, now });
  const latestSnapshot = overview.code.latestSnapshot;
  const sourceSets = lensSourceSets({ task, lens, explain });
  const workset = await buildTaskWorkset({
    projectId: input.project.id,
    dataDir: input.dataDir,
    ...(task ? { task } : {}),
    lens: lens.id,
    startHere: rankLensPaths([
      ...existingLensCandidates(input.project.rootPath, lens),
      ...overview.suggestedReads,
    ], lens, task).slice(0, 5),
    currentFacts: worksetFactLines(currentFacts),
    codeState: codeStateLine(overview),
    reliableMemory: sourceSets.reliableSources
      .slice(0, lens.sourceLimit)
      .map(source => ({
        id: source.observationId,
        title: source.title,
        type: source.type,
        status: source.status,
        ...(source.path ? { path: source.path } : {}),
        ...(source.symbol ? { symbol: source.symbol } : {}),
      })),
    cautionMemory: sourceSets.cautionSources
      .slice(0, lens.cautionLimit)
      .map(source => ({
        id: source.observationId,
        title: source.title,
        type: source.type,
        status: source.status,
        ...(source.path ? { path: source.path } : {}),
        ...(source.symbol ? { symbol: source.symbol } : {}),
      })),
    hiddenCautionMemoryCount: sourceSets.hiddenCautionCount,
    verificationHints: lensVerificationHints(lens),
    worktreeDirty: currentFacts.git.dirty,
    ...(latestSnapshot
      ? {
        snapshot: {
          id: latestSnapshot.id,
          sourceEpoch: latestSnapshot.sourceEpoch,
          worktreeState: latestSnapshot.worktreeState,
          incomplete: latestSnapshot.completeness.skippedOversizedFiles > 0
            || latestSnapshot.completeness.removalScanDeferred,
        },
      }
      : {}),
    freshness: {
      suspect: overview.freshness.suspect,
      stale: overview.freshness.stale,
    },
  });

  return {
    project: input.project,
    ...(task ? { task } : {}),
    lens,
    currentFacts,
    overview,
    explain,
    refresh,
    workset,
  };
}

function formatLanguages(overview: ProjectContextOverview): string {
  return overview.code.languages.length > 0
    ? overview.code.languages.map(item => `${item.language} ${item.files}`).join(', ')
    : 'none indexed yet';
}

function codeStateLine(overview: ProjectContextOverview): string {
  const snapshot = overview.code.latestSnapshot;
  if (!snapshot) return '- Code state: no completed snapshot yet';
  const revision = snapshot.baseRevision ? snapshot.baseRevision.slice(0, 12) : 'Git unavailable';
  const scanState = snapshot.completeness.skippedOversizedFiles > 0 || snapshot.completeness.removalScanDeferred
    ? 'incomplete scan'
    : 'complete scan';
  return '- Code state: ' + revision
    + ', ' + snapshot.worktreeState + ' worktree'
    + ', ' + snapshot.changedPathCount + ' changed path(s)'
    + ', epoch ' + snapshot.sourceEpoch
    + ', ' + scanState;
}

function dedupeSourcesByObservation(
  sources: ProjectContextExplain['sources'],
): ProjectContextExplain['sources'] {
  const byObservation = new Map<number, ProjectContextExplain['sources'][number]>();
  for (const source of sources) {
    const existing = byObservation.get(source.observationId);
    if (!existing || (!existing.symbol && source.symbol)) {
      byObservation.set(source.observationId, source);
    }
  }
  return [...byObservation.values()];
}

function existingLensCandidates(rootPath: string, lens: TaskLens): string[] {
  const out: string[] = [];
  for (const candidate of lensPathCandidates(lens)) {
    const absolute = path.join(rootPath, candidate);
    try {
      if (!existsSync(absolute)) continue;
      const stat = statSync(absolute);
      if (stat.isFile()) out.push(candidate);
      if (stat.isDirectory()) out.push(candidate.replace(/\\/g, '/'));
    } catch {
      // Best-effort hints only; unreadable files should not break context.
    }
  }
  return out;
}

function rankedStartHere(context: AutoProjectContext, limit = 8): string[] {
  const candidates = [
    ...existingLensCandidates(context.project.rootPath, context.lens),
    ...context.overview.suggestedReads,
  ];
  return rankLensPaths(candidates, context.lens, context.task).slice(0, limit);
}

function lensLine(context: AutoProjectContext): string {
  return `Task lens: ${context.lens.id} - ${context.lens.description}`;
}

function lensSourceSets(context: Pick<AutoProjectContext, 'task' | 'lens' | 'explain'>): {
  reliableSources: ProjectContextExplain['sources'];
  cautionSources: ProjectContextExplain['sources'];
  hiddenReliableCount: number;
  hiddenCautionCount: number;
} {
  const allReliableSources = rankLensSources(
    dedupeSourcesByObservation(context.explain.sources.filter(source => source.status === 'current')),
    context.lens,
    context.task,
  );
  const reliableSources = context.lens.hideUnrelatedReliableDetails
    ? allReliableSources.filter(source => shouldShowLensSource(source, context.lens, context.task))
    : allReliableSources;
  const allCautionSources = rankLensSources(
    dedupeSourcesByObservation(context.explain.sources.filter(source => source.status !== 'current')),
    context.lens,
    context.task,
  );
  const cautionSources = context.lens.hideUnrelatedCautionDetails
    ? allCautionSources.filter(source => shouldShowLensSource(source, context.lens, context.task))
    : allCautionSources;

  return {
    reliableSources,
    cautionSources,
    hiddenReliableCount: allReliableSources.length - reliableSources.length,
    hiddenCautionCount: allCautionSources.length - cautionSources.length,
  };
}

export function buildAutoProjectBrief(context: AutoProjectContext): AutoProjectBrief {
  const { reliableSources, cautionSources, hiddenReliableCount, hiddenCautionCount } = lensSourceSets(context);
  return {
    lens: context.lens.id,
    lensDescription: context.lens.description,
    startHere: context.workset.startHere,
    reliableMemoryIds: reliableSources
      .slice(0, context.lens.sourceLimit)
      .map(source => source.observationId),
    visibleCautionIds: cautionSources
      .slice(0, context.lens.cautionLimit)
      .map(source => source.observationId),
    hiddenReliableCount,
    hiddenCautionCount,
    suggestedVerification: context.workset.verification,
  };
}

function formatCurrentFactsLines(facts: CurrentProjectFacts): string[] {
  const lines = ['Current project facts'];
  if (facts.packageVersion) lines.push(`- Package version: ${facts.packageVersion}`);
  if (facts.latestChangelog) {
    lines.push(`- Latest changelog: ${facts.latestChangelog.version}${facts.latestChangelog.date ? ` (${facts.latestChangelog.date})` : ''}`);
  }

  const gitParts: string[] = [];
  if (facts.git.detached) {
    gitParts.push('detached HEAD');
  } else if (facts.git.branch) {
    gitParts.push(`branch ${facts.git.branch}`);
  }
  if (facts.git.commit) gitParts.push(`commit ${facts.git.commit}`);
  gitParts.push(facts.git.dirty ? 'dirty worktree' : 'clean worktree');
  lines.push(`- Git: ${gitParts.join(', ')}`);
  if (facts.git.latestCommit) lines.push(`- Latest commit: ${facts.git.latestCommit}`);
  lines.push('- Current facts above outrank progress/dev-log files when they conflict.');

  if (facts.staleNotes.length > 0) {
    lines.push('', 'Historical/stale project notes');
    for (const note of facts.staleNotes.slice(0, 3)) {
      const details = [
        note.lastUpdated ? `last updated ${note.lastUpdated}` : undefined,
        note.branchHint ? `branch hint ${note.branchHint}` : undefined,
        note.reason,
      ].filter(Boolean).join('; ');
      lines.push(`- ${note.path}${details ? ` (${details})` : ''}; treat as historical unless the task specifically asks for it.`);
    }
  }

  return lines;
}

function worksetFactLines(facts: CurrentProjectFacts): string[] {
  const lines: string[] = [];
  if (facts.packageVersion) lines.push('Package version: ' + facts.packageVersion);
  if (facts.latestChangelog) {
    lines.push('Latest changelog: ' + facts.latestChangelog.version
      + (facts.latestChangelog.date ? ' (' + facts.latestChangelog.date + ')' : ''));
  }
  const gitParts: string[] = [];
  if (facts.git.branch) gitParts.push('branch ' + facts.git.branch);
  if (facts.git.commit) gitParts.push('commit ' + facts.git.commit);
  gitParts.push(facts.git.dirty ? 'dirty worktree' : 'clean worktree');
  lines.push('Git: ' + gitParts.join(', '));
  for (const note of facts.staleNotes.slice(0, 1)) {
    lines.push(
      'Historical note: ' + note.path
      + (note.branchHint ? ' (branch hint ' + note.branchHint + '; ' + note.reason + ')' : ' (' + note.reason + ')'),
    );
  }
  return lines;
}

export function formatAutoProjectContextSummary(context: AutoProjectContext): string {
  const reliableSources = rankLensSources(
    dedupeSourcesByObservation(context.explain.sources.filter(source => source.status === 'current')),
    context.lens,
    context.task,
  );
  const startHere = rankedStartHere(context);
  const lines = [
    `Memorix Autopilot Brief for ${context.project.name}`,
    context.task ? `Task: ${context.task}` : '',
    lensLine(context),
    '',
    ...formatCurrentFactsLines(context.currentFacts),
    '',
    `- Code memory: ${context.overview.code.files} files / ${context.overview.code.symbols} symbols / ${context.overview.code.refs} memory links`,
    `- Languages: ${formatLanguages(context.overview)}`,
    `- Memories: ${context.overview.memory.active} active / ${context.overview.memory.total} total`,
    `- Freshness: ${context.overview.freshness.current} current, ${context.overview.freshness.suspect} suspect, ${context.overview.freshness.stale} stale`,
    `- Refresh: ${context.refresh.message}`,
    '',
    'Start here',
  ].filter(Boolean);

  if (startHere.length > 0) {
    startHere.forEach((path, index) => lines.push(`${index + 1}. ${path}`));
  } else {
    lines.push('- no code-bound reads yet; inspect the task-relevant files directly');
  }

  lines.push(
    '',
    'Reliable memory',
    reliableSources.length > 0
      ? `- ${reliableSources.length} current code-bound memory link(s)`
      : '- none yet',
  );

  return lines.join('\n');
}

export function formatAutoProjectContextPrompt(context: AutoProjectContext): string {
  return context.workset.prompt;
}

export function formatLegacyAutoProjectContextPrompt(context: AutoProjectContext): string {
  const lines = [
    `Memorix Autopilot Brief for ${context.project.name}`,
    context.task ? `Task: ${context.task}` : '',
    lensLine(context),
    '',
    ...formatCurrentFactsLines(context.currentFacts),
    '',
    'Project state',
    codeStateLine(context.overview),
    `- Code memory: ${context.overview.code.files} files, ${context.overview.code.symbols} symbols, ${context.overview.code.refs} memory links`,
    `- Languages: ${formatLanguages(context.overview)}`,
    `- Memories: ${context.overview.memory.active} active / ${context.overview.memory.total} total`,
    `- Refresh: ${context.refresh.message}`,
    '',
    'Start here',
  ].filter(Boolean);

  const startHere = rankedStartHere(context);
  if (startHere.length === 0) {
    lines.push('- no code-bound reads yet; inspect the task-relevant code directly');
  } else {
    startHere.forEach((path, index) => lines.push(`${index + 1}. ${path}`));
  }

  const { reliableSources, cautionSources, hiddenReliableCount, hiddenCautionCount } = lensSourceSets(context);

  lines.push('', 'Reliable memory');
  if (reliableSources.length === 0) {
    lines.push('- none yet');
  } else {
    for (const source of reliableSources.slice(0, context.lens.sourceLimit)) {
      const location = source.path ? `${source.path}${source.symbol ? `#${source.symbol}` : ''}` : 'missing code location';
      lines.push(`- #${source.observationId} ${source.type}: ${source.title} (${location})`);
    }
  }
  if (hiddenReliableCount > 0) {
    lines.push(`- ${hiddenReliableCount} current memory link(s) hidden because they did not match this ${context.lens.id} task.`);
  }

  lines.push('', 'Verify before trusting');
  if (cautionSources.length === 0 && context.overview.freshness.suspect === 0 && context.overview.freshness.stale === 0) {
    lines.push('- no stale or suspect memory links detected');
  } else {
    lines.push(`- ${context.overview.freshness.suspect} suspect and ${context.overview.freshness.stale} stale memory link(s); verify current code before relying on them.`);
    if (hiddenCautionCount > 0) {
      lines.push('- Only task-relevant warning details are shown.');
    }
    for (const source of cautionSources.slice(0, context.lens.cautionLimit)) {
      const location = source.path ? `${source.path}${source.symbol ? `#${source.symbol}` : ''}` : 'missing code location';
      lines.push(`- #${source.observationId} ${source.status}: ${source.title} (${location})`);
    }
  }

  lines.push(
    '',
    'Suggested verification',
    ...lensVerificationHints(context.lens).map(hint => `- ${hint}`),
    '',
    'How to use this',
    '- Treat current code-bound memory as a map, not proof.',
    '- Store durable fixes, decisions, and gotchas after the work changes the project.',
  );
  return lines.join('\n');
}
