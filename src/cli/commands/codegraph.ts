import { defineCommand } from 'citty';
import { CodeGraphStore } from '../../codegraph/store.js';
import { refreshProjectLite } from '../../codegraph/lite-provider.js';
import { assembleContextPackForTask, attachTaskWorkset, buildContextPackPrompt } from '../../codegraph/context-pack.js';
import { backfillMissingObservationCodeRefs } from '../../codegraph/binder.js';
import { collectCurrentProjectFacts, formatGitFact } from '../../codegraph/current-facts.js';
import { resolveTaskLens } from '../../codegraph/task-lens.js';
import { getExternalCodeGraphContext, inspectExternalCodeGraph, runExternalCodeGraphLifecycle } from '../../codegraph/external-provider.js';
import type { CodeGraphProviderQuality } from '../../codegraph/types.js';
import { getResolvedConfig } from '../../config/resolved-config.js';
import { buildBoundedContextReceipt } from '../../knowledge/context-receipt.js';
import { WORKFLOW_AGENT_TARGETS } from '../../knowledge/workflows.js';
import { getAllObservations } from '../../memory/observations.js';
import { filterReadableObservations } from '../../memory/visibility.js';
import type { AgentTarget } from '../../types.js';
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
        `- Task-scoped provider: ${quality.selected} (${quality.selectedQuality})`,
      ]
      : []),
  ].join('\n');
}

function formatUsageHint(): string {
  return [
    'Usage:',
    '  memorix codegraph refresh',
    '  memorix codegraph init       # explicit local CodeGraph initialization',
    '  memorix codegraph sync       # explicit local CodeGraph synchronization',
    '  memorix codegraph status --json',
    '  memorix codegraph diff [--from <snapshot>] [--to <snapshot>]',
    '  memorix codegraph impact --path <relative-source-path>',
    '  memorix codegraph context-pack --task "continue auth bug"',
    '',
    'Tip: use `memorix context "..."` for new work or `memorix resume "..."` for prior work.',
  ].join('\n');
}

function formatDiff(diff: ReturnType<CodeGraphStore['diffSnapshots']>, impact: ReturnType<CodeGraphStore['impactSlice']>): string {
  if (!diff.available) {
    return `CodeGraph diff is unavailable: ${diff.reason ?? 'unknown reason'}. Refresh twice to establish comparable snapshots.`;
  }
  const summary = diff.changes.reduce((counts, change) => {
    counts[change.kind] += 1;
    return counts;
  }, { added: 0, modified: 0, removed: 0 });
  const lines = [
    `CodeGraph diff: ${diff.fromSnapshotId} -> ${diff.toSnapshotId}`,
    `- Changed files: ${diff.changes.length} (${summary.added} added, ${summary.modified} modified, ${summary.removed} removed)`,
  ];
  for (const change of diff.changes.slice(0, 20)) lines.push(`- ${change.kind}: ${change.path}`);
  if (diff.changes.length > 20) lines.push(`- ${diff.changes.length - 20} additional file change(s) omitted`);
  if (impact.directlyConnectedPaths.length > 0) {
    lines.push('', 'Current one-hop structural impact');
    for (const path of impact.directlyConnectedPaths.slice(0, 20)) lines.push(`- ${path}`);
  }
  if (impact.relationCount === 0) lines.push('', 'No current file-edge relation was found for the changed paths.');
  if (impact.truncated) lines.push('- Impact relation limit reached; inspect the graph before assuming coverage.');
  return lines.join('\n');
}

function formatImpact(impact: ReturnType<CodeGraphStore['impactSlice']>): string {
  const lines = [
    `CodeGraph current one-hop impact: ${impact.changedPaths.join(', ')}`,
    `- Relations inspected: ${impact.relationCount}`,
  ];
  if (impact.directlyConnectedPaths.length > 0) {
    lines.push('- Directly connected paths:');
    for (const path of impact.directlyConnectedPaths) lines.push(`  - ${path}`);
  } else {
    lines.push('- No current file-edge relation was found for this indexed path.');
  }
  if (impact.truncated) lines.push('- Impact relation limit reached; inspect the graph before assuming coverage.');
  return lines.join('\n');
}

function compactFacts(project: { rootPath: string }): { facts: string[]; dirty: boolean } {
  const current = collectCurrentProjectFacts({ project, now: new Date() });
  const facts: string[] = [];
  if (current.packageVersion) facts.push('Package version: ' + current.packageVersion);
  if (current.latestChangelog) {
    facts.push('Latest changelog: ' + current.latestChangelog.version
      + (current.latestChangelog.date ? ' (' + current.latestChangelog.date + ')' : ''));
  }
  facts.push(formatGitFact(current.git));
  return { facts, dirty: current.git.dirty };
}

function coerceAgentTarget(input?: string): AgentTarget | undefined {
  const value = input?.trim().toLowerCase();
  if (!value) return undefined;
  if (WORKFLOW_AGENT_TARGETS.includes(value as AgentTarget)) return value as AgentTarget;
  throw new Error('agent must be one of: ' + WORKFLOW_AGENT_TARGETS.join(', '));
}

export default defineCommand({
  meta: {
    name: 'codegraph',
    description: 'Inspect and refresh CodeGraph Memory for the current project',
  },
  args: {
    action: { type: 'string', description: 'Action: status, refresh, diff, impact, init, sync, or context-pack' },
    task: { type: 'string', description: 'Task text for context-pack' },
    path: { type: 'string', description: 'Indexed relative source path for impact' },
    limit: { type: 'string', description: 'Max active memories to inspect for context-pack' },
    from: { type: 'string', description: 'Earlier CodeGraph snapshot id for diff' },
    to: { type: 'string', description: 'Later CodeGraph snapshot id for diff' },
    impactLimit: { type: 'string', description: 'Maximum graph relations to inspect for diff impact' },
    agent: { type: 'string', description: 'Optional target agent for compatible workflow selection' },
    json: { type: 'boolean', description: 'Emit machine-readable JSON output' },
    briefJson: { type: 'boolean', description: 'Emit only the bounded agent brief and receipt JSON for context-pack' },
  },
  run: async ({ args }) => {
    const positional = (args._ as string[]) ?? [];
    const action = (positional[0] || (args.action as string | undefined) || 'status').toLowerCase();
    const asJson = !!args.json || !!args.briefJson;

    try {
      const { project, dataDir, reader } = await getCliProjectContext();
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
          const {
            enqueueClaimRequalification,
            enqueueObservationQualification,
          } = await import('../../runtime/lifecycle.js');
          enqueueClaimRequalification({
            dataDir,
            projectId: project.id,
            source: 'manual-codegraph-refresh',
            snapshotId: refresh.snapshot.id,
          });
          enqueueObservationQualification({
            dataDir,
            projectId: project.id,
            source: 'manual-codegraph-refresh',
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

        case 'init':
        case 'sync': {
          const lifecycle = await runExternalCodeGraphLifecycle({
            action,
            projectRoot: project.rootPath,
            mode: codegraphConfig.externalContext,
            command: codegraphConfig.externalCommand,
            timeoutMs: codegraphConfig.externalTimeoutMs,
          });
          emitResult(
            { project, lifecycle, providerQuality: lifecycle.quality },
            [
              lifecycle.message,
              `- External semantic CodeGraph: ${lifecycle.health.state}`,
              `- Task-scoped provider: ${lifecycle.quality.selected} (${lifecycle.quality.selectedQuality})`,
            ].join('\n'),
            asJson,
          );
          return;
        }

        case 'diff': {
          const snapshots = store.listSnapshots(project.id, 2);
          const fromSnapshotId = (args.from as string | undefined)?.trim() || snapshots[1]?.id;
          const toSnapshotId = (args.to as string | undefined)?.trim() || snapshots[0]?.id;
          if (!fromSnapshotId || !toSnapshotId) {
            emitError('two completed CodeGraph snapshots are required; run "memorix codegraph refresh" again after a code change.', asJson);
            return;
          }
          const diff = store.diffSnapshots(project.id, fromSnapshotId, toSnapshotId);
          const impact = store.impactSlice(
            project.id,
            diff.changes.map(change => change.path),
            parsePositiveInt(args.impactLimit as string | undefined, 24),
          );
          emitResult({ project, diff, impact }, formatDiff(diff, impact), asJson);
          return;
        }

        case 'impact': {
          const sourcePath = (args.path as string | undefined)?.trim() || positional.slice(1).join(' ').trim();
          if (!sourcePath) {
            emitError('path is required for "memorix codegraph impact"', asJson);
            return;
          }
          if (!store.getFile(project.id, sourcePath)) {
            emitError(`path is not in the current CodeGraph index: ${sourcePath}. Run "memorix codegraph refresh" and retry.`, asJson);
            return;
          }
          const impact = store.impactSlice(
            project.id,
            [sourcePath],
            parsePositiveInt(args.impactLimit as string | undefined, 24),
          );
          emitResult({ project, impact }, formatImpact(impact), asJson);
          return;
        }

        case 'context-pack': {
          const task = (args.task as string | undefined)?.trim() || positional.slice(1).join(' ').trim();
          if (!task) {
            emitError('task is required for "memorix codegraph context-pack"', asJson);
            return;
          }
          const limit = parsePositiveInt(args.limit as string | undefined, 20);
          const observations = filterReadableObservations(
            getAllObservations().filter(obs => obs.projectId === project.id && (obs.status ?? 'active') === 'active'),
            reader,
          ).reverse();
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
            reader,
            agent: coerceAgentTarget(args.agent as string | undefined),
          });
          emitResult(
            args.briefJson && pack.workset
              ? buildBoundedContextReceipt({ workset: pack.workset, providerQuality: external.quality })
              : { project, pack, providerQuality: external.quality },
            buildContextPackPrompt(pack),
            asJson,
          );
          return;
        }

        default:
          emitError(`unknown codegraph action "${action}". Use "status", "refresh", "init", "sync", "diff", "impact", or "context-pack".`, asJson);
      }
    } catch (error) {
      emitError(error instanceof Error ? error.message : String(error), asJson);
    }
  },
});
