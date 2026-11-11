/**
 * ChatTranscriptStore — persistence for TUI chat history.
 *
 * Backed by the shared SQLite database (chat_transcript table).
 * Supports multiple threads (thread_id), so /new creates a new thread
 * and /resume reloads the most recent one.
 */

import { getDatabase } from './sqlite-db.js';
import type { ChatTranscriptMessage } from '../cli/tui/ChatView.js';

export interface ChatThreadInfo {
  threadId: string;
  messageCount: number;
  lastActivity: string;
}

function safeJsonParse(text: string, fallback: any): any {
  try { return JSON.parse(text); } catch { return fallback; }
}

export class ChatTranscriptStore {
  private db: any = null;

  async init(dataDir: string): Promise<void> {
    this.db = getDatabase(dataDir);
  }

  /** Append a message to a thread */
  append(projectId: string, threadId: string, message: ChatTranscriptMessage): void {
    if (!this.db) return;
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO chat_transcript (project_id, thread_id, role, content, sources_json, meta_json, error, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      projectId,
      threadId,
      message.role,
      message.content,
      JSON.stringify(message.sources || []),
      JSON.stringify(message.meta || {}),
      message.error ? 1 : 0,
      message.timestamp || now,
    );
  }

  /** Load all messages for a thread, oldest first */
  load(projectId: string, threadId: string): ChatTranscriptMessage[] {
    if (!this.db) return [];
    const rows = this.db.prepare(`
      SELECT role, content, sources_json, meta_json, error, created_at
      FROM chat_transcript
      WHERE project_id = ? AND thread_id = ?
      ORDER BY id ASC
    `).all(projectId, threadId);

    return rows.map((row: any) => ({
      role: row.role as 'user' | 'assistant',
      content: row.content,
      sources: safeJsonParse(row.sources_json, []),
      meta: safeJsonParse(row.meta_json, {}),
      error: row.error === 1,
      timestamp: row.created_at,
    }));
  }

  /** Delete all messages for a thread */
  clear(projectId: string, threadId: string): void {
    if (!this.db) return;
    this.db.prepare(`
      DELETE FROM chat_transcript
      WHERE project_id = ? AND thread_id = ?
    `).run(projectId, threadId);
  }

  /** List all threads for a project, most recently active first */
  listThreads(projectId: string): ChatThreadInfo[] {
    if (!this.db) return [];
    const rows = this.db.prepare(`
      SELECT thread_id, COUNT(*) as message_count, MAX(created_at) as last_activity
      FROM chat_transcript
      WHERE project_id = ?
      GROUP BY thread_id
      ORDER BY last_activity DESC
    `).all(projectId);

    return rows.map((row: any) => ({
      threadId: row.thread_id,
      messageCount: row.message_count,
      lastActivity: row.last_activity,
    }));
  }

  /** Get the most recent thread_id for a project */
  getLatestThreadId(projectId: string): string | null {
    if (!this.db) return null;
    const row = this.db.prepare(`
      SELECT thread_id FROM chat_transcript
      WHERE project_id = ?
      ORDER BY created_at DESC
      LIMIT 1
    `).get(projectId);
    return row?.thread_id ?? null;
  }

  /** Generate a new thread ID (timestamp-based) */
  newThreadId(): string {
    return `t${Date.now().toString(36)}`;
  }
}

// Singleton
let _store: ChatTranscriptStore | null = null;

export function getChatStore(): ChatTranscriptStore {
  if (!_store) _store = new ChatTranscriptStore();
  return _store;
}
