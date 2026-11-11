import { defineCommand } from 'citty';
import { getBeforeAfterMetrics, getMetricsSummary } from '../../memory/formation/index.js';
import { emitError, emitResult } from './operator-shared.js';

export default defineCommand({
  meta: {
    name: 'formation',
    description: 'Inspect Memory Formation Pipeline runtime metrics',
  },
  args: {
    json: { type: 'boolean', description: 'Emit machine-readable JSON output' },
  },
  run: async ({ args }) => {
    const action = (args._ as string[])?.[0] || '';
    const asJson = !!args.json;

    try {
      switch (action) {
        case 'metrics': {
          const summary = getMetricsSummary();
          const beforeAfter = getBeforeAfterMetrics();
          emitResult(
            { summary, beforeAfter },
            summary.total === 0
              ? 'Formation Pipeline: No metrics collected yet.'
              : [
                  'Formation Pipeline Metrics',
                  `- Total observations processed: ${summary.total}`,
                  `- Average value score: ${summary.avgValueScore.toFixed(3)}`,
                  `- Average processing time: ${summary.avgDurationMs.toFixed(1)}ms`,
                ].join('\n'),
            asJson,
          );
          return;
        }

        default:
          console.log('Memorix Formation Commands');
          console.log('');
          console.log('Usage:');
          console.log('  memorix formation metrics');
      }
    } catch (error) {
      emitError(error instanceof Error ? error.message : String(error), asJson);
    }
  },
});

