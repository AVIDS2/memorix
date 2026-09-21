import { randomUUID } from 'node:crypto';
import { sanitizeCredentials } from '../memory/secret-filter.js';
import { getDatabase } from '../store/sqlite-db.js';

export const TASK_CONTINUITY_EVENT_KINDS = [
  'task',
  'requirement',
  'decision',
  'verification',
  'risk',
  'outcome',
] as const;

export type TaskContinuityEventKind = typeof TASK_CONTINUITY_EVENT_KINDS[number];
export type TaskContinuityVerificationStatus = 'pending' | 'passed' | 'failed' | 'skipped';
export type TaskContinuityOutcomeStatus = 'completed' | 'blocked' | 'abandoned';
export type TaskContinuityStatus = 'open' | TaskContinuityOutcomeStatus;

export interface TaskContinuityEvent {
  id: string;
  projectId: string;
  taskId: string;
  task: string;
  kind: TaskContinuityEventKind;
  content: string;
  status?: TaskContinuityVerificationStatus | TaskContinuityOutcomeStatus;
  sourceRef?: string;
  evidenceRefs: string[];
  actor?: string;
  at: string;
}

export interface TaskContinuityVerification {
  content: string;
  status: TaskContinuityVerificationStatus;
  sourceRef?: string;
  evidenceRefs: string[];
}

export interface TaskContinuityLedger {
  taskId: string;
  projectId: string;
  task: string;
  status: TaskContinuityStatus;
  requirements: string[];
  decisions: string[];
  verification: TaskContinuityVerification[];
  risks: string[];
  outcomes: string[];
  updatedAt: string;
  events: TaskContinuityEvent[];
}

const MAX_TEXT_LENGTH = 2_000;
const MAX_TASK_LENGTH = 1_000;
const MAX_LIST_ITEMS = 8;
const MAX_EVIDENCE_REFS = 8;
const MAX_EVENTS_PER_TASK = 200;

function clean(value: string, maxLength = MAX_TEXT_LENGTH): string {
  return sanitizeCredentials(value).replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function cleanList(values: string[] | undefined, maxLength = MAX_TEXT_LENGTH): string[] {
  return [...new Set((values ?? []).map(value => clean(value, maxLength)).filter(Boolean))].slice(0, MAX_LIST_ITEMS);
}

function parseRefs(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? cleanList(parsed.filter(item => typeof item === 'string'), 500).slice(0, MAX_EVIDENCE_REFS)
      : [];
  } catch {
    return [];
  }
}

function rowToEvent(row: any): TaskContinuityEvent {
  const status = row.item_status ? String(row.item_status) : undefined;
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    taskId: String(row.task_id),
    task: clean(String(row.task), MAX_TASK_LENGTH),
    kind: row.kind as TaskContinuityEventKind,
    content: clean(String(row.content)),
    ...(status ? { status: status as TaskContinuityEvent['status'] } : {}),
    ...(row.source_ref ? { sourceRef: clean(String(row.source_ref), 500) } : {}),
    evidenceRefs: parseRefs(row.evidence_json),
    ...(row.actor ? { actor: clean(String(row.actor), 200) } : {}),
    at: String(row.created_at),
  };
}

export class TaskContinuityStore {
  private db: any = null;

  async init(dataDir: string): Promise<void> {
    this.db = getDatabase(dataDir);
  }

  private requireDb(): any {
    if (!this.db) throw new Error('TaskContinuityStore is not initialized.');
    return this.db;
  }

  private insert(input: {
    projectId: string;
    taskId: string;
    task: string;
    kind: TaskContinuityEventKind;
    content: string;
    status?: string;
    sourceRef?: string;
    evidenceRefs?: string[];
    actor?: string;
    at?: string;
  }): TaskContinuityEvent {
    const existingCount = this.requireDb().prepare(
      'SELECT COUNT(*) AS count FROM task_continuity_events WHERE project_id = ? AND task_id = ?',
    ).get(input.projectId, input.taskId) as { count?: number };
    if (Number(existingCount?.count ?? 0) >= MAX_EVENTS_PER_TASK) {
      throw new Error('Task continuity ledger reached its 200-event limit.');
    }
    const event: TaskContinuityEvent = {
      id: randomUUID(),
      projectId: clean(input.projectId, 500),
      taskId: clean(input.taskId, 120),
      task: clean(input.task, MAX_TASK_LENGTH),
      kind: input.kind,
      content: clean(input.content),
      ...(input.status ? { status: input.status as TaskContinuityEvent['status'] } : {}),
      ...(input.sourceRef ? { sourceRef: clean(input.sourceRef, 500) } : {}),
      evidenceRefs: cleanList(input.evidenceRefs, 500).slice(0, MAX_EVIDENCE_REFS),
      ...(input.actor ? { actor: clean(input.actor, 200) } : {}),
      at: input.at ?? new Date().toISOString(),
    };
    this.requireDb().prepare(`
      INSERT INTO task_continuity_events (
        id, project_id, task_id, task, kind, content, item_status,
        source_ref, evidence_json, actor, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.id,
      event.projectId,
      event.taskId,
      event.task,
      event.kind,
      event.content,
      event.status ?? null,
      event.sourceRef ?? null,
      JSON.stringify(event.evidenceRefs),
      event.actor ?? null,
      event.at,
    );
    return event;
  }

  start(input: {
    projectId: string;
    task: string;
    taskId?: string;
    requirements?: string[];
    actor?: string;
  }): { taskId: string; ledger: TaskContinuityLedger } {
    const task = clean(input.task, MAX_TASK_LENGTH);
    if (!task) throw new Error('A non-empty task is required.');
    const taskId = clean(input.taskId ?? '', 120) || randomUUID();
    const requirements = cleanList(input.requirements);
    const transaction = this.requireDb().transaction(() => {
      this.insert({
        projectId: input.projectId,
        taskId,
        task,
        kind: 'task',
        content: task,
        status: 'open',
        actor: input.actor,
      });
      for (const requirement of requirements) {
        this.insert({
          projectId: input.projectId,
          taskId,
          task,
          kind: 'requirement',
          content: requirement,
          actor: input.actor,
        });
      }
    });
    transaction();
    return { taskId, ledger: this.get(input.projectId, taskId)! };
  }

  record(input: {
    projectId: string;
    taskId: string;
    kind: Exclude<TaskContinuityEventKind, 'task' | 'outcome'>;
    content: string;
    verificationStatus?: TaskContinuityVerificationStatus;
    sourceRef?: string;
    evidenceRefs?: string[];
    actor?: string;
    at?: string;
  }): { event: TaskContinuityEvent; ledger: TaskContinuityLedger } {
    const projectId = clean(input.projectId, 500);
    const taskId = clean(input.taskId, 120);
    const existing = this.get(projectId, taskId);
    if (!existing) throw new Error('Task continuity ledger not found: ' + taskId);
    const event = this.insert({
      projectId,
      taskId,
      task: existing.task,
      kind: input.kind,
      content: input.content,
      ...(input.kind === 'verification' && input.verificationStatus
        ? { status: input.verificationStatus }
        : {}),
      sourceRef: input.sourceRef,
      evidenceRefs: input.evidenceRefs,
      actor: input.actor,
      at: input.at,
    });
    return { event, ledger: this.get(projectId, taskId)! };
  }

  close(input: {
    projectId: string;
    taskId: string;
    status: TaskContinuityOutcomeStatus;
    content: string;
    sourceRef?: string;
    evidenceRefs?: string[];
    actor?: string;
    at?: string;
  }): { event: TaskContinuityEvent; ledger: TaskContinuityLedger } {
    const projectId = clean(input.projectId, 500);
    const taskId = clean(input.taskId, 120);
    const existing = this.get(projectId, taskId);
    if (!existing) throw new Error('Task continuity ledger not found: ' + taskId);
    const event = this.insert({
      projectId,
      taskId,
      task: existing.task,
      kind: 'outcome',
      content: input.content,
      status: input.status,
      sourceRef: input.sourceRef,
      evidenceRefs: input.evidenceRefs,
      actor: input.actor,
      at: input.at,
    });
    return { event, ledger: this.get(projectId, taskId)! };
  }

  get(projectId: string, taskId: string): TaskContinuityLedger | undefined {
    const normalizedProjectId = clean(projectId, 500);
    const normalizedTaskId = clean(taskId, 120);
    const rows = this.requireDb().prepare(`
      SELECT * FROM task_continuity_events
      WHERE project_id = ? AND task_id = ?
      ORDER BY created_at ASC, rowid ASC
    `).all(normalizedProjectId, normalizedTaskId);
    if (rows.length === 0) return undefined;
    return aggregate(rows.map(rowToEvent));
  }

  list(projectId: string, limit = 20): TaskContinuityLedger[] {
    const rows = this.requireDb().prepare(`
      SELECT task_id
      FROM task_continuity_events
      WHERE project_id = ?
      GROUP BY task_id
      ORDER BY MAX(created_at) DESC
      LIMIT ?
    `).all(projectId, Math.min(100, Math.max(1, Math.floor(limit))));
    return rows
      .map((row: any) => this.get(projectId, String(row.task_id)))
      .filter((ledger: TaskContinuityLedger | undefined): ledger is TaskContinuityLedger => Boolean(ledger));
  }
}

function aggregate(events: TaskContinuityEvent[]): TaskContinuityLedger {
  const first = events.find(event => event.kind === 'task') ?? events[0];
  const latestOutcome = [...events].reverse().find(event => event.kind === 'outcome');
  return {
    taskId: first.taskId,
    projectId: first.projectId,
    task: first.task,
    status: (latestOutcome?.status as TaskContinuityStatus | undefined) ?? 'open',
    requirements: events.filter(event => event.kind === 'requirement').map(event => event.content),
    decisions: events.filter(event => event.kind === 'decision').map(event => event.content),
    verification: events
      .filter(event => event.kind === 'verification')
      .map(event => ({
        content: event.content,
        status: (event.status as TaskContinuityVerificationStatus | undefined) ?? 'pending',
        ...(event.sourceRef ? { sourceRef: event.sourceRef } : {}),
        evidenceRefs: event.evidenceRefs,
      })),
    risks: events.filter(event => event.kind === 'risk').map(event => event.content),
    outcomes: events.filter(event => event.kind === 'outcome').map(event => event.content),
    updatedAt: events[events.length - 1].at,
    events,
  };
}
