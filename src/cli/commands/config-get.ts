import { defineCommand } from 'citty';
import * as p from '@clack/prompts';
import { getResolvedConfigForCwd } from '../../config/resolved-config.js';

export default defineCommand({
  meta: {
    name: 'get',
    description: 'Read a resolved Memorix config value',
  },
  args: {
    key: {
      type: 'positional',
      description: 'Dotted config key, for example agent.model',
      required: true,
    },
  },
  run: async ({ args }) => {
    const key = String(args.key ?? '');
    const resolved = getResolvedConfigForCwd(process.cwd()) as unknown as Record<string, unknown>;
    const value = readDotted(resolved, key);
    if (value === undefined) {
      p.log.warn(`${key}: not set`);
      return;
    }
    p.log.info(`${key}: ${formatValue(value, key)}`);
  },
});

function readDotted(source: Record<string, unknown>, key: string): unknown {
  let cursor: unknown = source;
  for (const part of key.split('.')) {
    if (!cursor || typeof cursor !== 'object' || !(part in cursor)) return undefined;
    cursor = (cursor as Record<string, unknown>)[part];
  }
  return cursor;
}

function formatValue(value: unknown, key: string): string {
  if (typeof value === 'string') return shouldRedactKey(key) ? '<redacted>' : value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

function shouldRedactKey(key: string): boolean {
  return /(^|\.)(apiKey|api_key|key|token|secret|password|passwd|pwd)$/i.test(key);
}
