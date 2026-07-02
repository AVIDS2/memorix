import type { ProjectInfo } from '../types.js';
import { backfillMissingObservationCodeRefs, type CodeRefBackfillResult } from './binder.js';
import { collectCurrentProjectFacts, type CurrentProjectFacts } from './current-facts.js';
import { indexProjectLite } from './lite-provider.js';
import {
  buildProjectContextExplain,
  buildProjectContextOverview,
  type ProjectContextExplain,
  type ProjectContextObservation,
  type ProjectContextOverview,
} from './project-context.js';
import { CodeGraphStore } from './store.js';

export type AutoContextRefreshMode = 'auto' | 'always' | 'never';

export interface AutoContextRefreshResult {
  mode: AutoContextRefreshMode;
  performed: boolean;
  reason: 'forced' | 'empty-index' | 'missing-scan-time' | 'stale-index' | 'fresh-enough' | 'disabled' | 'failed';
  message: string;
  backfill?: CodeRefBackfillResult;
}

export interface AutoProjectContext {
  project: Pick<ProjectInfo, 'id' | 'name' | 'rootPath'>;
  task?: string;
  currentFacts: CurrentProjectFacts;
  overview: ProjectContextOverview;
  explain: ProjectContextExplain;
  refresh: AutoContextRefreshResult;
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
}): Promise<AutoProjectContext> {
  const refreshMode = input.refresh ?? 'auto';
  const now = input.now ?? new Date();
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
    try {
      const indexed = await indexProjectLite({
        projectId: input.project.id,
        projectRoot: input.project.rootPath,
      });
      store.replaceProjectIndex(input.project.id, indexed);
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

  const overview = buildProjectContextOverview({
    project: input.project,
    store,
    observations: input.observations,
  });
  const explain = buildProjectContextExplain({
    project: input.project,
    store,
    observations: input.observations,
  });

  return {
    project: input.project,
    ...(input.task?.trim() ? { task: input.task.trim() } : {}),
    currentFacts: collectCurrentProjectFacts({ project: input.project, now }),
    overview,
    explain,
    refresh,
  };
}

function formatLanguages(overview: ProjectContextOverview): string {
  return overview.code.languages.length > 0
    ? overview.code.languages.map(item => `${item.language} ${item.files}`).join(', ')
    : 'none indexed yet';
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

export function formatAutoProjectContextSummary(context: AutoProjectContext): string {
  const reliableSources = dedupeSourcesByObservation(context.explain.sources.filter(source => source.status === 'current'));
  const lines = [
    `Memorix Autopilot Brief for ${context.project.name}`,
    context.task ? `Task: ${context.task}` : '',
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

  if (context.overview.suggestedReads.length > 0) {
    context.overview.suggestedReads.slice(0, 8).forEach((path, index) => lines.push(`${index + 1}. ${path}`));
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
  const lines = [
    `Memorix Autopilot Brief for ${context.project.name}`,
    context.task ? `Task: ${context.task}` : '',
    '',
    ...formatCurrentFactsLines(context.currentFacts),
    '',
    'Project state',
    `- Code memory: ${context.overview.code.files} files, ${context.overview.code.symbols} symbols, ${context.overview.code.refs} memory links`,
    `- Languages: ${formatLanguages(context.overview)}`,
    `- Memories: ${context.overview.memory.active} active / ${context.overview.memory.total} total`,
    `- Refresh: ${context.refresh.message}`,
    '',
    'Start here',
  ].filter(Boolean);

  if (context.overview.suggestedReads.length === 0) {
    lines.push('- no code-bound reads yet; inspect the task-relevant code directly');
  } else {
    context.overview.suggestedReads.slice(0, 8).forEach((path, index) => lines.push(`${index + 1}. ${path}`));
  }

  const reliableSources = dedupeSourcesByObservation(context.explain.sources.filter(source => source.status === 'current'));
  const cautionSources = dedupeSourcesByObservation(context.explain.sources.filter(source => source.status !== 'current'));

  lines.push('', 'Reliable memory');
  if (reliableSources.length === 0) {
    lines.push('- none yet');
  } else {
    for (const source of reliableSources.slice(0, 8)) {
      const location = source.path ? `${source.path}${source.symbol ? `#${source.symbol}` : ''}` : 'missing code location';
      lines.push(`- #${source.observationId} ${source.type}: ${source.title} (${location})`);
    }
  }

  lines.push('', 'Verify before trusting');
  if (cautionSources.length === 0 && context.overview.freshness.suspect === 0 && context.overview.freshness.stale === 0) {
    lines.push('- no stale or suspect memory links detected');
  } else {
    lines.push(`- ${context.overview.freshness.suspect} suspect and ${context.overview.freshness.stale} stale memory link(s); verify current code before relying on them.`);
    for (const source of cautionSources.slice(0, 5)) {
      const location = source.path ? `${source.path}${source.symbol ? `#${source.symbol}` : ''}` : 'missing code location';
      lines.push(`- #${source.observationId} ${source.status}: ${source.title} (${location})`);
    }
  }

  lines.push(
    '',
    'Suggested verification',
    '- inspect the Start here files before editing',
    '- run the smallest relevant test or smoke command after changes',
    '',
    'How to use this',
    '- Treat current code-bound memory as a map, not proof.',
    '- Store durable fixes, decisions, and gotchas after the work changes the project.',
  );
  return lines.join('\n');
}
