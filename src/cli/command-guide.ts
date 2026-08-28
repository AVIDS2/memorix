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
      'memorix memory long-term list [--all]',
      'memorix memory long-term add --kind semantic --scope user --portability portable --title "..." --text "..." [--tags "..."] [--applicability "..."]',
      'memorix memory long-term promote --from-observation 42 --kind procedural --scope project',
      'memorix memory long-term qualify|approve|archive --id <id> --reason "..."',
      'memorix memory long-term supersede --id <old-id> --superseded-by <qualified-id> --reason "..."',
    ],
    notes: [
      'Personal and team visibility require `memorix identity join` or `memorix identity use` first.',
      'Candidates never enter a task Workset. Only manual or user-confirmed `user + portable` memory may cross local projects.',
    ],
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
      'memorix codegraph init',
      'memorix codegraph sync',
      'memorix codegraph diff [--from <snapshot>] [--to <snapshot>]',
      'memorix codegraph impact --path <relative-source-path>',
      'memorix codegraph context-pack --task "trace the auth flow" [--limit 20]',
    ],
  },
  checkpoint: {
    summary: 'Inspect bounded recovery checkpoints created around host-native context compaction.',
    usage: [
      'memorix checkpoint list [--session <id>] [--agent <name>]',
      'memorix checkpoint show --id <checkpoint-id>',
      'memorix checkpoint context [--id <checkpoint-id>] [--task "continue auth fix"]',
      'memorix checkpoint archive --id <checkpoint-id>',
    ],
    notes: ['Checkpoints are host lifecycle evidence, not durable project memory and not transcript backups.'],
  },
  knowledge: {
    summary: 'Manage the reviewed, source-backed Knowledge Workspace and project workflows.',
    usage: [
      'memorix knowledge init [--mode local|versioned]',
      'memorix knowledge status',
      'memorix knowledge claims',
      'memorix knowledge review --id <claim-id> --review approved|rejected --detail "..."',
      'memorix knowledge compile',
      'memorix knowledge lint',
      'memorix knowledge apply --proposal <id> [--force]',
      'memorix knowledge workflow import|list',
      'memorix knowledge workflow select --task "prepare a release"',
      'memorix knowledge workflow preview|apply --id <workflow-id> --agent codex',
      'memorix knowledge workflow run --id <workflow-id> --task "..." --outcome passed',
    ],
    notes: ['Claims need source review before they can become maintained Knowledge Workspace pages.'],
  },
  evidence: {
    summary: 'Inspect the source, freshness, and verification state behind project memories.',
    usage: [
      'memorix evidence list [--query "auth"] [--limit 20]',
      'memorix evidence get --id 42',
      'memorix evidence sync',
      'memorix evidence stale --paths src/server.ts,tests/server.test.ts --reason "source changed"',
      'memorix evidence events --id 42',
    ],
    notes: ['Evidence cards point back to observations and source files; they are not a second memory store.'],
  },
  feedback: {
    summary: 'Record and inspect whether a memory helped, conflicted, or was corrected.',
    usage: [
      'memorix feedback record --id 42 --signal verification-success --source test:run-1',
      'memorix feedback show --id 42',
      'memorix feedback audit --id 42 [--limit 100]',
    ],
    notes: ['Feedback changes the candidate score through an auditable event; it does not rewrite the original memory.'],
  },
  formation: {
    summary: 'Inspect Memory Formation quality metrics collected by the runtime.',
    usage: ['memorix formation metrics'],
    notes: ['Metrics are empty until the formation pipeline has processed observations.'],
  },
  media: {
    summary: 'Import, inspect, derive, embed, and clean controlled local media assets.',
    usage: [
      'memorix media import --path ./diagram.png',
      'memorix media attach --asset <asset-id> --title "Architecture diagram"',
      'memorix media list --kind image',
      'memorix media show --asset <asset-id>',
      'memorix media derive-pdf|derive-audio --asset <asset-id> [--attach]',
      'memorix media embed|similar --asset <asset-id>',
      'memorix media generate image|video --prompt "..."',
      'memorix media status|cancel --job <media-job-id>',
      'memorix media cleanup [--max-bytes <limit>]',
    ],
    notes: ['Media generation is explicit and provider-gated; importing a file does not automatically send it to a model.'],
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
