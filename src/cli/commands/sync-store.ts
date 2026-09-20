/**
 * `memorix sync store <push|pull|status>` — multi-device store replication.
 *
 * Separated from `memorix sync rules|workspace` (cross-agent rules) so the two
 * meanings of "sync" never collide. Store sync is opt-in and provider-agnostic;
 * the remote is selected by `MEMORIX_SYNC_PROVIDER`.
 */

import { defineCommand } from 'citty';

import { getCliProjectContext, emitError, emitResult } from './operator-shared.js';
import { getObservationStore, initObservationStore } from '../../store/obs-store.js';
import { getProjectDataDir } from '../../store/persistence.js';
import { runSync } from '../../sync/engine.js';
import { createSqliteSyncStore } from '../../sync/store-port.js';
import { resolveSyncConfig, createRemote } from '../../sync/remote-factory.js';
import { USER_SYNC_SCOPE_ID } from '../../sync/namespace.js';
import type { SyncScope } from '../../sync/policy.js';
import type { SyncReport } from '../../sync/types.js';

function parseScope(raw: unknown): SyncScope {
  const value = String(raw || 'project').toLowerCase();
  if (value === 'project' || value === 'user') return value;
  throw new Error('--scope must be one of: project, user');
}

async function openSyncStore(scope: SyncScope) {
  if (scope === 'user') {
    const dataDir = await getProjectDataDir(USER_SYNC_SCOPE_ID);
    await initObservationStore(dataDir);
    return {
      projectId: USER_SYNC_SCOPE_ID,
      syncStore: createSqliteSyncStore(dataDir, getObservationStore(), USER_SYNC_SCOPE_ID, { scope: 'user' }),
    };
  }
  const { project, dataDir } = await getCliProjectContext();
  await initObservationStore(dataDir);
  return {
    projectId: project.id,
    syncStore: createSqliteSyncStore(dataDir, getObservationStore(), project.id),
  };
}

function renderReport(report: SyncReport): string {
  const lines = [
    `Store sync (${report.remote}, scope ${report.scope}) — device ${report.deviceId}${report.dryRun ? ' [dry-run]' : ''}`,
    `- Pushed changes:   ${report.pushed}`,
    `- Pulled batches:   ${report.pulledBatches}`,
    `- Applied upserts:  ${report.applied}`,
    `- Applied deletes:  ${report.tombstoned}`,
    `- Skipped (older):  ${report.skipped}`,
    `- Excluded locally:  ${report.excluded}`,
    `- Conflicts recorded: ${report.conflicts}`,
    `- Pending outbox:    ${report.pending}`,
  ];
  if (report.dryRun && report.decisions.length > 0) {
    lines.push('', 'Decisions:');
    for (const d of report.decisions) {
      lines.push(`  ${d.syncKey} ${d.kind} -> ${d.outcome} (${d.reason})`);
    }
  }
  return lines.join('\n');
}

export default defineCommand({
  meta: {
    name: 'sync-store',
    description: 'Replicate the local observation store across your devices (opt-in, provider-agnostic)',
  },
  args: {
    dry: { type: 'boolean', description: 'Preview changes without writing anything', default: false },
    json: { type: 'boolean', description: 'Emit JSON', default: false },
    'push-only': { type: 'boolean', description: 'Only push local changes', default: false },
    'pull-only': { type: 'boolean', description: 'Only pull remote changes', default: false },
    through: { type: 'string', description: 'Compaction cutoff: device=sequence,device=sequence' },
    yes: { type: 'boolean', description: 'Confirm destructive remote compaction', default: false },
    scope: {
      type: 'string',
      description: 'project (default: current Git project) or user (all local projects)',
      default: 'project',
    },
  },
  run: async ({ args }) => {
    const asJson = Boolean(args.json);
    const action = (args._ as string[])?.[0] || 'status';
    let scope: SyncScope;
    try {
      scope = parseScope(args.scope);
    } catch (err) {
      emitError((err as Error).message, asJson);
      process.exitCode = 2;
      return;
    }
    if (action === 'device') {
      const subaction = (args._ as string[])?.[1] || '';
      if (subaction !== 'rotate') {
        emitError('expected "memorix sync store device rotate"', asJson);
        process.exitCode = 2;
        return;
      }
      // Device identity is per data directory, not per Git project.
      const { projectId, syncStore } = await openSyncStore('user');
      const deviceId = syncStore.rotateDevice();
      emitResult({ project: projectId, scope: 'user', deviceId, rotated: true }, `Sync device identity rotated: ${deviceId}`, asJson);
      return;
    }
    if (action !== 'push' && action !== 'pull' && action !== 'status' && action !== 'compact') {
      emitError(`unknown action "${action}" (expected push|pull|status|compact|device rotate)`, asJson);
      process.exitCode = 2;
      return;
    }

    let config;
    try {
      config = resolveSyncConfig();
    } catch (err) {
      emitError((err as Error).message, asJson);
      process.exitCode = 2;
      return;
    }

    if (!config.enabled || !config.provider) {
      emitResult(
        { enabled: false },
        'Store sync is disabled. Set MEMORIX_SYNC_PROVIDER=fs|github|s3|postgres to enable it.',
        asJson,
      );
      return;
    }

    const { projectId, syncStore } = await openSyncStore(scope);

    if (action === 'compact') {
      if (!args.yes && !args.dry) {
        emitError('remote compaction deletes relay events; repeat with --yes after specifying --through device=sequence', asJson);
        process.exitCode = 2;
        return;
      }
      const raw = String(args.through ?? '');
      const through: Record<string, number> = {};
      for (const item of raw.split(',').map((value) => value.trim()).filter(Boolean)) {
        const [device, sequence] = item.split('=', 2);
        const parsed = Number(sequence);
        if (!device || !Number.isSafeInteger(parsed) || parsed < 0) {
          emitError('invalid --through; expected device=sequence[,device=sequence]', asJson);
          process.exitCode = 2;
          return;
        }
        through[device] = parsed;
      }
      if (Object.keys(through).length === 0) {
        emitError('--through is required for compaction', asJson);
        process.exitCode = 2;
        return;
      }
      let remote;
      try {
        remote = await createRemote(config.provider, syncStore.namespace());
      } catch (err) {
        emitError((err as Error).message, asJson);
        process.exitCode = 1;
        return;
      }
      try {
        await remote.init({ create: false });
        const result = await remote.compact(through, { dryRun: Boolean(args.dry) });
        emitResult({ project: projectId, scope, through, ...result, dryRun: Boolean(args.dry) }, `Compaction candidates: ${result.candidates}; deleted: ${result.deleted}`, asJson);
      } catch (err) {
        emitError((err as Error).message, asJson);
        process.exitCode = 1;
      } finally {
        await remote.close();
      }
      return;
    }

    if (action === 'status') {
      let remote;
      try {
        remote = await createRemote(config.provider, syncStore.namespace());
      } catch (err) {
        emitError((err as Error).message, asJson);
        process.exitCode = 1;
        return;
      }
      try {
        const report = await runSync(syncStore, remote, {
          deviceId: syncStore.deviceId(),
          dryRun: true,
          push: true,
          pull: true,
        });
        emitResult({ project: projectId, ...report }, renderReport(report), asJson);
      } catch (err) {
        emitError((err as Error).message, asJson);
        process.exitCode = 1;
      }
      return;
    }

    const doPush = action === 'push' || !args['pull-only'];
    const doPull = action === 'pull' || !args['push-only'];

    let remote;
    try {
      remote = await createRemote(config.provider, syncStore.namespace());
    } catch (err) {
      emitError((err as Error).message, asJson);
      process.exitCode = 1;
      return;
    }

    try {
      const report = await runSync(syncStore, remote, {
        deviceId: syncStore.deviceId(),
        dryRun: Boolean(args.dry),
        push: doPush,
        pull: doPull,
      });
      emitResult({ project: projectId, ...report }, renderReport(report), asJson);
    } catch (err) {
      emitError((err as Error).message, asJson);
      process.exitCode = 1;
    }
  },
});
