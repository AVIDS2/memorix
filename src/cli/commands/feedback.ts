import { defineCommand } from 'citty';
import { MemoryFeedbackStore, type FeedbackCandidateKind, type MemoryFeedbackSignal } from '../../memory/feedback.js';
import { emitError, emitResult, getCliProjectContext, getCliReadContext } from './operator-shared.js';

const signals: MemoryFeedbackSignal[] = ['user-correction', 'verification-success', 'verification-failure', 'code-change', 'used', 'not-used', 'code-conflict', 'strengthen', 'weaken', 'revoke'];

export default defineCommand({
  meta: { name: 'feedback', description: 'Record and audit memory feedback' },
  args: {
    action: { type: 'positional', description: 'record, show, or audit', required: false },
    id: { type: 'string', description: 'Candidate id' },
    kind: { type: 'string', description: 'observation, claim, durable-memory, or workflow' },
    signal: { type: 'string', description: 'Feedback signal' },
    source: { type: 'string', description: 'Source reference for the feedback' },
    actor: { type: 'string', description: 'Actor id or human label' },
    note: { type: 'string', description: 'Short audit note' },
    targetEventId: { type: 'string', description: 'Event id to revoke' },
    limit: { type: 'string', description: 'Maximum audit rows' },
    json: { type: 'boolean', description: 'Emit JSON' },
  },
  async run({ args }) {
    const action = (args.action as string | undefined) || 'show';
    const asJson = !!args.json;
    try {
      const context = action === 'show' || action === 'audit' ? await getCliReadContext() : await getCliProjectContext({ searchIndex: false });
      const { project, dataDir } = context;
      const id = String(args.id || '').trim();
      const kind = (String(args.kind || 'observation').trim() || 'observation') as FeedbackCandidateKind;
      if (!id) { emitError('--id is required.', asJson); return; }
      if (!['observation', 'claim', 'durable-memory', 'workflow'].includes(kind)) { emitError('Invalid --kind.', asJson); return; }
      const store = new MemoryFeedbackStore();
      await store.init(dataDir);
      if (action === 'show') {
        const result = store.getState(project.id, kind, id);
        emitResult({ project, result }, JSON.stringify(result, null, 2), asJson);
        return;
      }
      if (action === 'audit') {
        const result = store.audit(project.id, kind, id, Number(args.limit || 100));
        emitResult({ project, result }, JSON.stringify(result, null, 2), asJson);
        return;
      }
      if (action !== 'record') { emitError('action must be record, show, or audit.', asJson); return; }
      const signal = String(args.signal || '').trim() as MemoryFeedbackSignal;
      const sourceRef = String(args.source || '').trim();
      if (!signals.includes(signal) || !sourceRef) { emitError(`record requires --signal (${signals.join(', ')}) and --source.`, asJson); return; }
      const result = store.record({
        projectId: project.id, candidateKind: kind, candidateId: id, signal, sourceRef,
        ...(args.actor ? { actor: String(args.actor) } : {}),
        ...(args.note ? { note: String(args.note) } : {}),
        ...(args.targetEventId ? { targetEventId: String(args.targetEventId) } : {}),
      });
      emitResult({ project, result }, `Recorded ${signal} for ${kind}:${id}; weight=${result.state.weight.toFixed(2)}.`, asJson);
    } catch (error) {
      emitError(error instanceof Error ? error.message : String(error), asJson);
    }
  },
});
