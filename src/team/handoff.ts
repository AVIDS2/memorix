/**
 * Team Handoff — Structured context transfer between agents.
 *
 * Phase 4b: Creates a handoff artifact as a standard observation
 * (canonical path — no new JSON/file persistence).
 *
 * Architectural boundary (B4): The canonical record is an Observation
 * stored via storeObservation(). TeamStore only holds a reference pointer.
 * Handoff artifacts use valueCategory: 'core' so they are immune to
 * retention archival (Phase 1 provenance: core = immune).
 */

import type { TeamStore } from './team-store.js';
import type { ObservationType } from '../types.js';

// ── Types ──────────────────────────────────────────────────────────

export interface HandoffInput {
  projectId: string;
  fromAgentId: string;
  toAgentId?: string;       // null = anyone can pick up
  taskId?: string;           // link to specific task
  summary: string;           // human-readable summary of what was done
  context: string;           // machine-readable context for the next agent
  filesModified?: string[];  // files touched during the work
  concepts?: string[];       // key concepts for search discoverability
}

export interface HandoffResult {
  observationId: number;
  taskId?: string;
  fromAgentId: string;
  toAgentId?: string;
  summary: string;
}

// ── createHandoffArtifact ──────────────────────────────────────────

/**
 * Create a structured handoff artifact stored as an observation.
 *
 * @param input - Handoff details
 * @param storeObservation - The canonical storeObservation function (injected to avoid circular deps)
 * @param teamStore - For sending notification message to recipient
 */
export async function createHandoffArtifact(
  input: HandoffInput,
  storeObservation: (params: {
    entityName: string;
    type: ObservationType;
    title: string;
    narrative: string;
    facts?: string[];
    filesModified?: string[];
    concepts?: string[];
    projectId: string;
    topicKey?: string;
    sourceDetail?: 'explicit' | 'hook' | 'git-ingest';
    valueCategory?: 'core' | 'contextual' | 'ephemeral';
    createdByAgentId?: string;
  }) => Promise<{ observation: { id: number }; upserted: boolean }>,
  teamStore: TeamStore,
): Promise<HandoffResult> {
  // Build facts from handoff context
  const facts: string[] = [
    `Handoff from agent ${input.fromAgentId}`,
  ];
  if (input.toAgentId) facts.push(`Intended recipient: ${input.toAgentId}`);
  if (input.taskId) facts.push(`Related task: ${input.taskId}`);
  facts.push(`Context: ${input.context}`);

  // Store as observation — this IS the canonical record
  const { observation } = await storeObservation({
    entityName: 'team-handoff',
    type: 'what-changed',
    title: `[Handoff] ${input.summary}`,
    narrative: input.context,
    facts,
    filesModified: input.filesModified,
    concepts: ['handoff', ...(input.concepts ?? [])],
    projectId: input.projectId,
    topicKey: input.taskId ? `handoff:${input.taskId}:${input.fromAgentId}` : undefined,
    sourceDetail: 'explicit',
    valueCategory: 'core',  // immune to retention archival
    createdByAgentId: input.fromAgentId,
  });

  // Emit handoff:created event (best-effort, process-local only).
  // Happens AFTER canonical write succeeds — listener errors never affect the handoff.
  try {
    teamStore.getEventBus()?.emit('handoff:created', {
      observationId: observation.id,
      projectId: input.projectId,
      fromAgent: input.fromAgentId,
      toAgent: input.toAgentId,
      taskId: input.taskId,
    });
  } catch {
    // Best-effort: event emission failure never affects canonical handoff
  }

  // Send notification message to recipient.
  // Broadcast handoff uses fanout-on-write (方案 A): instead of one NULL-recipient
  // shared message, each active agent (excluding sender) gets their own copy.
  // This prevents Agent A's markRead from consuming Agent B's unread state.
  try {
    if (input.toAgentId) {
      // Targeted handoff — single recipient-specific message
      teamStore.sendMessage({
        projectId: input.projectId,
        senderAgentId: input.fromAgentId,
        recipientAgentId: input.toAgentId,
        type: 'handoff',
        content: `Handoff: ${input.summary}`,
        payload: {
          observationId: observation.id,
          taskId: input.taskId,
          filesModified: input.filesModified,
        },
        taskId: input.taskId,
      });
    } else {
      // Broadcast handoff — fanout to each active agent (excluding sender)
      const agents = teamStore.listAgents(input.projectId, { status: 'active' });
      for (const agent of agents) {
        if (agent.agent_id === input.fromAgentId) continue;
        teamStore.sendMessage({
          projectId: input.projectId,
          senderAgentId: input.fromAgentId,
          recipientAgentId: agent.agent_id,
          type: 'handoff',
          content: `Handoff: ${input.summary}`,
          payload: {
            observationId: observation.id,
            taskId: input.taskId,
            filesModified: input.filesModified,
          },
          taskId: input.taskId,
        });
      }
    }
  } catch {
    // Message sending is best-effort — handoff observation is the canonical record
  }

  return {
    observationId: observation.id,
    taskId: input.taskId,
    fromAgentId: input.fromAgentId,
    toAgentId: input.toAgentId,
    summary: input.summary,
  };
}
