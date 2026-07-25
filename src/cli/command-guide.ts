export interface CliCommandGuide {
  summary: string;
  usage: string[];
  notes?: string[];
}

const GUIDES: Record<string, CliCommandGuide> = {
  memory: {
    summary: 'Store, search, inspect, resolve, consolidate, and promote project memory.',
    usage: [
      'memorix memory search --query "timeout regression" [--limit 10]',
      'memorix memory store --text "..." [--title "..."] [--visibility project|personal|team]',
      'memorix memory detail --id 42',
      'memorix memory recent [--limit 10]',
      'memorix memory resolve --ids 42,43 [--status resolved|archived]',
      'memorix memory consolidate --action preview|execute',
      'memorix memory promote --ids 42,43 [--trigger "..."] [--instruction "..."]',
    ],
    notes: ['Personal and team visibility require `memorix identity join` or `memorix identity use` first.'],
  },
  identity: {
    summary: 'Select the active local actor for private memory and coordination commands.',
    usage: [
      'memorix identity status',
      'memorix identity join --agent-type codex [--name codex-main --instance-id local]',
      'memorix identity use --agent-id <id>',
      'memorix identity clear',
    ],
    notes: ['Without an identity, CLI reads and writes only project-visible memory.'],
  },
  session: {
    summary: 'Start, end, and inspect coding sessions. Coordination remains opt-in.',
    usage: [
      'memorix session start --agent codex',
      'memorix session start --agent codex --agent-type codex --join-team --use',
      'memorix session end --session-id <id> [--summary "..."]',
      'memorix session context [--limit 3]',
    ],
  },
  context: {
    summary: 'Build the bounded task Workset used to resume or begin real work.',
    usage: [
      'memorix context "continue the release fix" [--refresh auto|always|never]',
      'memorix resume "continue the release fix" [--refresh auto|always|never]',
    ],
  },
  explain: {
    summary: 'Show why a task context contains its current facts and memory evidence.',
    usage: ['memorix explain [--refresh auto|always|never]'],
  },
  codegraph: {
    summary: 'Refresh local code-state snapshots and assemble task-specific code context.',
    usage: [
      'memorix codegraph status',
      'memorix codegraph refresh',
      'memorix codegraph context-pack --task "trace the auth flow" [--limit 20]',
    ],
  },
  knowledge: {
    summary: 'Manage the reviewed, source-backed Knowledge Workspace and project workflows.',
    usage: [
      'memorix knowledge init [--mode local|versioned]',
      'memorix knowledge status',
      'memorix knowledge compile',
      'memorix knowledge lint',
      'memorix knowledge workflow list',
    ],
  },
  reasoning: {
    summary: 'Capture and retrieve engineering decision rationale.',
    usage: [
      'memorix reasoning store --entity auth --decision "Use SQLite" --rationale "..."',
      'memorix reasoning search --query "why sqlite" [--scope project|global]',
    ],
  },
  retention: {
    summary: 'Inspect retention state and archive records that are eligible under the current scope.',
    usage: [
      'memorix retention status',
      'memorix retention stale',
      'memorix retention archive',
    ],
  },
  transfer: {
    summary: 'Create or restore explicit project memory snapshots for backup and automation.',
    usage: [
      'memorix transfer export --format json --out ./.memorix-export.json',
      'memorix transfer import --file ./.memorix-export.json',
      'memorix transfer import --stdin',
    ],
  },
  team: {
    summary: 'Manage explicit multi-agent coordination state for the current project.',
    usage: [
      'memorix team join --agent-type codex [--name codex-main]',
      'memorix team status [--all]',
      'memorix team leave [--agent-id <id>]',
    ],
  },
  task: {
    summary: 'Create and progress coordination tasks. An active CLI identity fills agentId automatically.',
    usage: [
      'memorix task create --description "Review release evidence"',
      'memorix task claim --task-id <id>',
      'memorix task complete --task-id <id> --result "Verified"',
      'memorix task list [--available]',
    ],
  },
  message: {
    summary: 'Send and read coordination messages. An active CLI identity fills the sender automatically.',
    usage: [
      'memorix message send --to <agent-id> --type info --content "..."',
      'memorix message broadcast --type announcement --content "..."',
      'memorix message inbox [--mark-read]',
    ],
  },
  lock: {
    summary: 'Use advisory file locks to reduce overlapping edits between agents.',
    usage: [
      'memorix lock lock --file src/server.ts',
      'memorix lock unlock --file src/server.ts',
      'memorix lock status [--file src/server.ts]',
    ],
  },
  handoff: {
    summary: 'Create durable, targeted or team-visible handoff artifacts.',
    usage: ['memorix handoff send --summary "..." --context "..." [--to-agent-id <id>]'],
  },
  poll: {
    summary: 'Return a compact coordination snapshot for the active CLI identity.',
    usage: ['memorix poll [--mark-inbox-read]'],
  },
  audit: {
    summary: 'Inspect quality, attribution, and recorded audit evidence.',
    usage: ['memorix audit memory', 'memorix audit project [--threshold 2]', 'memorix audit list'],
  },
  skills: {
    summary: 'Inspect and generate project skills from project-visible memory evidence.',
    usage: ['memorix skills list', 'memorix skills generate [--write --target codex]', 'memorix skills show --name <skill>'],
  },
  sync: {
    summary: 'Synchronize agent rules and workspace artifacts through explicit routes.',
    usage: ['memorix sync rules --action status', 'memorix sync workspace --action scan'],
  },
  ingest: {
    summary: 'Ingest Git and image evidence into project memory.',
    usage: ['memorix ingest commit [--ref HEAD]', 'memorix ingest log [--count 10]', 'memorix ingest image --path ./diagram.png'],
  },
  workbench: {
    summary: 'Open the interactive terminal memory control plane.',
    usage: ['memorix workbench'],
  },
};

export function commandGuideNames(): string[] {
  return Object.keys(GUIDES).sort();
}

export function renderCliGuide(command?: string): string {
  const normalized = command?.trim().toLowerCase();
  if (normalized && GUIDES[normalized]) {
    const guide = GUIDES[normalized];
    return [
      `Memorix ${normalized}`,
      '',
      guide.summary,
      '',
      'Usage:',
      ...guide.usage.map((line) => `  ${line}`),
      ...(guide.notes?.length ? ['', ...guide.notes.map((line) => `Note: ${line}`)] : []),
      '',
      'Project/actor options: --cwd <git-project>  --as <active-agent-id>. Operator commands accept --json.',
    ].join('\n');
  }

  return [
    'Memorix CLI',
    '',
    'Use `memorix <command> --help` for an action-oriented guide.',
    '',
    `Command groups: ${commandGuideNames().join(', ')}`,
    '',
    'Global options: --cwd <git-project>  --as <active-agent-id>',
    'Compatibility: camelCase flags remain supported; kebab-case flags are accepted too.',
  ].join('\n');
}

/** Render manual action help before Citty consumes `--help` as flag metadata. */
export function printCliGuideForHelp(argv: string[] = process.argv.slice(2)): boolean {
  const [command, ...rest] = argv;
  if (!command || !GUIDES[command.toLowerCase()]) return false;
  if (!rest.includes('--help') && !rest.includes('-h')) return false;
  console.log(renderCliGuide(command));
  return true;
}
