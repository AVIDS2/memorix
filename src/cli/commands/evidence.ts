import { defineCommand } from 'citty';
import { getObservationStore } from '../../store/obs-store.js';
import { EvidenceCardStore } from '../../store/evidence-store.js';
import { emitError, emitResult, getCliProjectContext, getCliReadContext } from './operator-shared.js';

export default defineCommand({
  meta: { name: 'evidence', description: 'Inspect project-scoped evidence cards and provenance' },
  args: {
    action: { type: 'positional', description: 'list, get, sync, stale, or events', required: false },
    id: { type: 'string', description: 'Candidate id, usually an observation id' },
    paths: { type: 'string', description: 'Comma-separated changed paths for stale' },
    reason: { type: 'string', description: 'Why the source became stale' },
    query: { type: 'string', description: 'Search title/source fields' },
    limit: { type: 'string', description: 'Maximum cards/events' },
    json: { type: 'boolean', description: 'Emit JSON' },
  },
  async run({ args }) {
    const action = (args.action as string | undefined) || 'list';
    const asJson = !!args.json;
    try {
      const context = action === 'list' || action === 'get' || action === 'events'
        ? await getCliReadContext()
        : await getCliProjectContext({ searchIndex: false });
      const { project, dataDir } = context;
      const store = new EvidenceCardStore();
      await store.init(dataDir);
      const limit = Math.min(100, Math.max(1, Number(args.limit || 20)));
      if (action === 'sync') {
        const synced = store.syncObservations(await getObservationStore().loadByProject(project.id));
        emitResult({ project, synced: synced.length }, `Synced ${synced.length} evidence card(s).`, asJson);
        return;
      }
      if (action === 'stale') {
        const paths = String(args.paths || '').split(',').map((value) => value.trim()).filter(Boolean);
        const changed = store.markStaleForPaths(project.id, paths, String(args.reason || 'source file changed'));
        emitResult({ project, staleMarked: changed, paths }, `Marked ${changed} evidence card(s) stale.`, asJson);
        return;
      }
      const id = String(args.id || '').trim();
      if (action === 'get' || action === 'events') {
        if (!id) { emitError(`--id is required for evidence ${action}.`, asJson); return; }
        const card = store.get(project.id, 'observation', id);
        if (!card) { emitError(`Evidence card for observation ${id} was not found.`, asJson); return; }
        const result = action === 'events' ? store.listEvents(card.id, limit) : { card, events: store.listEvents(card.id) };
        emitResult({ project, result }, JSON.stringify(result, null, 2), asJson);
        return;
      }
      if (action !== 'list') { emitError('action must be list, get, sync, stale, or events.', asJson); return; }
      const query = String(args.query || '').trim().toLowerCase();
      const cards = store.list(project.id, { limit: 100 }).filter((card) => !query || [card.title, card.summary, card.sourceRef, card.locator || ''].join(' ').toLowerCase().includes(query)).slice(0, limit);
      emitResult({ project, cards }, cards.length === 0 ? 'No evidence cards found.' : cards.map((card) => `- ${card.candidateId} ${card.title} [${card.freshness}] ${card.sourceRef}`).join('\n'), asJson);
    } catch (error) {
      emitError(error instanceof Error ? error.message : String(error), asJson);
    }
  },
});
