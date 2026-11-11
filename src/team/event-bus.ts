/**
 * TeamEventBus — Process-local typed event emitter for team coordination.
 *
 * Phase 4b: Provides push-based acceleration within a single process.
 * NOT a cross-process mechanism — the orchestrator uses SQLite polling.
 *
 * Architectural boundary (B1): This is process-local fanout only.
 * No persistence, no cross-process delivery, no durability guarantees.
 * If no listeners are registered, events are silently dropped.
 */

import { EventEmitter } from 'node:events';

// ── Event type map ─────────────────────────────────────────────────

export interface TeamEventMap {
  'task:created':   { taskId: string; projectId: string; description: string };
  'task:claimed':   { taskId: string; projectId: string; agentId: string };
  'task:completed': { taskId: string; projectId: string; agentId: string; result?: string };
  'task:failed':    { taskId: string; projectId: string; agentId: string; result?: string };
  'task:released':  { taskId: string; projectId: string; agentId: string };
  'agent:joined':   { agentId: string; projectId: string; agentType: string };
  'agent:left':     { agentId: string; projectId: string };
  'agent:stale':    { agentId: string; projectId: string; releasedTasks: number };
  'handoff:created':{ observationId: number; projectId: string; fromAgent: string; toAgent?: string; taskId?: string };
}

export type TeamEventName = keyof TeamEventMap;

// ── TeamEventBus ───────────────────────────────────────────────────

export class TeamEventBus {
  private emitter = new EventEmitter();

  constructor() {
    // Prevent memory leak warnings for legitimate multi-listener scenarios
    this.emitter.setMaxListeners(50);
  }

  /**
   * Emit a typed event. Non-blocking, best-effort.
   * If no listeners are registered, the event is silently dropped.
   */
  emit<K extends TeamEventName>(event: K, data: TeamEventMap[K]): void {
    try {
      this.emitter.emit(event, data);
    } catch {
      // Best-effort: listener errors never propagate to caller
    }
  }

  /** Subscribe to a typed event. Returns unsubscribe function. */
  on<K extends TeamEventName>(event: K, listener: (data: TeamEventMap[K]) => void): () => void {
    this.emitter.on(event, listener);
    return () => { this.emitter.off(event, listener); };
  }

  /** Subscribe to a typed event, fire only once. */
  once<K extends TeamEventName>(event: K, listener: (data: TeamEventMap[K]) => void): void {
    this.emitter.once(event, listener);
  }

  /** Remove all listeners for a specific event, or all events if none specified. */
  removeAllListeners(event?: TeamEventName): void {
    if (event) {
      this.emitter.removeAllListeners(event);
    } else {
      this.emitter.removeAllListeners();
    }
  }

  /** Current listener count for a specific event. */
  listenerCount(event: TeamEventName): number {
    return this.emitter.listenerCount(event);
  }
}
