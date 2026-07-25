import { defineCommand } from 'citty';
import contextCommand from './context.js';

/**
 * A human- and agent-friendly continuation entry point. It deliberately
 * delegates to Project Context so CLI and MCP keep one Workset contract.
 */
export default defineCommand({
  meta: {
    name: 'resume',
    description: 'Resume prior project work with one bounded Memory Autopilot brief',
  },
  args: {
    task: { type: 'positional', description: 'Current continuation task', required: false },
    refresh: { type: 'string', description: 'Project scan policy: auto, always, or never' },
    json: { type: 'boolean', description: 'Emit machine-readable JSON output' },
  },
  async run({ args }) {
    await contextCommand.run?.({
      args: {
        _: [],
        input: args.task,
        refresh: args.refresh,
        json: args.json,
        resume: true,
      },
      rawArgs: [],
      cmd: contextCommand,
    } as any);
  },
});
