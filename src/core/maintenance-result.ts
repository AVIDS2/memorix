/** Counts from one bounded maintenance attempt, never cumulative lifetime totals. */
export interface MaintenanceProgress {
  attempted: number;
  succeeded: number;
  failed: number;
  remaining: number;
}

/** The kernel's durable background-work result, independent of its runner. */
export type MaintenanceResult =
  | { action: 'complete'; progress?: MaintenanceProgress }
  | {
    action: 'reschedule';
    delayMs: number;
    resetAttempts?: boolean;
    payload?: Record<string, unknown>;
    status?: 'pending' | 'retry';
    lastError?: string;
    clearLastError?: boolean;
    progress?: MaintenanceProgress;
  };

/** Reject progress that would make a completed or retrying job look healthier than it is. */
export function assertMaintenanceProgress(progress: MaintenanceProgress | undefined): void {
  if (!progress) return;
  const counts = [progress.attempted, progress.succeeded, progress.failed, progress.remaining];
  if (counts.some((count) => !Number.isSafeInteger(count) || count < 0)) {
    throw new Error('maintenance progress must contain non-negative safe integers');
  }
  if (progress.succeeded + progress.failed > progress.attempted) {
    throw new Error('maintenance progress outcomes exceed attempted work');
  }
}
