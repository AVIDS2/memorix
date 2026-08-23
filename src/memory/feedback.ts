import type { ObservationStatus } from '../types.js';

export type MemoryFeedbackSignal =
  | 'user-correction'
  | 'verification-success'
  | 'verification-failure'
  | 'code-change'
  | 'used'
  | 'not-used'
  | 'code-conflict';

export interface MemoryFeedbackEvent {
  signal: MemoryFeedbackSignal;
  at: string;
  actor?: string;
  note?: string;
}

export interface FeedbackState {
  weight: number;
  status: ObservationStatus;
  audit: MemoryFeedbackEvent[];
}

/** Deterministic feedback reducer used by MCP/CLI adapters and tests. */
export function applyMemoryFeedback(
  current: FeedbackState,
  event: MemoryFeedbackEvent,
): FeedbackState {
  const delta: Record<MemoryFeedbackSignal, number> = {
    'user-correction': -0.35,
    'verification-success': 0.25,
    'verification-failure': -0.25,
    'code-change': -0.15,
    used: 0.1,
    'not-used': -0.05,
    'code-conflict': -0.4,
  };
  const weight = Math.max(0, Math.min(2, current.weight + delta[event.signal]));
  const status: ObservationStatus = event.signal === 'code-conflict' && weight < 0.5
    ? 'archived'
    : current.status;
  return { weight, status, audit: [...current.audit, { ...event }] };
}
