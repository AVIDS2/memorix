import type { ProjectInfo } from '../types.js';
import { backfillMissingObservationCodeRefs, type CodeRefBackfillResult } from './binder.js';
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
  const store = new CodeGraphStore();
  await store.init(input.dataDir);

  const initialStatus = store.status(input.project.id);
  const decision = decideRefresh({
    mode: refreshMode,
    status: initialStatus,
    maxAgeMs: input.maxAgeMs ?? DEFAULT_MAX_AGE_MS,
    nowMs: (input.now ?? new Date()).getTime(),
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

export function formatAutoProjectContextSummary(context: AutoProjectContext): string {
  const lines = [
    `Project context for ${context.project.name}`,
    `- Code memory: ${context.overview.code.files} files / ${context.overview.code.symbols} symbols / ${context.overview.code.refs} memory links`,
    `- Languages: ${formatLanguages(context.overview)}`,
    `- Memories: ${context.overview.memory.active} active / ${context.overview.memory.total} total`,
    `- Freshness: ${context.overview.freshness.current} current, ${context.overview.freshness.suspect} suspect, ${context.overview.freshness.stale} stale`,
    `- Refresh: ${context.refresh.message}`,
  ];

  if (context.overview.suggestedReads.length > 0) {
    lines.push(`- Suggested reads: ${context.overview.suggestedReads.slice(0, 8).join(', ')}`);
  }

  return lines.join('\n');
}

export function formatAutoProjectContextPrompt(context: AutoProjectContext): string {
  const lines = [
    `Memorix project context for ${context.project.name}`,
    context.task ? `Task: ${context.task}` : '',
    '',
    'Project state',
    `- Code memory: ${context.overview.code.files} files, ${context.overview.code.symbols} symbols, ${context.overview.code.refs} memory links`,
    `- Languages: ${formatLanguages(context.overview)}`,
    `- Active memories: ${context.overview.memory.active}`,
    `- Refresh: ${context.refresh.message}`,
    '',
    'Suggested first reads',
  ].filter(Boolean);

  if (context.overview.suggestedReads.length === 0) {
    lines.push('- none yet; inspect the task-relevant code directly');
  } else {
    context.overview.suggestedReads.slice(0, 8).forEach(path => lines.push(`- ${path}`));
  }

  lines.push('', 'Code-bound memory sources');
  if (context.explain.sources.length === 0) {
    lines.push('- none yet');
  } else {
    for (const source of context.explain.sources.slice(0, 8)) {
      const location = source.path ? `${source.path}${source.symbol ? `#${source.symbol}` : ''}` : 'missing code location';
      lines.push(`- #${source.observationId} ${source.type}: ${source.title} (${source.status}, ${location})`);
    }
  }

  if (context.overview.freshness.suspect > 0 || context.overview.freshness.stale > 0) {
    lines.push('', 'Freshness cautions');
    lines.push(`- ${context.overview.freshness.suspect} suspect and ${context.overview.freshness.stale} stale memory link(s); verify code before relying on them.`);
  }

  lines.push('', 'Use this as a starting map, not as a substitute for reading the current code.');
  return lines.join('\n');
}
