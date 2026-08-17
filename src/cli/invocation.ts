import { existsSync, realpathSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

export interface CliInvocation {
  projectRoot?: string;
  actorId?: string;
}

type InvocationOption = 'projectRoot' | 'actorId';

const GLOBAL_OPTIONS: Record<string, InvocationOption> = {
  '--cwd': 'projectRoot',
  '--project-root': 'projectRoot',
  '--as': 'actorId',
  '--actor': 'actorId',
};

// Existing commands use camelCase Citty keys. Preserve them for compatibility
// while accepting the shell-native kebab-case spelling everywhere.
const FLAG_ALIASES: Record<string, string> = {
  '--agent-type': '--agentType',
  '--instance-id': '--instanceId',
  '--agent-id': '--agentId',
  '--from-agent-id': '--fromAgentId',
  '--to-agent-id': '--toAgentId',
  '--join-team': '--joinTeam',
  '--session-id': '--sessionId',
  '--task-id': '--taskId',
  '--topic-key': '--topicKey',
  '--graph-limit': '--graphLimit',
  '--graph-query': '--graphQuery',
  '--skill-id': '--skillId',
  '--required-role': '--requiredRole',
  '--preferred-role': '--preferredRole',
  '--to-role': '--toRole',
  '--handoff-status': '--handoffStatus',
  '--max-concurrent': '--maxConcurrent',
  '--role-id': '--roleId',
  '--preferred-agent-types': '--preferredAgentTypes',
  '--files-modified': '--filesModified',
  '--expected-outcome': '--expectedOutcome',
  '--related-commits': '--relatedCommits',
  '--related-entities': '--relatedEntities',
  '--mime-type': '--mimeType',
  '--mark-read': '--markRead',
  '--mark-inbox-read': '--markInboxRead',
};

function readOption(argument: string): { name: string; value?: string } {
  const equals = argument.indexOf('=');
  return equals === -1
    ? { name: argument }
    : { name: argument.slice(0, equals), value: argument.slice(equals + 1) };
}

/**
 * Normalize the small set of global operator flags before Citty resolves a
 * command. This gives every CLI command the same project and actor anchors
 * without duplicating those flags across dozens of command definitions.
 */
export function normalizeCliInvocation(argv: string[] = process.argv): CliInvocation {
  const normalized = argv.slice(0, 2);
  const invocation: CliInvocation = {};

  for (let index = 2; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--') {
      normalized.push(...argv.slice(index));
      break;
    }

    const { name, value: inlineValue } = readOption(argument);
    const target = GLOBAL_OPTIONS[name];
    if (!target) {
      const alias = FLAG_ALIASES[name];
      normalized.push(alias
        ? (inlineValue === undefined ? alias : `${alias}=${inlineValue}`)
        : argument);
      continue;
    }

    const value = inlineValue ?? argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`${name} requires a value`);
    }
    invocation[target] = value;
    if (inlineValue === undefined) index += 1;
  }

  if (invocation.projectRoot) {
    const resolvedProjectRoot = resolve(invocation.projectRoot);
    if (!existsSync(resolvedProjectRoot) || !statSync(resolvedProjectRoot).isDirectory()) {
      throw new Error(`CLI project directory does not exist: ${resolvedProjectRoot}`);
    }
    // Keep one project identity when an OS exposes the same directory through
    // two paths (for example /var and /private/var on macOS).
    const projectRoot = realpathSync(resolvedProjectRoot);
    process.chdir(projectRoot);
    process.env.MEMORIX_CLI_PROJECT_ROOT = projectRoot;
    invocation.projectRoot = projectRoot;
  }

  if (invocation.actorId) {
    process.env.MEMORIX_CLI_ACTOR_ID = invocation.actorId;
  }

  process.argv = normalized;
  return invocation;
}

export function getCliInvocation(): CliInvocation {
  const projectRoot = process.env.MEMORIX_CLI_PROJECT_ROOT?.trim();
  const actorId = process.env.MEMORIX_CLI_ACTOR_ID?.trim();
  return {
    ...(projectRoot ? { projectRoot } : {}),
    ...(actorId ? { actorId } : {}),
  };
}
