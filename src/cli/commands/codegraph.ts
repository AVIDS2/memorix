import { defineCommand } from 'citty';
import { CodeGraphStore } from '../../codegraph/store.js';
import { refreshProjectLite } from '../../codegraph/lite-provider.js';
import { assembleContextPackForTask, attachTaskWorkset, buildContextPackPrompt } from '../../codegraph/context-pack.js';
import { backfillMissingObservationCodeRefs } from '../../codegraph/binder.js';
import { collectCurrentProjectFacts } from '../../codegraph/current-facts.js';
import { resolveTaskLens } from '../../codegraph/task-lens.js';
import { getExternalCodeGraphContext, inspectExternalCodeGraph } from '../../codegraph/external-provider.js';
import type { CodeGraphProviderQuality } from '../../codegraph/types.js';
import { getResolvedConfig } from '../../config/resolved-config.js';
import { getAllObservations } from '../../memory/observations.js';
import { emitError, emitResult, getCliProjectContext, parsePositiveInt } from './operator-shared.js';

function formatSnapshotStatus(status: ReturnType<CodeGraphStore['status']>): string[] {
  const snapshot = status.latestSnapshot;
  if (!snapshot) return ['- Code state: no completed snapshot yet'];
  const revision = snapshot.baseRevision ? snapshot.baseRevision.slice(0, 12) : 'Git unavailable';
  const completeness = snapshot.completeness;
  const scanState = completeness.skippedOversizedFiles > 0
    || (completeness.unreadableFiles ?? 0) > 0
    || completeness.removalScanDeferred
    ? 'incomplete'
    : 'complete';
  return [
    '- Code state: ' + revision
      + ', ' + snapshot.worktreeState + ' worktree'
      + ', ' + snapshot.changedPathCount + ' changed path(s)'
      + ', epoch ' + snapshot.sourceEpoch,
    '- Scan completeness: ' + scanState
      + ' (' + completeness.scannedFiles + '/' + completeness.maxFiles + ' paths'
      + ', ' + completeness.skippedOversizedFiles + ' oversized skipped'
      + ', ' + (completeness.unreadableFiles ?? 0) + ' unreadable)',
  ];
}

function formatStatus(status: ReturnType<CodeGraphStore['status']>, quality?: CodeGraphProviderQuality): string {
  return [
    ...formatSnapshotStatus(status),
    `CodeGraph Memory: ${status.provider}`,
    `- Files: ${status.files}`,
    `- Symbols: ${status.symbols}`,
    `- Edges: ${status.edges}`,
    `- Memory refs: ${status.refs}`,
    status.indexedAt ? `- Indexed at: ${status.indexedAt}` : '- Indexed at: never',
    ...(quality
      ? [
        `- Persistent provider: ${status.provider} (heuristic local index)`,
        `- External semantic CodeGraph: ${quality.external.state}`
          + (quality.external.reason ? ` (${quality.external.reason})` : ''),
      ]
      : []),
  ].join('\n');
}

function formatUsageHint(): string {
  return [
    'Usage:',
    '  memorix codegraph refresh',
    '  memorix codegraph status --json',
    '  memorix codegraph context-pack --task "continue auth bug"',
    '',
    'Tip: use `memorix context --task "..."` for the default agent-ready project context.',
  ].join('\n');
}

function compactFacts(project: { rootPath: string }): { facts: string[]; dirty: boolean } {
  const current = collectCurrentProjectFacts({ project, now: new Date() });
  const facts: string[] = [];
  if (current.packageVersion) facts.push('Package version: ' + current.packageVersion);
  if (current.latestChangelog) {
    facts.push('Latest changelog: ' + current.latestChangelog.version
      + (current.latestChangelog.date ? ' (' + current.latestChangelog.date + ')' : ''));
  }
  facts.push('Git: ' + (current.git.branch ? 'branch ' + current.git.branch + ', ' : '')
    + (current.git.dirty ? 'dirty worktree' : 'clean worktree'));
  return { facts, dirty: current.git.dirty };
}

export default defineCommand({
  meta: {
    name: 'codegraph',
    description: 'Inspect and refresh CodeGraph Memory for the current project',
  },
  args: {
    action: { type: 'string', description: 'Action: status, refresh, or context-pack' },
    task: { type: 'string', description: 'Task text for context-pack' },
    limit: { type: 'string', description: 'Max active memories to inspect for context-pack' },
    json: { type: 'boolean', description: 'Emit machine-readable JSON output' },
  },
  run: async ({ args }) => {
    const positional = (args._ as string[]) ?? [];
    const action = (positional[0] || (args.action as string | undefined) || 'status').toLowerCase();
    const asJson = !!args.json;

    try {
      const { project, dataDir } = await getCliProjectContext();
      const store = new CodeGraphStore();
      await store.init(dataDir);
      const explicitAction = Boolean(positional[0] || (args.action as string | undefined));
      const codegraphConfig = getResolvedConfig({ projectRoot: project.rootPath }).codegraph;
      const exclude = codegraphConfig.excludePatterns;

      switch (action) {
        case 'status': {
          const status = store.status(project.id);
          const providerQuality = await inspectExternalCodeGraph({
            projectRoot: project.rootPath,
            mode: codegraphConfig.externalContext,
            command: codegraphConfig.externalCommand,
            timeoutMs: codegraphConfig.externalTimeoutMs,
          });
          const text = explicitAction || asJson
            ? formatStatus(status, providerQuality.quality)
            : `${formatStatus(status, providerQuality.quality)}\n\n${formatUsageHint()}`;
          emitResult({ project, status, providerQuality: providerQuality.quality }, text, asJson);
          return;
        }

        case 'refresh': {
          const refresh = await refreshProjectLite(store, {
            projectId: project.id,
            projectRoot: project.rootPath,
            exclude,
            maxFileBytes: codegraphConfig.maxFileBytes,
          });
          const activeObservations = getAllObservations()
            .filter(obs => obs.projectId === project.id && (obs.status ?? 'active') === 'active');
          const backfill = await backfillMissingObservationCodeRefs(store, activeObservations);
          const { enqueueClaimRequalification } = await import('../../runtime/lifecycle.js');
          enqueueClaimRequalification({
            dataDir,
            projectId: project.id,
            source: 'manual-codegraph-refresh',
            snapshotId: refresh.snapshot.id,
          });
          const status = store.status(project.id);
          const providerQuality = await inspectExternalCodeGraph({
            projectRoot: project.rootPath,
            mode: codegraphConfig.externalContext,
            command: codegraphConfig.externalCommand,
            timeoutMs: codegraphConfig.externalTimeoutMs,
          });
          emitResult(
            { project, status, providerQuality: providerQuality.quality, refresh, backfill },
            [
              'CodeGraph Memory refreshed.',
              formatStatus(status, providerQuality.quality),
              `- Files: ${refresh.changedFiles} changed, ${refresh.unchangedFiles} unchanged, ${refresh.removedFiles} removed`,
              `- Backfilled memories: ${backfill.observationsBackfilled}`,
              `- Backfilled refs: ${backfill.refsBackfilled}`,
            ].join('\n'),
            asJson,
          );
          return;
        }

        case 'context-pack': {
          const task = (args.task as string | undefined)?.trim() || positional.slice(1).join(' ').trim();
          if (!task) {
            emitError('task is required for "memorix codegraph context-pack"', asJson);
            return;
          }
          const limit = parsePositiveInt(args.limit as string | undefined, 20);
          const observations = getAllObservations()
            .filter(obs => obs.projectId === project.id && (obs.status ?? 'active') === 'active')
            .reverse();
          const basePack = assembleContextPackForTask({
            store,
            projectId: project.id,
            task,
            observations,
            limit,
            exclude,
          });
          const status = store.status(project.id);
          const facts = compactFacts(project);
          const snapshot = status.latestSnapshot;
          const external = await getExternalCodeGraphContext({
            projectRoot: project.rootPath,
            task,
            exclude,
            mode: codegraphConfig.externalContext,
            command: codegraphConfig.externalCommand,
            timeoutMs: codegraphConfig.externalTimeoutMs,
          });
          const pack = await attachTaskWorkset({
            pack: basePack,
            projectId: project.id,
            dataDir,
            lens: resolveTaskLens(task).id,
            worktreeDirty: facts.dirty,
            currentFacts: facts.facts,
            codeState: formatSnapshotStatus(status).join(' '),
            ...(snapshot
              ? {
                snapshot: {
                  id: snapshot.id,
                  sourceEpoch: snapshot.sourceEpoch,
                  worktreeState: snapshot.worktreeState,
                  incomplete: snapshot.completeness.skippedOversizedFiles > 0
                    || (snapshot.completeness.unreadableFiles ?? 0) > 0
                    || snapshot.completeness.removalScanDeferred,
                },
              }
              : {}),
            ...(external.outline ? { semanticCode: external.outline } : {}),
            providerQuality: external.quality,
            ...(external.caution
              ? { runtimeCautions: [{ kind: 'external-codegraph-fallback' as const, message: external.caution }] }
              : {}),
          });
          emitResult({ project, pack, providerQuality: external.quality }, buildContextPackPrompt(pack), asJson);
          return;
        }

        default:
          emitError(`unknown codegraph action "${action}". Use "status", "refresh", or "context-pack".`, asJson);
      }
    } catch (error) {
      emitError(error instanceof Error ? error.message : String(error), asJson);
    }
  },
});
