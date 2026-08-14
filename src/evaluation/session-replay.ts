/**
 * Session-replay evaluation — deterministic scoring for the retrieval path.
 *
 * Purpose: before changing how Memorix retrieves memory, measure the current
 * behavior with a fixed exam so every later change can be judged by the same
 * three scores:
 *
 *   - hit rate      — the right memory showed up for each question
 *   - duplicate rate — how much of a session's delivery re-shows the same
 *                      memory (lower is better; the dedup change targets it)
 *   - token ceiling  — no turn exceeds its budget
 *
 * Scoring is mechanical: ids in, ids out. No model, no network, no keys.
 */

export interface SessionReplayQuestion {
  id: string;
  query: string;
  /** The observation ids that MUST appear in this turn's results. */
  expectedObsIds: number[];
}

export interface SessionReplayTurn {
  questionId: string;
  shownObsIds: number[];
  tokens: number;
}

export interface SessionReplayScores {
  questions: number;
  hits: number;
  /** hitRate ∈ [0, 1] — share of questions whose expected ids all appeared. */
  hitRate: number;
  /** How many times an observation was re-shown after its first appearance. */
  duplicateShows: number;
  /** duplicateRate ∈ [0, 1] — duplicate shows / total shows (0 = perfect). */
  duplicateRate: number;
  totalShows: number;
  /** Highest token count across turns. */
  maxTurnTokens: number;
  overBudgetTurns: number;
  turns: SessionReplayTurn[];
}

export function scoreSessionReplay(
  questions: SessionReplayQuestion[],
  turns: SessionReplayTurn[],
  tokenCeiling: number,
): SessionReplayScores {
  const turnById = new Map(turns.map((turn) => [turn.questionId, turn]));

  let hits = 0;
  let duplicateShows = 0;
  let totalShows = 0;
  let maxTurnTokens = 0;
  let overBudgetTurns = 0;
  const seen = new Set<number>();

  for (const question of questions) {
    const turn = turnById.get(question.id);
    if (!turn) continue;
    maxTurnTokens = Math.max(maxTurnTokens, turn.tokens);
    if (turn.tokens > tokenCeiling) overBudgetTurns += 1;

    const expectedFound = question.expectedObsIds.every((id) => turn.shownObsIds.includes(id));
    if (expectedFound) hits += 1;

    for (const id of turn.shownObsIds) {
      totalShows += 1;
      if (seen.has(id)) duplicateShows += 1;
      seen.add(id);
    }
  }

  return {
    questions: questions.length,
    hits,
    hitRate: questions.length === 0 ? 1 : hits / questions.length,
    duplicateShows,
    duplicateRate: totalShows === 0 ? 0 : duplicateShows / totalShows,
    totalShows,
    maxTurnTokens,
    overBudgetTurns,
    turns,
  };
}

export function formatSessionReplayScoreboard(scores: SessionReplayScores, label: string): string {
  const lines = [
    `Session replay scoreboard — ${label}`,
    `  questions:        ${scores.questions}`,
    `  hit rate:         ${scores.hits}/${scores.questions} (${(scores.hitRate * 100).toFixed(0)}%)`,
    `  duplicate shows:  ${scores.duplicateShows} of ${scores.totalShows} shows (${(scores.duplicateRate * 100).toFixed(0)}%)`,
    `  max turn tokens:  ${scores.maxTurnTokens}`,
    `  over-budget:      ${scores.overBudgetTurns} turn(s)`,
  ];
  return lines.join('\n');
}
