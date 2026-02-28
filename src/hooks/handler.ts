/**
 * Hook Handler
 *
 * Unified entry point for all agent hooks.
 * Architecture: Normalize → Classify → Policy → Store → Respond
 *
 * Design principles (inspired by claude-mem + mcp-memory-service):
 * - Store-first: capture generously, filter at read time
 * - Tool Taxonomy: declarative policies per tool category
 * - Pattern = classification only: determines observation type, not storage
 */

import type { ObservationType } from '../types.js';
import { normalizeHookInput } from './normalizer.js';
import { detectBestPattern, patternToObservationType } from './pattern-detector.js';
import type { HookEvent, HookOutput, NormalizedHookInput } from './types.js';

// ─── Constants ───

/** Observation type → emoji mapping (single source of truth) */
export const TYPE_EMOJI: Record<string, string> = {
  'gotcha': '🔴', 'decision': '🟤', 'problem-solution': '🟡',
  'trade-off': '⚖️', 'discovery': '🟣', 'how-it-works': '🔵',
  'what-changed': '🟢', 'why-it-exists': '🟠', 'session-request': '🎯',
};

/** Cooldown tracker: eventKey → lastTimestamp */
const cooldowns = new Map<string, number>();
const COOLDOWN_MS = 30_000;

/** Minimum content length for user prompts (short prompts are still valuable) */
const MIN_PROMPT_LENGTH = 20;

/** Max content length (truncate beyond this) */
const MAX_CONTENT_LENGTH = 4000;

/** Truly trivial commands — standalone navigation/inspection only */
const NOISE_COMMANDS = [
  /^(ls|dir|cd|pwd|echo|cat|type|head|tail|wc|which|where|whoami)(\s|$)/i,
  /^(Get-Content|Test-Path|Get-Item|Get-ChildItem|Set-Location|Write-Host)(\s|$)/i,
  /^(Start-Sleep|Select-String|Select-Object|Format-Table|Measure-Object)(\s|$)/i,
];

// ─── Tool Taxonomy ───

/** Tool categories for storage policy */
type ToolCategory = 'file_modify' | 'file_read' | 'command' | 'search' | 'memorix_internal' | 'unknown';

/** Storage policy per tool category */
interface StoragePolicy {
  /** always: store if content passes minLength; if_substantial: also require pattern or >200 chars; never: skip */
  store: 'always' | 'if_substantial' | 'never';
  minLength: number;
  defaultType: string;
}

const STORAGE_POLICY: Record<ToolCategory, StoragePolicy> = {
  file_modify:      { store: 'always',         minLength: 50,  defaultType: 'what-changed' },
  command:          { store: 'always',         minLength: 30,  defaultType: 'discovery' },
  file_read:        { store: 'if_substantial', minLength: 200, defaultType: 'discovery' },
  search:           { store: 'if_substantial', minLength: 200, defaultType: 'discovery' },
  memorix_internal: { store: 'never',          minLength: 0,   defaultType: 'discovery' },
  unknown:          { store: 'if_substantial', minLength: 100, defaultType: 'discovery' },
};

/**
 * Classify a tool by its event type, tool name, and input characteristics.
 */
function classifyTool(input: NormalizedHookInput): ToolCategory {
  // Event-based classification (Windsurf/Cursor send specific events)
  if (input.event === 'post_edit') return 'file_modify';
  if (input.event === 'post_command') return 'command';

  // Tool name-based classification (Claude Code sends PostToolUse for everything)
  const name = (input.toolName ?? '').toLowerCase();

  if (name.startsWith('memorix_')) return 'memorix_internal';

  if (/^(write|edit|multi_?edit|multiedittool|create|patch|insert|notebook_?edit)$/i.test(name)) {
    return 'file_modify';
  }
  if (/^(read|read_?file|view|list_?dir)$/i.test(name)) {
    return 'file_read';
  }
  if (/^(bash|shell|terminal|command|run)$/i.test(name) || input.command) {
    return 'command';
  }
  if (/^(search|grep|ripgrep|find_?by_?name|glob)$/i.test(name)) {
    return 'search';
  }

  return 'unknown';
}

/**
 * Strip `cd /path && ` prefix from compound commands.
 * Claude Code often sends `cd /project/dir && npm test 2>&1`.
 */
function extractRealCommand(command: string): string {
  return command.replace(/^cd\s+\S+\s*&&\s*/i, '').trim();
}

/**
 * Check if a command is trivial noise (standalone navigation/inspection).
 */
function isNoiseCommand(command: string): boolean {
  const real = extractRealCommand(command);
  if (NOISE_COMMANDS.some(r => r.test(real))) return true;
  // Filter self-referential commands (inspecting memorix's own data)
  if (/\.memorix[/\\]|observations\.json|memorix.*data/i.test(command)) return true;
  return false;
}

/**
 * Check if an event is in cooldown.
 */
function isInCooldown(eventKey: string): boolean {
  const last = cooldowns.get(eventKey);
  if (!last) return false;
  return Date.now() - last < COOLDOWN_MS;
}

/**
 * Mark an event as triggered (start cooldown).
 */
function markTriggered(eventKey: string): void {
  cooldowns.set(eventKey, Date.now());
}

/**
 * Reset all cooldowns (for testing only — in production each hook call is a separate process).
 */
export function resetCooldowns(): void {
  cooldowns.clear();
}

// ─── Content Extraction ───

/**
 * Build content string from normalized input for pattern detection and storage.
 */
function extractContent(input: NormalizedHookInput): string {
  const parts: string[] = [];

  if (input.userPrompt) parts.push(input.userPrompt);
  if (input.aiResponse) parts.push(input.aiResponse);
  if (input.commandOutput) parts.push(input.commandOutput);
  if (input.command) parts.push(`Command: ${extractRealCommand(input.command)}`);
  if (input.filePath) parts.push(`File: ${input.filePath}`);
  if (input.edits) {
    for (const edit of input.edits) {
      parts.push(`Edit: ${edit.oldString} → ${edit.newString}`);
    }
  }

  // Always extract from toolInput — toolResult is often just "File written successfully"
  if (input.toolInput && typeof input.toolInput === 'object') {
    if (input.toolName) parts.push(`Tool: ${input.toolName}`);
    if (input.toolInput.command && !input.command) {
      parts.push(`Command: ${input.toolInput.command as string}`);
    }
    if (input.toolInput.file_path && !input.filePath) {
      parts.push(`File: ${input.toolInput.file_path as string}`);
    }
    if (input.toolInput.content) {
      parts.push((input.toolInput.content as string).slice(0, 1000));
    }
    if (input.toolInput.old_string || input.toolInput.new_string) {
      const oldStr = (input.toolInput.old_string as string) ?? '';
      const newStr = (input.toolInput.new_string as string) ?? '';
      parts.push(`Edit: ${oldStr.slice(0, 300)} → ${newStr.slice(0, 300)}`);
    }
    if (input.toolInput.query) parts.push(`Query: ${input.toolInput.query as string}`);
    if (input.toolInput.regex) parts.push(`Search: ${input.toolInput.regex as string}`);
  }

  if (input.toolResult) parts.push(input.toolResult);

  return parts.join('\n').slice(0, MAX_CONTENT_LENGTH);
}

// ─── Observation Building ───

function deriveEntityName(input: NormalizedHookInput): string {
  if (input.filePath) {
    const parts = input.filePath.replace(/\\/g, '/').split('/');
    const filename = parts[parts.length - 1];
    return filename.replace(/\.[^.]+$/, '');
  }
  if (input.toolName) return input.toolName;
  if (input.command) {
    const firstWord = extractRealCommand(input.command).split(/\s+/)[0];
    return firstWord.replace(/[^a-zA-Z0-9-_]/g, '');
  }
  return 'session';
}

function generateTitle(input: NormalizedHookInput, patternType: string): string {
  const maxLen = 60;
  if (input.filePath) {
    const filename = input.filePath.replace(/\\/g, '/').split('/').pop() ?? '';
    const verb =
      patternType === 'problem-solution'
        ? 'Fixed issue in'
        : patternType === 'what-changed'
          ? 'Changed'
          : 'Updated';
    return `${verb} ${filename}`.slice(0, maxLen);
  }
  if (input.command) {
    return `Ran: ${extractRealCommand(input.command)}`.slice(0, maxLen);
  }
  if (input.userPrompt) {
    return input.userPrompt.slice(0, maxLen);
  }
  return `Session activity (${patternType})`;
}

function buildObservation(input: NormalizedHookInput, content: string, category: ToolCategory) {
  const pattern = detectBestPattern(content);
  const policy = STORAGE_POLICY[category] ?? STORAGE_POLICY.unknown;
  const fallbackType = input.filePath ? 'what-changed' : policy.defaultType;
  const obsType = (pattern ? patternToObservationType(pattern.type) : fallbackType) as ObservationType;

  return {
    entityName: deriveEntityName(input),
    type: obsType,
    title: generateTitle(input, obsType),
    narrative: content.slice(0, 2000),
    facts: [
      `Agent: ${input.agent}`,
      `Session: ${input.sessionId}`,
      ...(input.filePath ? [`File: ${input.filePath}`] : []),
      ...(input.command ? [`Command: ${extractRealCommand(input.command)}`] : []),
    ],
    concepts: pattern?.matchedKeywords ?? [],
    filesModified: input.filePath ? [input.filePath] : [],
  };
}

// ─── Session Start Handler ───

async function handleSessionStart(input: NormalizedHookInput): Promise<{
  observation: ReturnType<typeof buildObservation> | null;
  output: HookOutput;
}> {
  let contextSummary = '';
  try {
    const { detectProject } = await import('../project/detector.js');
    const { getProjectDataDir, loadObservationsJson } = await import('../store/persistence.js');

    const project = await detectProject(input.cwd || process.cwd());
    const dataDir = await getProjectDataDir(project.id);
    const allObs = await loadObservationsJson(dataDir) as Array<{
      type?: string; title?: string; narrative?: string;
      facts?: string[]; timestamp?: string;
    }>;

    if (allObs.length > 0) {
      const PRIORITY_ORDER: Record<string, number> = {
        'gotcha': 6, 'decision': 5, 'problem-solution': 4,
        'trade-off': 3, 'discovery': 2, 'how-it-works': 1,
      };
      const LOW_QUALITY_PATTERNS = [
        /^Session activity/i,
        /^Updated \S+\.\w+$/i,
        /^Created \S+\.\w+$/i,
        /^Deleted \S+\.\w+$/i,
        /^Modified \S+\.\w+$/i,
      ];
      const isLowQuality = (title: string) =>
        LOW_QUALITY_PATTERNS.some(p => p.test(title));

      const scored = allObs
        .map((obs, i) => {
          const title = obs.title ?? '';
          const hasFacts = (obs.facts?.length ?? 0) > 0;
          const hasSubstance = title.length > 20 || hasFacts;
          const quality = isLowQuality(title) ? 0.1 : hasSubstance ? 1.0 : 0.5;
          return { obs, priority: PRIORITY_ORDER[obs.type ?? ''] ?? 0, quality, recency: i };
        })
        .sort((a, b) => {
          const scoreA = a.priority * a.quality;
          const scoreB = b.priority * b.quality;
          if (scoreB !== scoreA) return scoreB - scoreA;
          return b.recency - a.recency;
        });

      const top = scored.slice(0, 5);
      const lines = top.map(({ obs }) => {
        const emoji = TYPE_EMOJI[obs.type ?? ''] ?? '📌';
        const title = obs.title ?? '(untitled)';
        const fact = obs.facts?.[0] ? ` — ${obs.facts[0]}` : '';
        return `${emoji} ${title}${fact}`;
      });

      contextSummary = `\n\nRecent project memories (${project.name}):\n${lines.join('\n')}`;
    }
  } catch {
    // Silent fail — hooks must never break the agent
  }

  return {
    observation: null,
    output: {
      continue: true,
      systemMessage:
        `Memorix is active. Your memories from previous sessions are available via memorix_search.${contextSummary}`,
    },
  };
}

// ─── Main Handler: Classify → Policy → Store ───

/**
 * Handle a hook event using the Store-first pipeline.
 *
 * Pipeline: Classify → Policy check → Store → Respond
 * Pattern detection is used for classification only, not storage gating.
 */
export async function handleHookEvent(input: NormalizedHookInput): Promise<{
  observation: ReturnType<typeof buildObservation> | null;
  output: HookOutput;
}> {
  const defaultOutput: HookOutput = { continue: true };

  // ─── Session lifecycle (special handling) ───
  if (input.event === 'session_start') {
    return handleSessionStart(input);
  }
  if (input.event === 'session_end') {
    const endContent = extractContent(input);
    if (endContent.length < 50) {
      return { observation: null, output: defaultOutput };
    }
    return {
      observation: buildObservation(input, endContent, 'unknown'),
      output: defaultOutput,
    };
  }

  // ─── Classify & extract ───
  const category = classifyTool(input);
  const policy = STORAGE_POLICY[category] ?? STORAGE_POLICY.unknown;
  const content = extractContent(input);

  // Never-store category (memorix's own tools)
  if (policy.store === 'never') {
    return { observation: null, output: defaultOutput };
  }

  // Noise command filter (with cd-prefix stripping)
  if (category === 'command' && input.command && isNoiseCommand(input.command)) {
    return { observation: null, output: defaultOutput };
  }

  // Minimum length gate
  const minLen = input.event === 'user_prompt' ? MIN_PROMPT_LENGTH : policy.minLength;
  if (content.length < minLen) {
    return { observation: null, output: defaultOutput };
  }

  // User prompts & AI responses are direct interaction — always store
  const effectiveStore = (input.event === 'user_prompt' || input.event === 'post_response')
    ? 'always' as const
    : policy.store;

  // For 'if_substantial': require pattern OR content > 200 chars
  if (effectiveStore === 'if_substantial') {
    const pattern = detectBestPattern(content);
    if (!pattern && content.length < 200) {
      return { observation: null, output: defaultOutput };
    }
  }

  // Cooldown (per-file or per-command, not per-tool-category)
  const cooldownKey = `${input.event}:${input.filePath ?? input.command ?? input.toolName ?? 'general'}`;
  if (isInCooldown(cooldownKey)) {
    return { observation: null, output: defaultOutput };
  }
  markTriggered(cooldownKey);

  return {
    observation: buildObservation(input, content, category),
    output: defaultOutput,
  };
}

// ─── Entry Point ───

/**
 * Main entry point: read stdin, process, write stdout.
 * Called by the CLI: `memorix hook`
 */
export async function runHook(): Promise<void> {
  // Read stdin with a timeout — some hosts (e.g. Gemini CLI) may not close
  // stdin promptly, causing `for await` to hang until the process is killed.
  const rawInput = await new Promise<string>((resolve) => {
    const chunks: Buffer[] = [];
    const finish = () => resolve(Buffer.concat(chunks).toString('utf-8').trim());

    // Hard timeout: resolve with whatever we have after 3 s
    const timer = setTimeout(() => {
      process.stdin.removeAllListeners('data');
      process.stdin.removeAllListeners('end');
      finish();
    }, 3_000);

    process.stdin.on('data', (chunk: Buffer) => { chunks.push(chunk); });
    process.stdin.on('end', () => { clearTimeout(timer); finish(); });
    process.stdin.on('error', () => { clearTimeout(timer); finish(); });
  });

  if (!rawInput) {
    process.stdout.write(JSON.stringify({ continue: true, hookSpecificOutput: {} }));
    return;
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawInput);
  } catch {
    process.stdout.write(JSON.stringify({ continue: true, hookSpecificOutput: {} }));
    return;
  }

  const input = normalizeHookInput(payload);
  const { observation, output } = await handleHookEvent(input);

  if (observation) {
    try {
      const { storeObservation, initObservations } = await import('../memory/observations.js');
      const { detectProject } = await import('../project/detector.js');
      const { getProjectDataDir } = await import('../store/persistence.js');

      const project = await detectProject(input.cwd || process.cwd());
      const dataDir = await getProjectDataDir(project.id);
      await initObservations(dataDir);
      await storeObservation({ ...observation, projectId: project.id });

      // Feedback: tell the agent what was saved
      const emoji = TYPE_EMOJI[observation.type] ?? '📝';
      output.systemMessage = (output.systemMessage ?? '') +
        `\n${emoji} Memorix saved: ${observation.title} [${observation.type}]`;
    } catch {
      // Silent fail — hooks must never break the agent
    }
  }

  // Include hookSpecificOutput for VS Code Copilot compatibility
  const hookEventName = (payload.hookEventName as string) ?? '';
  const finalOutput: Record<string, unknown> = { ...output };
  finalOutput.hookSpecificOutput = {
    ...(hookEventName ? { hookEventName } : {}),
    ...(output.systemMessage ? { additionalContext: output.systemMessage } : {}),
  };
  process.stdout.write(JSON.stringify(finalOutput));
}
