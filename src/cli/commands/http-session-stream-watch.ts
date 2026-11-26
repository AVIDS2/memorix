/**
 * Detects legacy Streamable HTTP sessions whose client has gone away.
 *
 * MCP clients built on the official SDK open a standalone GET/SSE stream right
 * after `notifications/initialized` and keep it open (reconnecting on drops)
 * for as long as the client lives. Many clients never send the optional
 * `DELETE /mcp` when they exit, so without this watch their sessions linger
 * until the idle timeout (12 hours by default) and count against the session
 * limit.
 *
 * A session is reported as abandoned only when both conditions hold:
 * 1. its last SSE stream closed and no new stream was opened within the grace
 *    window (an SDK client reconnects within a few seconds), and
 * 2. the client sent no request after the stream closed.
 *
 * Sessions that never open a GET stream are never reported: the idle timeout
 * remains their only cleanup path.
 */

export const DEFAULT_SESSION_DISCONNECT_GRACE_MS = 2 * 60 * 1000;

/** `MEMORIX_SESSION_DISCONNECT_GRACE_MS`: `0` disables the watch; invalid values keep the default. */
export function parseSessionDisconnectGraceMs(raw: string | undefined): number {
  const value = raw?.trim();
  if (!value) return DEFAULT_SESSION_DISCONNECT_GRACE_MS;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 2_147_483_647) return DEFAULT_SESSION_DISCONNECT_GRACE_MS;
  return Math.floor(parsed);
}

type TimerHandle = { unref?: () => unknown };

export interface SessionStreamWatchOptions {
  /** Grace window in milliseconds; `0` disables abandonment detection. */
  graceMs: number;
  /** Last request time of a live session, or `undefined` once the session is gone. */
  getLastActivity: (sessionId: string) => number | undefined;
  /** A queued or running request must finish before disconnect cleanup. */
  isBusy?: (sessionId: string) => boolean;
  /** Called once when a session is considered abandoned. */
  onAbandoned: (sessionId: string) => void;
  now?: () => number;
  setTimer?: (callback: () => void, ms: number) => TimerHandle;
  clearTimer?: (handle: TimerHandle) => void;
}

export interface SessionStreamWatch {
  /** A GET request for this session started. */
  streamOpened(sessionId: string): void;
  /**
   * That GET request ended. `wasStream` is false when the server refused the
   * request (non-200), which must not arm abandonment on its own.
   */
  streamClosed(sessionId: string, wasStream: boolean): void;
  /** The session closed for another reason; drop its state. */
  forget(sessionId: string): void;
  /** Cancel every pending timer (shutdown). */
  dispose(): void;
  /** Number of sessions with a pending abandonment timer (diagnostics/tests). */
  pendingCount(): number;
}

export function createSessionStreamWatch(options: SessionStreamWatchOptions): SessionStreamWatch {
  const now = options.now ?? Date.now;
  const setTimer = options.setTimer ?? ((callback, ms) => setTimeout(callback, ms));
  const clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  const openStreams = new Map<string, number>();
  const pending = new Map<string, TimerHandle>();

  function cancel(sessionId: string): void {
    const handle = pending.get(sessionId);
    if (!handle) return;
    clearTimer(handle);
    pending.delete(sessionId);
  }

  return {
    streamOpened(sessionId) {
      if (options.graceMs === 0) return;
      cancel(sessionId);
      openStreams.set(sessionId, (openStreams.get(sessionId) ?? 0) + 1);
    },

    streamClosed(sessionId, wasStream) {
      if (!openStreams.has(sessionId)) return;
      const remaining = Math.max(0, (openStreams.get(sessionId) ?? 0) - 1);
      if (remaining > 0) {
        openStreams.set(sessionId, remaining);
        return;
      }
      openStreams.delete(sessionId);
      if (!wasStream || options.graceMs === 0) return;
      if (options.getLastActivity(sessionId) === undefined) return;

      cancel(sessionId);
      const closedAt = now();
      const check = () => {
        pending.delete(sessionId);
        if ((openStreams.get(sessionId) ?? 0) > 0) return;
        const lastActivity = options.getLastActivity(sessionId);
        if (lastActivity === undefined) return;
        // The client is still talking to us without its stream: leave the
        // session to the idle timeout instead of cutting a live client.
        if (lastActivity > closedAt) return;
        if (options.isBusy?.(sessionId)) {
          const next = setTimer(check, options.graceMs);
          next.unref?.();
          pending.set(sessionId, next);
          return;
        }
        options.onAbandoned(sessionId);
      };
      const handle = setTimer(check, options.graceMs);
      handle.unref?.();
      pending.set(sessionId, handle);
    },

    forget(sessionId) {
      cancel(sessionId);
      openStreams.delete(sessionId);
    },

    dispose() {
      for (const handle of pending.values()) clearTimer(handle);
      pending.clear();
      openStreams.clear();
    },

    pendingCount() {
      return pending.size;
    },
  };
}
