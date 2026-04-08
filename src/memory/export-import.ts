/**
 * Export/Import Engine
 *
 * Enables team collaboration by exporting and importing Memorix data.
 *
 * Export formats:
 * - JSON: Full fidelity, machine-readable
 * - Markdown: Human-readable, great for sharing in PRs/docs
 *
 * Import: JSON format only (full fidelity restore)
 */

import type { Observation } from '../types.js';
import type { Session } from '../types.js';
import { getObservationStore } from '../store/obs-store.js';
import { getSessionStore } from '../store/session-store.js';

/** Export package structure */
export interface MemorixExport {
  version: string;
  exportedAt: string;
  projectId: string;
  observations: Observation[];
  sessions: Session[];
  stats: {
    observationCount: number;
    sessionCount: number;
    typeBreakdown: Record<string, number>;
  };
}

const OBSERVATION_ICONS: Record<string, string> = {
  'session-request': '🎯', 'gotcha': '🔴', 'problem-solution': '🟡',
  'how-it-works': '🔵', 'what-changed': '🟢', 'discovery': '🟣',
  'why-it-exists': '🟠', 'decision': '🟤', 'trade-off': '⚖️',
};

/**
 * Export project data as JSON.
 */
export async function exportAsJson(
  projectDir: string,
  projectId: string,
): Promise<MemorixExport> {
  const store = getObservationStore();
  const allObs = await store.loadAll();
  const allSessions = await getSessionStore().loadAll();

  const projectObs = allObs.filter(o => o.projectId === projectId);
  const projectSessions = allSessions.filter(s => s.projectId === projectId);

  // Type breakdown
  const typeBreakdown: Record<string, number> = {};
  for (const obs of projectObs) {
    typeBreakdown[obs.type] = (typeBreakdown[obs.type] ?? 0) + 1;
  }

  return {
    version: '0.9.0',
    exportedAt: new Date().toISOString(),
    projectId,
    observations: projectObs,
    sessions: projectSessions,
    stats: {
      observationCount: projectObs.length,
      sessionCount: projectSessions.length,
      typeBreakdown,
    },
  };
}

/**
 * Export project data as human-readable Markdown.
 */
export async function exportAsMarkdown(
  projectDir: string,
  projectId: string,
): Promise<string> {
  const data = await exportAsJson(projectDir, projectId);
  const lines: string[] = [];

  lines.push(`# Memorix Export: ${projectId}`);
  lines.push(`Exported: ${data.exportedAt}`);
  lines.push(`Observations: ${data.stats.observationCount} | Sessions: ${data.stats.sessionCount}`);
  lines.push('');

  // Type breakdown
  if (Object.keys(data.stats.typeBreakdown).length > 0) {
    lines.push('## Type Distribution');
    for (const [type, count] of Object.entries(data.stats.typeBreakdown).sort((a, b) => b[1] - a[1])) {
      const icon = OBSERVATION_ICONS[type] ?? '❓';
      lines.push(`- ${icon} ${type}: ${count}`);
    }
    lines.push('');
  }

  // Sessions
  if (data.sessions.length > 0) {
    lines.push('## Sessions');
    for (const s of data.sessions) {
      const status = s.status === 'active' ? '🟢' : '✅';
      const agent = s.agent ? ` [${s.agent}]` : '';
      lines.push(`### ${status} ${s.id}${agent}`);
      lines.push(`Started: ${s.startedAt}${s.endedAt ? ` | Ended: ${s.endedAt}` : ''}`);
      if (s.summary) {
        lines.push('');
        lines.push(s.summary);
      }
      lines.push('');
    }
  }

  // Observations grouped by entity
  const byEntity = new Map<string, Observation[]>();
  for (const obs of data.observations) {
    if (!byEntity.has(obs.entityName)) byEntity.set(obs.entityName, []);
    byEntity.get(obs.entityName)!.push(obs);
  }

  lines.push('## Observations');
  for (const [entity, observations] of byEntity) {
    lines.push(`### ${entity}`);
    for (const obs of observations) {
      const icon = OBSERVATION_ICONS[obs.type] ?? '❓';
      lines.push(`#### ${icon} #${obs.id} ${obs.title}`);
      lines.push(`Type: ${obs.type} | Created: ${obs.createdAt}${obs.topicKey ? ` | Topic: ${obs.topicKey}` : ''}${obs.revisionCount && obs.revisionCount > 1 ? ` | Rev: ${obs.revisionCount}` : ''}`);
      lines.push('');
      lines.push(obs.narrative);
      if (obs.facts.length > 0) {
        lines.push('');
        lines.push('**Facts:**');
        for (const f of obs.facts) lines.push(`- ${f}`);
      }
      if (obs.filesModified.length > 0) {
        lines.push('');
        lines.push(`**Files:** ${obs.filesModified.join(', ')}`);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

/**
 * Import observations and sessions from a JSON export.
 * Re-assigns IDs to avoid conflicts with existing data.
 */
export async function importFromJson(
  projectDir: string,
  data: MemorixExport,
): Promise<{ observationsImported: number; sessionsImported: number; skipped: number }> {
  let imported = 0;
  let sessionsImported = 0;
  let skipped = 0;

  const store = getObservationStore();
  await store.atomic(async (tx) => {
    const existingObs = await tx.loadAll();
    const sessionStore = getSessionStore();
    const existingSessions = await sessionStore.loadAll();
    let nextId = await tx.loadIdCounter();

    // Build set of existing topicKey+projectId for dedup
    const existingTopicKeys = new Set(
      existingObs
        .filter(o => o.topicKey)
        .map(o => `${o.projectId}::${o.topicKey}`),
    );

    // Import observations
    for (const obs of data.observations) {
      // Skip if topicKey already exists (dedup)
      if (obs.topicKey && existingTopicKeys.has(`${obs.projectId}::${obs.topicKey}`)) {
        skipped++;
        continue;
      }

      const newObs = { ...obs, id: nextId++ };
      existingObs.push(newObs);
      imported++;
    }

    // Import sessions (skip duplicates by ID)
    const existingSessionIds = new Set(existingSessions.map(s => s.id));
    for (const session of data.sessions) {
      if (!existingSessionIds.has(session.id)) {
        existingSessions.push(session);
        sessionsImported++;
      }
    }

    await tx.saveAll(existingObs);
    await tx.saveIdCounter(nextId);
    // Persist imported sessions via store
    for (const session of data.sessions) {
      if (!existingSessionIds.has(session.id)) {
        await sessionStore.insert(session);
      }
    }
  });

  return { observationsImported: imported, sessionsImported, skipped };
}
