/**
 * Team Poll — Situational awareness for agents.
 *
 * Phase 4b: Provides `computeWatermark` (extracted from server.ts session_start)
 * and `computePoll` (full situational awareness in one call).
 *
 * Architectural boundary (B3): These are cross-process consistency mechanisms.
 * They read from SQLite (canonical truth), never from EventBus.
 */

import type { TeamStore, TeamAgentRow, TeamTaskRow, TeamMessageRow } from './team-store.js';

// ── Types ──────────────────────────────────────────────────────────

export interface WatermarkResult {
  lastSeenGeneration: number;
  currentGeneration: number;
  newObservationCount: number;
}

export interface PollResult {
  agent: {
    agentId: string;
    status: string;
    lastHeartbeat: number;
  } | null;
  watermark: WatermarkResult;
  inbox: {
    unreadCount: number;
    messages: TeamMessageRow[];
  };
  tasks: {
    myInProgress: TeamTaskRow[];
    availableToClaim: TeamTaskRow[];
    recentlyCompleted: TeamTaskRow[];
    recentlyFailed: TeamTaskRow[];
  };
  team: {
    activeAgents: TeamAgentRow[];
    totalAgents: number;
  };
}

// ── computeWatermark ───────────────────────────────────────────────

/**
 * Compute the watermark for an agent: how many new observations
 * have appeared in this project since the agent's last session.
 *
 * Extracted from server.ts session_start to be shared by poll and session_start.
 *
 * @param lastSeenGeneration - Agent's last_seen_obs_generation from TeamStore
 * @param currentGeneration  - Current global generation from observation store
 * @param projectObservations - Pre-filtered observations for this project
 *                              with writeGeneration > lastSeenGeneration
 */
export function computeWatermark(
  lastSeenGeneration: number,
  currentGeneration: number,
  newObservationCount: number,
): WatermarkResult {
  return {
    lastSeenGeneration,
    currentGeneration,
    newObservationCount,
  };
}

// ── computePoll ────────────────────────────────────────────────────

/**
 * Compute full situational awareness for an agent in one call.
 * Reads only from SQLite (TeamStore) — never from EventBus.
 *
 * @param teamStore - The TeamStore instance
 * @param projectId - Current project ID
 * @param agentId   - The requesting agent's ID (null if no agent registered)
 * @param watermark - Pre-computed watermark result
 */
export function computePoll(
  teamStore: TeamStore,
  projectId: string,
  agentId: string | null,
  watermark: WatermarkResult,
): PollResult {
  // Agent info
  let agent: PollResult['agent'] = null;
  if (agentId) {
    const row = teamStore.getAgent(agentId);
    if (row) {
      agent = {
        agentId: row.agent_id,
        status: row.status,
        lastHeartbeat: row.last_heartbeat,
      };
    }
  }

  // Inbox
  const unreadCount = agentId ? teamStore.getUnreadCount(projectId, agentId) : 0;
  const messages = agentId ? teamStore.getInbox(projectId, agentId) : [];

  // Tasks
  const allTasks = teamStore.listTasks(projectId);
  const myInProgress = agentId
    ? allTasks.filter(t => t.assignee_agent_id === agentId && t.status === 'in_progress')
    : [];

  // Available to claim: pending, no assignee, all deps met
  const pendingTasks = allTasks.filter(t => t.status === 'pending' && !t.assignee_agent_id);
  const availableToClaim = pendingTasks.filter(t => {
    const unmet = teamStore.getTaskDeps(t.task_id)
      .map(depId => teamStore.getTask(depId))
      .filter(dep => dep && dep.status !== 'completed');
    return unmet.length === 0;
  });

  const recentlyCompleted = allTasks.filter(t => t.status === 'completed');
  const recentlyFailed = allTasks.filter(t => t.status === 'failed');

  // Team
  const allAgents = teamStore.listAgents(projectId);
  const activeAgents = allAgents.filter(a => a.status === 'active');

  return {
    agent,
    watermark,
    inbox: { unreadCount, messages },
    tasks: { myInProgress, availableToClaim, recentlyCompleted, recentlyFailed },
    team: { activeAgents, totalAgents: allAgents.length },
  };
}
