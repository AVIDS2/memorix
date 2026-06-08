import { defineCommand } from 'citty';
import { buildHandoffReceipt, formatHandoffReceipt } from '../receipt-service.js';
import { emitError, emitResult } from './operator-shared.js';

export default defineCommand({
  meta: {
    name: 'receipt',
    description: 'Generate a privacy-safe memory handoff receipt',
  },
  args: {
    json: { type: 'boolean', description: 'Emit machine-readable JSON output' },
    probe: { type: 'string', description: 'Optional search probe; only its hash is emitted' },
  },
  run: async ({ args }) => {
    const asJson = !!args.json;

    try {
      const receipt = await buildHandoffReceipt({
        probe: args.probe as string | undefined,
        transport: 'cli',
      });
      emitResult(receipt, formatHandoffReceipt(receipt), asJson);
    } catch (error) {
      emitError(error instanceof Error ? error.message : String(error), asJson);
    }
  },
});
