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
import { runSync } from '../../sync/engine.js';
import { createSqliteSyncStore } from '../../sync/store-port.js';
import { resolveSyncConfig, createRemote } from '../../sync/remote-factory.js';
import type { SyncReport } from '../../sync/types.js';

function renderReport(report: SyncReport): string {
  const lines = [
    `Store sync (${report.remote}) — device ${report.deviceId}${report.dryRun ? ' [dry-run]' : ''}`,
    `- Pushed changes:   ${report.pushed}`,
    `- Pulled batches:   ${report.pulledBatches}`,
    `- Applied upserts:  ${report.applied}`,
    `- Applied deletes:  ${report.tombstoned}`,
    `- Skipped (older):  ${report.skipped}`,
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
  },
  run: async ({ args }) => {
    const asJson = Boolean(args.json);
    const action = (args._ as string[])?.[0] || 'status';
    if (action !== 'push' && action !== 'pull' && action !== 'status') {
      emitError(`unknown action "${action}" (expected push|pull|status)`, asJson);
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
        'Store sync is disabled. Set MEMORIX_SYNC_PROVIDER=fs|s3|postgres to enable it.',
        asJson,
      );
      return;
    }

    const { project, dataDir } = await getCliProjectContext();
    await initObservationStore(dataDir);
    const obsStore = getObservationStore();
    const syncStore = createSqliteSyncStore(dataDir, obsStore);

    if (action === 'status') {
      const report = await runSync(syncStore, await createRemote(config.provider), {
        deviceId: syncStore.deviceId(),
        dryRun: true,
        push: true,
        pull: true,
      });
      emitResult({ project: project.id, ...report }, renderReport(report), asJson);
      return;
    }

    const doPush = action === 'push' || !args['pull-only'];
    const doPull = action === 'pull' || !args['push-only'];

    let remote;
    try {
      remote = await createRemote(config.provider);
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
      emitResult({ project: project.id, ...report }, renderReport(report), asJson);
    } catch (err) {
      emitError((err as Error).message, asJson);
      process.exitCode = 1;
    }
  },
});
