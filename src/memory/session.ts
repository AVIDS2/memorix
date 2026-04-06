/**
 * Session Lifecycle Manager
 *
 * Tracks coding sessions across agents and provides context injection
 * for new sessions. Inspired by Engram's session management pattern.
 *
 * Key features:
 * - Start/end session tracking
 * - Structured session summaries (Goal/Discoveries/Accomplished/Files)
 * - Auto-inject previous session context on session start
 * - Cross-agent session awareness (all agents share session data)
 */

import type { Observation, Session } from '../types.js';
import { classifyLayer } from './disclosure-policy.js';
import { resolveAliases } from '../project/aliases.js';
import { getObservationStore } from '../store/obs-store.js';
import { getSessionStore } from '../store/session-store.js';
import { KnowledgeGraphManager } from './graph.js';
import { redactCredentials, sanitizeCredentials } from './secret-filter.js';

const PRIORITY_TYPES = new Set(['gotcha', 'decision', 'problem-solution', 'trade-off', 'discovery']);
const TYPE_EMOJI: Record<string, string> = {
  'gotcha': '🔶',
  'decision': '🟠',
  'problem-solution': '🟡',
  'trade-off': '⚖️',
  'discovery': '🟣',
  'how-it-works': '🔵',
  'what-changed': '🟢',
  'why-it-exists': '🟤',
  'session-request': '🎯',
};
const TYPE_WEIGHTS: Record<string, number> = {
  'gotcha': 6,
  'decision': 5.5,
  'problem-solution': 5.25,
  'trade-off': 4.75,
  'discovery': 4.25,
};
const NOISE_PATTERNS = [
  /\[测试\]/i,
  /\[test\]/i,
  /验证/i,
  /兼容/i,
  /\bcompat(?:ibility)?\b/i,
  /\bdemo\b/i,
  /展示/i,
  /全能力/i,
  /handoff/i,
  /交接/i,
  /for_memmcp_test/i,
  /\bbenchmark\b/i,
  /\bsandbox\b/i,
  /\bplayground\b/i,
];

// Command-trace observations (debug commands, shell output) are low-value noise
// in session context. They may have been stored by hooks but shouldn't surface.
const COMMAND_TRACE_PATTERNS = [
  /^Ran:\s/i,
  /^Command:\s/i,
  /^Executed:\s/i,
  /\b2>&1\b/,
  /\bSelect-String\b/i,
  /\bGet-Content\b/i,
  /\bnpx\s+vitest\b/i,
  /\bnpx\s+tsc\b/i,
];

// Observations about Memorix itself (its tools, internals, runtime modes) should almost
// never be injected into unrelated projects.  These get a much heavier penalty.
const SYSTEM_SELF_PATTERNS = [
  /memorix.demo/i,
  /memorix.*全能力/i,
  /memorix.*工具.*能力/i,
  /memorix.*runtime.*mode/i,
  /memorix.*运行模式/i,
  /memorix.*control.plane/i,
  /session.*inject(?:ion)?/i,
  /注入.*逻辑/i,
  /\b22\s*(?:个|tools?).*(?:工具|能力|capabilit)/i,
  /memorix.*(?:v\d|版本|version)/i,
  /memorix.*(?:兼容|compat)/i,
  /memorix.*(?:测试|test)/i,
  /memmcp/i,
];

/**
 * Resolve a projectId into a Set of all known aliases.
 * Ensures sessions stored under any alias are found regardless of which IDE stored them.
 */
async function resolveProjectIds(projectId: string): Promise<Set<string>> {
  try {
    const aliases = await resolveAliases(projectId);
    return new Set(aliases);
  } catch {
    return new Set([projectId]);
  }
}

/**
 * Generate a unique session ID.
 */
function generateSessionId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `sess-${ts}-${rand}`;
}

function tokenizeProjectId(projectId: string): string[] {
  const leaf = projectId.split('/').at(-1) ?? projectId;
  return Array.from(
    new Set(
      leaf
        .toLowerCase()
        .split(/[^a-z0-9]+/i)
        .map((token) => token.trim())
        .filter((token) => token.length >= 2),
    ),
  );
}

function stringifyObservation(obs: Observation, includeFiles: boolean = true): string {
  const parts = [
    obs.title,
    obs.narrative,
    obs.entityName,
    ...(obs.facts ?? []),
    ...(obs.concepts ?? []),
  ];

  if (includeFiles) {
    parts.push(...(obs.filesModified ?? []));
  }

  return parts
    .filter(Boolean)
    .join('\n')
    .toLowerCase();
}

function isCommandTrace(obs: Observation): boolean {
  const title = obs.title ?? '';
  return COMMAND_TRACE_PATTERNS.some((pattern) => pattern.test(title));
}

function isNoiseObservation(obs: Observation): boolean {
  const text = stringifyObservation(obs, false);
  return NOISE_PATTERNS.some((pattern) => pattern.test(text)) || isCommandTrace(obs);
}

function isSystemSelfObservation(obs: Observation): boolean {
  const text = stringifyObservation(obs, false);
  return SYSTEM_SELF_PATTERNS.some((pattern) => pattern.test(text));
}

export function scoreObservationForSessionContext(obs: Observation, projectTokens: string[], now = Date.now()): number {
  let score = TYPE_WEIGHTS[obs.type] ?? 1;
  const text = stringifyObservation(obs);
  const ageDays = Math.max(0, (now - new Date(obs.createdAt).getTime()) / (1000 * 60 * 60 * 24));

  // Recency still matters, but should not dominate everything.
  score += Math.max(0.2, 2.5 - Math.min(ageDays, 45) * 0.05);

  // Prefer observations that mention the current project name or touch its paths.
  if (projectTokens.length > 0) {
    const matchingTokens = projectTokens.filter((token) => text.includes(token));
    if (matchingTokens.length > 0) {
      score += 2 + matchingTokens.length * 0.6;
    } else if ((obs.filesModified?.length ?? 0) > 0) {
      score -= 1.25;
    }
  }

  // Avoid injecting obviously stale or completed memories back into new sessions.
  if (obs.status === 'resolved' || obs.status === 'archived') {
    score -= 100;
  }

  // Downrank demos, tests, migrations, and handoff records.
  if (isNoiseObservation(obs)) {
    score -= 8;
  }

  // Heavy penalty for observations about Memorix itself (system self-reference).
  // These should almost never surface in unrelated project sessions.
  if (isSystemSelfObservation(obs)) {
    score -= 15;
  }

  // Source-aware adjustments (neutral when sourceDetail/valueCategory absent — backward-compatible)
  if (obs.sourceDetail === 'hook') {
    // Hook auto-captures are L1 routing signals, not L2 working context
    score -= 3;
    if (obs.valueCategory === 'ephemeral') {
      // Hook + ephemeral = high-noise auto-capture with no lasting value
      score -= 5;
    }
  }
  if (obs.valueCategory === 'core') {
    // Formation-classified core memory: high-value, prefer in working context
    score += 2;
  }

  return score;
}

/**
 * Start a new coding session.
 *
 * Creates a session record and returns context from previous sessions
 * so the agent can resume work without re-explaining everything.
 */
export async function startSession(
  projectDir: string,
  projectId: string,
  opts?: { sessionId?: string; agent?: string },
): Promise<{ session: Session; previousContext: string }> {
  const sessionId = opts?.sessionId || generateSessionId();
  const now = new Date().toISOString();

  const session: Session = {
    id: sessionId,
    projectId,
    startedAt: now,
    status: 'active',
    agent: opts?.agent,
  };

  // Load previous context before creating new session
  const previousContext = await getSessionContext(projectDir, projectId);

  // Atomic rollover: complete all active sessions for this project's aliases
  // and insert the new session in a single SQLite transaction.
  // Prevents concurrent startSession() from leaving multiple active sessions.
  const sessionStore = getSessionStore();
  const aliasSet = await resolveProjectIds(projectId);
  await sessionStore.atomicRolloverInsert(session, [...aliasSet], now);

  return { session, previousContext };
}

/**
 * End a coding session with an optional structured summary.
 *
 * Summary format (following Engram's convention):
 * ## Goal
 * ## Discoveries
 * ## Accomplished
 * ## Relevant Files
 */
export async function endSession(
  projectDir: string,
  sessionId: string,
  summary?: string,
): Promise<Session | null> {
  const sessionStore = getSessionStore();
  const sessions = await sessionStore.loadAll();
  const session = sessions.find((entry) => entry.id === sessionId);

  if (!session) return null;

  session.status = 'completed';
  session.endedAt = new Date().toISOString();
  if (summary) {
    session.summary = sanitizeCredentials(summary);
  }

  await sessionStore.update(session);
  return session;
}

/**
 * Get formatted context from previous sessions for injection into a new session.
 *
 * Returns a layered context packet:
 *   L1 Routing     — recent hook signals + search guidance
 *   Recent Handoff — last session summary (L2)
 *   Key Memories   — durable explicit working context (L2)
 *   Session History— orientation log
 *   L3 Evidence    — pointers to git-memory and hook traces (on-demand)
 */
export async function getSessionContext(
  projectDir: string,
  projectId: string,
  limit: number = 3,
): Promise<string> {
  const sessions = await getSessionStore().loadAll();
  const allObs = await getObservationStore().loadAll();

  const aliasSet = await resolveProjectIds(projectId);
  /** Check if a session summary contains noise/system-self content */
  const isNoisySummary = (summary: string | undefined): boolean => {
    if (!summary) return false;
    return NOISE_PATTERNS.some((p) => p.test(summary)) || SYSTEM_SELF_PATTERNS.some((p) => p.test(summary));
  };

  const projectSessions = sessions
    .filter((session) => aliasSet.has(session.projectId) && session.status === 'completed')
    .filter((session) => !isNoisySummary(session.summary))
    .sort((a, b) => new Date(b.endedAt || b.startedAt).getTime() - new Date(a.endedAt || a.startedAt).getTime())
    .slice(0, limit);

  if (projectSessions.length === 0 && allObs.length === 0) {
    return '';
  }

  const lines: string[] = [];
  const projectTokens = tokenizeProjectId(projectId);

  // ── Partition project observations by disclosure layer ─────────────
  const projectObs = allObs
    .filter((obs) => aliasSet.has(obs.projectId) && (obs.status ?? 'active') === 'active')
    .filter((obs) => !isNoiseObservation(obs) && !isSystemSelfObservation(obs));

  // L2: durable working context (explicit/undefined/core), priority types only
  const l2Scored = projectObs
    .filter((obs) => PRIORITY_TYPES.has(obs.type) && classifyLayer(obs) === 'L2')
    .map((obs) => ({ obs, score: scoreObservationForSessionContext(obs, projectTokens) }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return new Date(b.obs.createdAt).getTime() - new Date(a.obs.createdAt).getTime();
    });

  // Per-entity cap: only when multiple distinct entities are present.
  // Prevents one workstream from monopolizing session context.
  // When all candidates belong to a single entity, skip the cap — no pollution risk.
  const distinctL2Entities = new Set(l2Scored.map(({ obs }) => obs.entityName).filter(Boolean)).size;
  const l2Obs = (distinctL2Entities > 1
    ? (() => {
        const entityCount = new Map<string, number>();
        const ENTITY_CAP = 3;
        return l2Scored.filter(({ obs }) => {
          const key = obs.entityName ?? '';
          const count = entityCount.get(key) ?? 0;
          if (count >= ENTITY_CAP) return false;
          entityCount.set(key, count + 1);
          return true;
        });
      })()
    : l2Scored
  ).slice(0, 5).map(({ obs }) => obs);

  // L1: recent hook activity signals (titles only, most recent first)
  const l1HookObs = projectObs
    .filter((obs) => classifyLayer(obs) === 'L1')
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 3);

  // L3: git-ingest evidence count (pointer only, not injected)
  const l3GitCount = projectObs.filter((obs) => classifyLayer(obs) === 'L3').length;
  const totalHookCount = projectObs.filter((obs) => classifyLayer(obs) === 'L1').length;

  // Active entities: unique entity names from top-scored L2 memories.
  // Surfaced in L1 Routing as next-hop search guidance — not working context.
  // Capped at 5, derived from the same l2Obs already scored above.
  const activeEntities = [
    ...new Set(l2Obs.map((o) => o.entityName).filter((n): n is string => !!n && n.trim().length > 0)),
  ].slice(0, 5);

  // ── L1 Routing ─────────────────────────────────────────────────────
  // L1 Routing requires actual L1/L3 signals (hooks or git evidence).
  // Active entities enrich the section when it is shown but do not open it alone.
  const hasL1Content = l1HookObs.length > 0 || l3GitCount > 0;
  if (hasL1Content) {
    // Graph neighbor routing hint: 1-hop neighbors of activeEntities from the
    // knowledge graph. Routing only — no query expansion, no rerank, no 2-hop
    // traversal. Silently skipped if graph is absent, empty, or throws.
    let graphNeighbors: string[] = [];
    if (activeEntities.length > 0) {
      try {
        const graphMgr = new KnowledgeGraphManager(projectDir);
        await graphMgr.init();
        const { relations } = await graphMgr.readGraph();
        const activeSet = new Set(activeEntities.map((n) => n.toLowerCase()));
        const neighborSet = new Set<string>();
        for (const rel of relations) {
          const fromLower = rel.from.toLowerCase();
          const toLower = rel.to.toLowerCase();
          if (activeSet.has(fromLower) && !activeSet.has(toLower)) neighborSet.add(rel.to);
          if (activeSet.has(toLower) && !activeSet.has(fromLower)) neighborSet.add(rel.from);
        }
        graphNeighbors = [...neighborSet].slice(0, 5);
      } catch {
        // Graph unavailable or empty — silently skip
      }
    }

    lines.push('## L1 Routing');
    lines.push('*Recent activity signals and search guidance for this session.*');

    if (l1HookObs.length > 0) {
      for (const obs of l1HookObs) {
        lines.push(`🔗 ${redactCredentials(obs.title)}`);
      }
      lines.push('');
    }

    const hints: string[] = [];
    if (activeEntities.length > 0) {
      hints.push(`Active entities: ${activeEntities.join(', ')}`);
    }
    if (graphNeighbors.length > 0) {
      hints.push(`Graph neighbors: ${graphNeighbors.join(', ')}`);
    }
    if (l3GitCount > 0) {
      hints.push(`${l3GitCount} git-memory item(s) available — search \`what-changed\` or by entity/commit`);
    }
    if (totalHookCount > 0) {
      hints.push(`${totalHookCount} hook trace(s) available — use \`memorix_timeline\` for activity expansion`);
    }
    for (const hint of hints) {
      lines.push(`💡 ${hint}`);
    }
    lines.push('');
  }

  // ── L2 Recent Handoff ──────────────────────────────────────────────
  if (projectSessions.length > 0) {
    // Walk back to find the most recent session with a real summary.
    let handoff = projectSessions[0];
    for (const s of projectSessions) {
      if (s.summary && s.summary !== '(session ended implicitly by new session start)') {
        handoff = s;
        break;
      }
    }
    lines.push('## Recent Handoff');
    lines.push('*Last session with a recorded summary — pick up where it left off.*');
    if (handoff.agent) {
      lines.push(`Agent: ${handoff.agent}`);
    }
    lines.push(`Ended: ${handoff.endedAt || handoff.startedAt}`);
    if (handoff.summary && handoff.summary !== '(session ended implicitly by new session start)') {
      lines.push('', redactCredentials(handoff.summary));
    }
    lines.push('');
  }

  // ── L2 Key Project Memories ────────────────────────────────────────
  if (l2Obs.length > 0) {
    lines.push('## Key Project Memories');
    lines.push('*Durable working context — explicit decisions, gotchas, and discoveries.*');
    for (const obs of l2Obs) {
      const emoji = TYPE_EMOJI[obs.type] ?? '📌';
      const fact = obs.facts?.[0] ? ` — ${redactCredentials(obs.facts[0])}` : '';
      lines.push(`${emoji} ${redactCredentials(obs.title)}${fact}`);
    }
    lines.push('');
  }

  // ── Session History ────────────────────────────────────────────────
  if (projectSessions.length > 1) {
    lines.push(`## Recent Session History (last ${projectSessions.length})`);
    lines.push('*Chronological session log — for orientation, not action.*');
    for (const session of projectSessions) {
      const date = (session.endedAt || session.startedAt).slice(0, 10);
      const agent = session.agent ? ` [${session.agent}]` : '';
      const rawSummary = session.summary && session.summary !== '(session ended implicitly by new session start)'
        ? session.summary : null;
      const summary = rawSummary
        ? ` — ${redactCredentials(rawSummary.split('\n')[0].replace(/^#+\s*/, '')).slice(0, 80)}`
        : '';
      lines.push(`- ${date}${agent}${summary}`);
    }
    lines.push('');
  }

  // ── L3 Evidence Hints ─────────────────────────────────────────────
  const l3Lines: string[] = [];
  if (l3GitCount > 0) {
    l3Lines.push(`📌 ${l3GitCount} git-memory item(s) — use \`memorix_search\` to retrieve repository evidence`);
  }
  if (totalHookCount > 0) {
    l3Lines.push(`🔗 ${totalHookCount} hook trace(s) — use \`memorix_timeline\` for full activity expansion`);
  }
  if (l3Lines.length > 0) {
    lines.push('## L3 Evidence');
    lines.push('*Deeper context available on demand — kept out of working context to stay compact.*');
    for (const l of l3Lines) {
      lines.push(l);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * List all sessions for a project.
 */
export async function listSessions(
  projectDir: string,
  projectId?: string,
): Promise<Session[]> {
  const sessionStore = getSessionStore();
  if (projectId) {
    const aliasSet = await resolveProjectIds(projectId);
    const all = await sessionStore.loadAll();
    return all.filter((session) => aliasSet.has(session.projectId));
  }
  return sessionStore.loadAll();
}

/**
 * Get the currently active session for a project (if any).
 */
export async function getActiveSession(
  projectDir: string,
  projectId: string,
): Promise<Session | null> {
  const sessionStore = getSessionStore();
  const sessions = await sessionStore.loadAll();
  const aliasSet = await resolveProjectIds(projectId);
  return sessions.find((session) => aliasSet.has(session.projectId) && session.status === 'active') || null;
}
