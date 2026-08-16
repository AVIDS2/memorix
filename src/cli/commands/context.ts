import { defineCommand } from 'citty';
import {
  buildAutoProjectBrief,
  buildAutoProjectContext,
  formatAutoProjectContextPrompt,
  type AutoContextRefreshMode,
} from '../../codegraph/auto-context.js';
import { getAllObservations } from '../../memory/observations.js';
import { filterReadableObservations } from '../../memory/visibility.js';
import { buildBoundedContextReceipt } from '../../knowledge/context-receipt.js';
import { WORKFLOW_AGENT_TARGETS } from '../../knowledge/workflows.js';
import type { AgentTarget } from '../../types.js';
import { emitError, emitResult, getCliProjectContext } from './operator-shared.js';

function coerceRefreshMode(input?: string): AutoContextRefreshMode {
  const value = (input ?? 'auto').trim().toLowerCase();
  if (value === 'always' || value === 'never' || value === 'auto') return value;
  throw new Error('refresh must be one of: auto, always, never');
}

function coerceAgentTarget(input?: string): AgentTarget | undefined {
  const value = input?.trim().toLowerCase();
  if (!value) return undefined;
  if (WORKFLOW_AGENT_TARGETS.includes(value as AgentTarget)) return value as AgentTarget;
  throw new Error('agent must be one of: ' + WORKFLOW_AGENT_TARGETS.join(', '));
}

export default defineCommand({
  meta: {
    name: 'context',
    description: 'Show the Memory Autopilot brief for the current project',
  },
  args: {
    task: { type: 'string', description: 'Current task for context shaping' },
    input: {
      type: 'positional',
      description: 'Current task for context shaping (ergonomic positional form)',
      required: false,
    },
    resume: { type: 'boolean', description: 'Always include the bounded prior-work projection' },
    refresh: { type: 'string', description: 'Project scan policy: auto, always, or never' },
    agent: { type: 'string', description: 'Optional target agent for compatible workflow selection' },
    json: { type: 'boolean', description: 'Emit machine-readable JSON output' },
    briefJson: { type: 'boolean', description: 'Emit only the bounded agent brief and receipt JSON' },
  },
  run: async ({ args }) => {
    const asJson = !!args.json || !!args.briefJson;
    const task = (args.task as string | undefined)?.trim()
      || (args.input as string | undefined)?.trim()
      || undefined;

    try {
      const { project, dataDir, reader } = await getCliProjectContext();
      const context = await buildAutoProjectContext({
        project,
        dataDir,
        observations: filterReadableObservations(getAllObservations(), reader),
        task,
        agent: coerceAgentTarget(args.agent as string | undefined),
        refresh: coerceRefreshMode(args.refresh as string | undefined),
        reader,
        ...(args.resume ? { continuation: 'always' as const } : {}),
      });

      const detailed = {
          project,
          lens: context.lens,
          brief: buildAutoProjectBrief(context),
          currentFacts: context.currentFacts,
          overview: context.overview,
          refresh: context.refresh,
          providerQuality: context.providerQuality,
          workset: context.workset,
          ...(context.task ? { task: context.task } : {}),
          ...(context.continuation ? { continuation: context.continuation } : {}),
      };
      emitResult(
        args.briefJson
          ? buildBoundedContextReceipt({ workset: context.workset, providerQuality: context.providerQuality })
          : detailed,
        formatAutoProjectContextPrompt(context),
        asJson,
      );
    } catch (error) {
      emitError(error instanceof Error ? error.message : String(error), asJson);
    }
  },
});
