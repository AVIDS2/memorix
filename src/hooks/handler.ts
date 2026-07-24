/**
 * Hook Handler
 *
 * Unified entry point for all agent hooks.
 * Architecture: Normalize → Classify → Admit → Store → Respond
 *
 * Design principles (inspired by claude-mem + mcp-memory-service):
 * - Candidate-first: automatic capture is never durable context by default
 * - Tool Taxonomy: declarative policies per tool category
 * - Pattern = classification only: determines observation type, not storage
 */

import type { ObservationType } from '../types.js';
import {
  assessHookAdmission,
  type HookAdmissionDecision,
  type HookCaptureCategory,
} from './admission.js';
import { normalizeHookInput } from './normalizer.js';
import { detectBestPattern, patternToObservationType } from './pattern-detector.js';
import { isSignificantKnowledge, isRetrievedResult, isTrivialCommand } from './significance-filter.js';
import type { AgentName, HookEvent, HookOutput, NormalizedHookInput } from './types.js';

// ─── Constants ───

/** Observation type → emoji mapping (single source of truth) */
export const TYPE_EMOJI: Record<string, string> = {
  'gotcha': '[GOTCHA]', 'decision': '[DECISION]', 'problem-solution': '[FIX]',
  'trade-off': '[TRADEOFF]', 'discovery': '[DISCOVERY]', 'how-it-works': '[INFO]',
  'what-changed': '[CHANGE]', 'why-it-exists': '[WHY]', 'session-request': '[SESSION]',
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
  /^(git\s+(status|log|diff|show|branch|remote|stash\s+list))(\s|$)/i,
  /^(npm\s+(list|ls|view|info|outdated|doctor))(\s|$)/i,
  /^(pip\s+(list|show|freeze)|python\s+--?version|node\s+--?version)(\s|$)/i,
  /^(env|printenv|set|export)(\s|$)/i,
];

// ─── Tool Taxonomy ───

/** Tool categories for storage policy */
type ToolCategory = HookCaptureCategory;

/** Storage policy per tool category */
interface StoragePolicy {
  /** always: store if content passes minLength; if_substantial: also require pattern or >200 chars; never: skip */
  store: 'always' | 'if_substantial' | 'never';
  minLength: number;
  defaultType: string;
}

const STORAGE_POLICY: Record<ToolCategory, StoragePolicy> = {
  file_modify:      { store: 'always',         minLength: 50,  defaultType: 'what-changed' },
  command:          { store: 'always',         minLength: 50,  defaultType: 'discovery' },
  file_read:        { store: 'never',          minLength: 0,   defaultType: 'discovery' },
  search:           { store: 'if_substantial', minLength: 500, defaultType: 'discovery' },
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

function buildCooldownKey(input: NormalizedHookInput, content: string): string {
  if (input.event === 'user_prompt' || input.event === 'post_response') {
    return `${input.event}:${input.sessionId}:${content.slice(0, 160)}`;
  }
  return `${input.event}:${input.filePath ?? input.command ?? input.toolName ?? 'general'}`;
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
  if (input.toolName) {
    const query = (input.toolInput as any)?.query ?? (input.toolInput as any)?.regex ?? '';
    if (query) return `${input.toolName}: ${query}`.slice(0, maxLen);
    return `Used ${input.toolName}`.slice(0, maxLen);
  }
  return `Activity (${patternType})`;
}

function buildObservation(
  input: NormalizedHookInput,
  content: string,
  category: ToolCategory,
  admission?: Extract<HookAdmissionDecision, { action: 'store' }>,
) {
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
    ...(admission ? {
      valueCategory: admission.valueCategory,
      admissionState: admission.admissionState,
      admissionReason: admission.admissionReason,
    } : {}),
  };
}

// ─── Session Start Handler ───

async function handleSessionStart(input: NormalizedHookInput): Promise<{
  observation: ReturnType<typeof buildObservation> | null;
  output: HookOutput;
}> {
  // Check behavior config for session injection level
  let injectMode: 'full' | 'minimal' | 'silent' = 'minimal';
  try {
    const { getBehaviorConfig } = await import('../config/behavior.js');
    injectMode = getBehaviorConfig().sessionInject;
  } catch { /* default to minimal */ }

  if (injectMode === 'silent') {
    return { observation: null, output: { continue: true } };
  }

  let contextSummary = '';
  if (injectMode === 'full') {
    try {
      const { detectProject } = await import('../project/detector.js');
      const { getProjectDataDir } = await import('../store/persistence.js');
      const { initObservationStore, getObservationStore: getStore } = await import('../store/obs-store.js');
      const { initMiniSkillStore } = await import('../store/mini-skill-store.js');
      const { initSessionStore } = await import('../store/session-store.js');
      const { initAliasRegistry, registerAlias } = await import('../project/aliases.js');
      const { MaintenanceTargetStore } = await import('../runtime/maintenance-targets.js');
      const { buildAutoProjectContext, formatAutoProjectContextPrompt } = await import('../codegraph/auto-context.js');

      const rawProject = detectProject(input.cwd || process.cwd());
      if (!rawProject) throw new Error('No .git found');
      const dataDir = await getProjectDataDir(rawProject.id);

      initAliasRegistry(dataDir);
      const canonicalId = await registerAlias(rawProject);
      new MaintenanceTargetStore(dataDir).register({
        projectId: canonicalId,
        projectRoot: rawProject.rootPath,
        dataDir,
      });
      await initObservationStore(dataDir);
      await initMiniSkillStore(dataDir);
      await initSessionStore(dataDir);
      const activeObservations = await getStore().loadByProject(canonicalId, { status: 'active' });
      const context = await buildAutoProjectContext({
        project: { ...rawProject, id: canonicalId },
        dataDir,
        observations: activeObservations,
        refresh: 'auto',
        enqueueRefresh: () => import('../runtime/lifecycle.js').then(({ enqueueCodegraphRefresh }) => {
            enqueueCodegraphRefresh({
              dataDir,
              projectId: canonicalId,
              source: 'hook-session-start',
              maxFiles: 5_000,
            });
          }),
        deliveryTarget: 'hook-session-start',
      });
      contextSummary = `\n\n${formatAutoProjectContextPrompt(context)}`;
    } catch (sessErr) {
      // Diagnostic log — session start context injection failed
      console.error('[memorix] session start context failed:', (sessErr as Error)?.message ?? sessErr);
    }
  }

  // Build system message based on inject mode
  let systemMessage: string;
  if (injectMode === 'full' && contextSummary) {
    systemMessage = `Previous session context may be available. Use memorix_search when prior project context would materially help. If search reports a fresh project with no Memorix memories yet, treat that as a cold-start signal and do not repeat the search in the same turn.${contextSummary}`;
  } else {
    // minimal: one-line hint, no memory content
    systemMessage = 'Previous session context may be available. Use memorix_search when prior project context would materially help. If search reports a fresh project with no Memorix memories yet, do not repeat the search in the same turn.';
  }

  return {
    observation: null,
    output: { continue: true, systemMessage },
  };
}

// ─── Main Handler: Classify → Policy → Store ───

/**
 * Handle a hook event using the Store-first pipeline.
 *
 * Pipeline: Classify → Policy check → Store → Respond
 * Pattern detection is used for classification only, not storage gating.
 */
async function handleHookEventCore(input: NormalizedHookInput): Promise<{
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
    const draft = buildObservation(input, endContent, 'unknown');
    const admission = assessHookAdmission({
      hook: input,
      category: 'unknown',
      content: endContent,
      observationType: draft.type,
    });
    return {
      observation: admission.action === 'store'
        ? buildObservation(input, endContent, 'unknown', admission)
        : null,
      output: defaultOutput,
    };
  }
  if (input.event === 'post_compact') {
    // Post-compaction: acknowledge the event, no observation needed.
    // The real value is the side-effect (runHook pipe) already handled by the plugin.
    return { observation: null, output: defaultOutput };
  }

  // ─── Classify & extract ───
  const category = classifyTool(input);
  const policy = STORAGE_POLICY[category] ?? STORAGE_POLICY.unknown;
  const content = extractContent(input);

  // Never-store category (memorix's own tools)
  if (policy.store === 'never') {
    return { observation: null, output: defaultOutput };
  }

  // ─── Significance Filter (Cipher-style noise rejection) ───
  // Skip trivial commands (ls, cd, git status, etc.)
  if (category === 'command' && input.command) {
    const realCmd = extractRealCommand(input.command);
    if (isTrivialCommand(realCmd)) {
      return { observation: null, output: defaultOutput };
    }
  }

  // Skip retrieved/search results (prevent memory pollution)
  if (isRetrievedResult(content)) {
    return { observation: null, output: defaultOutput };
  }

  // Minimum length gate
  const minLen = (input.event === 'user_prompt' || input.event === 'post_response')
    ? MIN_PROMPT_LENGTH
    : policy.minLength;
  if (content.length < minLen) {
    return { observation: null, output: defaultOutput };
  }

  // User prompts & AI responses are direct interaction — check significance
  const effectiveStore = (input.event === 'user_prompt' || input.event === 'post_response')
    ? 'always' as const
    : policy.store;

  // ─── Significance check for non-direct interactions ───
  // For tool results and commands, apply significance filter
  if (effectiveStore !== 'always') {
    const significance = isSignificantKnowledge(content);
    if (!significance.isSignificant) {
      return { observation: null, output: defaultOutput };
    }
  }

  // For 'if_substantial': require pattern OR content > 200 chars OR significance
  if (effectiveStore === 'if_substantial') {
    const pattern = detectBestPattern(content);
    const significance = isSignificantKnowledge(content);
    if (!pattern && content.length < 200 && !significance.isSignificant) {
      return { observation: null, output: defaultOutput };
    }
  }

  // Cooldown (per-file or per-command, not per-tool-category)
  const cooldownKey = buildCooldownKey(input, content);
  if (isInCooldown(cooldownKey)) {
    return { observation: null, output: defaultOutput };
  }
  markTriggered(cooldownKey);

  const draft = buildObservation(input, content, category);
  const admission = assessHookAdmission({
    hook: input,
    category,
    content,
    observationType: draft.type,
  });
  return {
    observation: admission.action === 'store'
      ? buildObservation(input, content, category, admission)
      : null,
    output: defaultOutput,
  };
}

/** Queue a later scan after an actual file mutation without scanning in the hook. */
async function queueCodegraphRefreshForMutation(input: NormalizedHookInput): Promise<void> {
  if (classifyTool(input) !== 'file_modify') return;
  try {
    const [
      { detectProject },
      { getProjectDataDir },
      { initAliasRegistry, registerAlias },
      { enqueueCodegraphRefresh },
      { MaintenanceTargetStore },
    ] = await Promise.all([
      import('../project/detector.js'),
      import('../store/persistence.js'),
      import('../project/aliases.js'),
      import('../runtime/lifecycle.js'),
      import('../runtime/maintenance-targets.js'),
    ]);
    const project = detectProject(input.cwd || process.cwd());
    if (!project) return;
    const dataDir = await getProjectDataDir(project.id);
    initAliasRegistry(dataDir);
    const projectId = await registerAlias(project);
    new MaintenanceTargetStore(dataDir).register({
      projectId,
      projectRoot: project.rootPath,
      dataDir,
    });
    enqueueCodegraphRefresh({
      dataDir,
      projectId,
      source: 'hook-file-mutation',
      maxFiles: 5_000,
    });
  } catch {
    // Hooks remain capture-first even if optional Code Memory scheduling fails.
  }
}

export async function handleHookEvent(input: NormalizedHookInput): Promise<{
  observation: ReturnType<typeof buildObservation> | null;
  output: HookOutput;
}>;
export async function handleHookEvent(input: NormalizedHookInput, options: {
  deferMaintenance?: boolean;
}): Promise<{
  observation: ReturnType<typeof buildObservation> | null;
  output: HookOutput;
}>;
export async function handleHookEvent(input: NormalizedHookInput, options: {
  deferMaintenance?: boolean;
} = {}): Promise<{
  observation: ReturnType<typeof buildObservation> | null;
  output: HookOutput;
}> {
  try {
    return await handleHookEventCore(input);
  } finally {
    // The CLI persists an automatic observation after this function returns.
    // It defers scheduling so a fast worker never scans before that write.
    if (!options.deferMaintenance) await queueCodegraphRefreshForMutation(input);
  }
}

/**
 * Convert Memorix's neutral hook response into the host-specific response
 * schema expected by each supported agent.
 */
export function formatHookOutput(
  agent: AgentName,
  rawEventName: string,
  output: HookOutput,
): Record<string, unknown> {
  if (agent === 'codex') {
    const codexOutput: Record<string, unknown> = { continue: output.continue };
    if (output.stopReason) codexOutput.stopReason = output.stopReason;

    // Codex adds SessionStart additionalContext directly to developer context.
    // Capture-only events deliberately stay quiet so automatic memory never
    // becomes a stream of status messages in the agent's working context.
    if (rawEventName === 'SessionStart' && output.systemMessage) {
      codexOutput.hookSpecificOutput = {
        hookEventName: 'SessionStart',
        additionalContext: output.systemMessage,
      };
    }

    return codexOutput;
  }

  const finalOutput: Record<string, unknown> = { ...output };
  const hookSpecificOutputEvents = new Set([
    'PreToolUse',
    'UserPromptSubmit',
    'PostToolUse',
    'postToolUse',
    'preToolUse',
    'userPromptSubmitted',
  ]);

  if (rawEventName && hookSpecificOutputEvents.has(rawEventName)) {
    const hookSpecificOutput: Record<string, unknown> = { hookEventName: rawEventName };
    if (output.systemMessage) {
      hookSpecificOutput.additionalContext = output.systemMessage;
    } else if (rawEventName === 'UserPromptSubmit') {
      hookSpecificOutput.additionalContext = '';
    }
    finalOutput.hookSpecificOutput = hookSpecificOutput;
  }

  return finalOutput;
}

// ─── Entry Point ───

/**
 * Main entry point: read stdin, process, write stdout.
 * Called by the CLI: `memorix hook`
 */
export async function runHook(agentOverride?: string, eventOverride?: string): Promise<void> {
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
    process.stdout.write(JSON.stringify({ continue: true }));
    return;
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawInput);
  } catch {
    process.stdout.write(JSON.stringify({ continue: true }));
    return;
  }

  // Inject agent identity from CLI --agent flag into the payload
  // so the normalizer can reliably identify the source agent.
  if (agentOverride) {
    payload._memorix_agent = agentOverride;
  }
  if (eventOverride) {
    payload._memorix_event = eventOverride;
  }

  const input = normalizeHookInput(payload);
  const { observation, output } = await handleHookEvent(input, { deferMaintenance: true });

  if (observation) {
    try {
      const { storeObservation, initObservations } = await import('../memory/observations.js');
      const { initObservationStore } = await import('../store/obs-store.js');
      const { initMiniSkillStore: initMSStore } = await import('../store/mini-skill-store.js');
      const { initSessionStore: initSessStore } = await import('../store/session-store.js');
      const { detectProject } = await import('../project/detector.js');
      const { getProjectDataDir } = await import('../store/persistence.js');
      const { initAliasRegistry, registerAlias } = await import('../project/aliases.js');
      const { MaintenanceTargetStore } = await import('../runtime/maintenance-targets.js');

      const rawProject = detectProject(input.cwd || process.cwd());
      if (!rawProject) throw new Error('No .git found');
      const dataDir = await getProjectDataDir(rawProject.id);
      
      // Resolve to canonical project ID (same as server.ts does)
      initAliasRegistry(dataDir);
      const canonicalId = await registerAlias(rawProject);
      const projectId = canonicalId;
      new MaintenanceTargetStore(dataDir).register({
        projectId,
        projectRoot: rawProject.rootPath,
        dataDir,
      });
      
      await initObservationStore(dataDir);
      await initMSStore(dataDir);
      await initSessStore(dataDir);
      await initObservations(dataDir);
      await storeObservation({ ...observation, projectId, sourceDetail: 'hook' });
      // Automatic capture is deliberately quiet. Candidate state and later
      // qualification are visible through Memorix inspection, not injected as
      // a stream of status messages into the host agent's context.
    } catch (storeErr) {
      // Diagnostic log — hooks must never break the agent, but silent
      // swallow makes end-to-end debugging impossible.
      console.error('[memorix] hook store failed:', (storeErr as Error)?.message ?? storeErr);
    }
  }

  // A candidate must be durable before a Code Memory refresh can qualify it.
  // Keep direct handleHookEvent() backward-compatible, but make the real CLI
  // hook path explicitly capture first and schedule second.
  await queueCodegraphRefreshForMutation(input);

  // Build hookSpecificOutput — Claude Code only supports it for 3 event types:
  //   PreToolUse, UserPromptSubmit, PostToolUse
  // Other events (SessionStart, Stop, PreCompact) must NOT include hookSpecificOutput.
  // Claude Code sends hook_event_name (snake_case), Copilot sends hookEventName (camelCase)
  const rawEventName = (payload._memorix_event as string)
    ?? (payload.hook_event_name as string)
    ?? (payload.hookEventName as string)
    ?? '';
  if (input.agent === 'antigravity') {
    process.stdout.write(JSON.stringify(toAntigravityHookOutput(rawEventName, output)));
    return;
  }
  const finalOutput = formatHookOutput(input.agent, rawEventName, output);
  process.stdout.write(JSON.stringify(finalOutput));
}

function toAntigravityHookOutput(rawEventName: string, output: HookOutput): Record<string, unknown> {
  switch (rawEventName) {
    case 'PreToolUse':
      return {
        decision: output.continue === false ? 'deny' : 'allow',
        ...(output.stopReason ? { reason: output.stopReason } : {}),
      };
    case 'PostToolUse':
      return {};
    case 'PreInvocation':
      return output.systemMessage
        ? { injectSteps: [{ ephemeralMessage: output.systemMessage }] }
        : { injectSteps: [] };
    case 'PostInvocation':
      return {
        injectSteps: output.systemMessage ? [{ ephemeralMessage: output.systemMessage }] : [],
        terminationBehavior: output.continue === false ? 'terminate' : '',
      };
    case 'Stop':
      return { decision: '' };
    default:
      return {};
  }
}
