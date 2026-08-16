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
    agent: { type: 'string', description: 'Optional target agent for compatible workflow selection' },
    json: { type: 'boolean', description: 'Emit machine-readable JSON output' },
    briefJson: { type: 'boolean', description: 'Emit only the bounded agent brief and receipt JSON' },
  },
  async run({ args }) {
    await contextCommand.run?.({
      args: {
        _: [],
        input: args.task,
        refresh: args.refresh,
        agent: args.agent,
        json: args.json,
        briefJson: args.briefJson,
        resume: true,
      },
      rawArgs: [],
      cmd: contextCommand,
    } as any);
  },
});
