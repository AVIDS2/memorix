import type { CompactionCheckpoint } from '../types.js';
import type { NormalizedHookInput } from '../hooks/types.js';
import { countTextTokens, truncateToTokenBudget } from '../compact/token-budget.js';
import { sanitizeCredentials } from './secret-filter.js';
import { CompactionCheckpointStore } from '../store/compaction-checkpoint-store.js';

const DEFAULT_WORKSET_BUDGET = 420;
const MIN_WORKSET_BUDGET = 48;

export interface CompactionWorkset {
  checkpointId: string;
  text: string;
  tokens: number;
}

export interface BuildCompactionWorksetOptions {
  task?: string;
  maxTokens?: number;
}

function normalizeBudget(value: number | undefined): number {
  if (!Number.isFinite(value) || value == null) return DEFAULT_WORKSET_BUDGET;
  return Math.max(MIN_WORKSET_BUDGET, Math.min(2_000, Math.floor(value)));
}

function sourceLabel(checkpoint: CompactionCheckpoint): string {
  if (checkpoint.captureKind === 'native-summary') return 'native host summary';
  if (checkpoint.captureKind === 'preflight') return 'pre-compact lifecycle marker';
  return 'host lifecycle marker';
}

/**
 * Render a small, source-aware continuation packet. It never replays a full
 * transcript and never promotes a native summary into durable knowledge.
 */
export function buildCompactionWorkset(
  checkpoint: CompactionCheckpoint,
  options: BuildCompactionWorksetOptions = {},
): CompactionWorkset {
  const budget = normalizeBudget(options.maxTokens);
  const task = options.task?.trim()
    ? truncateToTokenBudget(sanitizeCredentials(options.task.trim()), Math.max(8, Math.floor(budget * 0.25)))
    : '';
  const headerLines = [
    '## Compact Continuation',
    `- Host: ${checkpoint.agent} (${sourceLabel(checkpoint)})`,
    `- Trigger: ${checkpoint.reason}`,
    task ? `- Task now: ${task}` : '',
    '- Current code remains authoritative.',
  ].filter(Boolean);
  const header = `${headerLines.join('\n')}\n\n`;
  const fallback = checkpoint.captureKind === 'native-summary'
    ? ''
    : 'The host did not expose a native compact summary. Reconstruct only what the current task needs from current code and Memorix evidence.';
  const source = sanitizeCredentials(checkpoint.summary?.trim() || fallback);
  const available = Math.max(0, budget - countTextTokens(header) - 4);
  let excerpt = source ? truncateToTokenBudget(source, available) : '';
  let text = `${header}${excerpt ? `### Host checkpoint\n${excerpt}` : ''}`.trim();
  while (excerpt && countTextTokens(text) > budget) {
    const nextExcerptBudget = Math.max(1, Math.floor(countTextTokens(excerpt) * 0.8));
    excerpt = truncateToTokenBudget(excerpt, nextExcerptBudget);
    text = `${header}${excerpt ? `### Host checkpoint\n${excerpt}` : ''}`.trim();
  }
  if (countTextTokens(text) > budget) text = truncateToTokenBudget(text, budget);
  return {
    checkpointId: checkpoint.id,
    text,
    tokens: countTextTokens(text),
  };
}

function sourceEvent(input: NormalizedHookInput): string {
  const raw = input.raw;
  const event = raw.hook_event_name ?? raw.event ?? raw.type;
  return typeof event === 'string' && event ? event : input.event;
}

/**
 * Persist only the host lifecycle evidence available in a normalized hook.
 * The caller owns error handling so an unavailable local DB never blocks a
 * host-native compaction.
 */
export async function captureCompactionCheckpoint(
  input: NormalizedHookInput,
): Promise<CompactionCheckpoint | null> {
  const isCompactResume = input.event === 'session_start'
    && input.sessionStartReason?.trim().toLowerCase() === 'compact';
  if (input.event !== 'pre_compact' && input.event !== 'post_compact' && !isCompactResume) return null;
  if (!input.sessionId || !input.cwd) return null;

  const [
    { detectProject },
    { getProjectDataDir },
    { initAliasRegistry, registerAlias },
  ] = await Promise.all([
    import('../project/detector.js'),
    import('../store/persistence.js'),
    import('../project/aliases.js'),
  ]);
  const project = detectProject(input.cwd);
  if (!project) return null;
  const dataDir = await getProjectDataDir(project.id);
  initAliasRegistry(dataDir);
  const projectId = await registerAlias(project);
  const store = new CompactionCheckpointStore(dataDir);

  if (input.event === 'pre_compact') {
    return store.recordPreflight({
      projectId,
      sessionId: input.sessionId,
      agent: input.agent,
      reason: input.compaction?.reason,
      sourceEvent: sourceEvent(input),
      transcriptAvailable: Boolean(input.transcriptPath),
      capturedAt: input.timestamp,
    });
  }

  return store.complete({
    projectId,
    sessionId: input.sessionId,
    agent: input.agent,
    reason: input.compaction?.reason,
    sourceEvent: sourceEvent(input),
    sourceKey: input.compaction?.sourceKey,
    summary: input.compaction?.summary,
    tokensBefore: input.compaction?.tokensBefore,
    firstKeptEntryId: input.compaction?.firstKeptEntryId,
    details: input.compaction?.details,
    completedAt: input.timestamp,
  });
}

/**
 * Take the latest undelivered compact checkpoint for an exact host session.
 * Delivery is opt-in at adapter boundaries; this helper never injects content
 * into a host by itself.
 */
export async function consumeCompactionWorkset(
  input: NormalizedHookInput,
  options: BuildCompactionWorksetOptions = {},
): Promise<CompactionWorkset | null> {
  if (!input.sessionId || !input.cwd) return null;
  const [
    { detectProject },
    { getProjectDataDir },
    { initAliasRegistry, registerAlias },
  ] = await Promise.all([
    import('../project/detector.js'),
    import('../store/persistence.js'),
    import('../project/aliases.js'),
  ]);
  const project = detectProject(input.cwd);
  if (!project) return null;
  const dataDir = await getProjectDataDir(project.id);
  initAliasRegistry(dataDir);
  const projectId = await registerAlias(project);
  const store = new CompactionCheckpointStore(dataDir);
  const checkpoint = store.findUndelivered(projectId, input.sessionId, input.agent);
  if (!checkpoint) return null;
  const workset = buildCompactionWorkset(checkpoint, options);
  if (!workset.text) return null;
  store.markDelivered(checkpoint.id);
  return workset;
}
