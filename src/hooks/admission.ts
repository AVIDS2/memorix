import type { ObservationAdmissionState, ObservationType } from '../types.js';
import { isSignificantKnowledge } from './significance-filter.js';
import type { NormalizedHookInput } from './types.js';

export type HookCaptureCategory =
  | 'file_modify'
  | 'file_read'
  | 'command'
  | 'search'
  | 'memorix_internal'
  | 'unknown';

export type HookAdmissionDecision =
  | { action: 'drop'; reason: string }
  | {
    action: 'store';
    admissionState: ObservationAdmissionState;
    admissionReason: string;
    valueCategory: 'core' | 'contextual' | 'ephemeral';
  };

const FAILURE_PATTERN = /\b(fail(?:ed|ure)?|error|exception|assert(?:ion)?|exit code [1-9]|TypeError|ReferenceError|SyntaxError|ENOENT|ECONNREFUSED|panic)\b/i;
const DECISION_PATTERN = /\b(decision|decided|choose|chosen|because|trade-?off|invariant|root cause|workaround|must|should not)\b/i;
const TASK_PATTERN = /\b(add|implement|fix|refactor|migrate|upgrade|debug|investigate|test|release|deploy|remove)\b/i;
const VALIDATION_PATTERN = /\b(test|tests|vitest|jest|pytest|playwright|cypress|typecheck|lint|build|cargo test|go test)\b/i;
const FOCUSED_VALIDATION_PATTERN = /(?:--run|--filter|--grep|\s-t\s|\.test\.|\.spec\.|::[\w-]+)/i;
const ROUTINE_SUCCESS_PATTERN = /\b(added \d+ packages|up to date|passed|all tests pass|tests? passed|0 failures|success(?:fully)?)\b/i;

function isCandidateType(type: ObservationType): boolean {
  return type === 'decision' ||
    type === 'gotcha' ||
    type === 'problem-solution' ||
    type === 'trade-off' ||
    type === 'why-it-exists';
}

function candidate(
  admissionReason: string,
  valueCategory: 'core' | 'contextual' = 'contextual',
): HookAdmissionDecision {
  return { action: 'store', admissionState: 'candidate', admissionReason, valueCategory };
}

function ephemeral(admissionReason: string): HookAdmissionDecision {
  return { action: 'store', admissionState: 'ephemeral', admissionReason, valueCategory: 'ephemeral' };
}

/**
 * Cheap, deterministic first-pass admission for cross-agent hooks. It never
 * promotes an automatic record directly to durable context: background
 * qualification must still prove a current Code Memory reference.
 */
export function assessHookAdmission(input: {
  hook: NormalizedHookInput;
  category: HookCaptureCategory;
  content: string;
  observationType: ObservationType;
}): HookAdmissionDecision {
  const { hook, category, content, observationType } = input;
  const command = hook.command ?? '';
  const hasFailure = FAILURE_PATTERN.test(content);
  const hasDecision = DECISION_PATTERN.test(content) || isCandidateType(observationType);
  const isValidation = VALIDATION_PATTERN.test(command) || VALIDATION_PATTERN.test(content);
  const isFocusedValidation = FOCUSED_VALIDATION_PATTERN.test(command);
  const isRoutineSuccess = ROUTINE_SUCCESS_PATTERN.test(content);

  if (hasFailure) {
    return candidate('automatic capture contains a concrete failure or verification signal');
  }
  if (hasDecision) {
    return candidate('automatic capture contains a decision or durable rationale', 'core');
  }

  if (hook.event === 'user_prompt') {
    return TASK_PATTERN.test(content)
      ? candidate('user task contains a concrete technical action')
      : { action: 'drop', reason: 'prompt has no durable technical task signal' };
  }

  if (hook.event === 'post_response') {
    // Agent integrations such as OpenCode emit concise end-of-turn summaries.
    // Keep technically meaningful ones as candidates; qualification still
    // prevents them from becoming automatic context without code evidence.
    return isSignificantKnowledge(content).isSignificant
      ? candidate('assistant response records a concrete technical outcome')
      : { action: 'drop', reason: 'response has no durable technical outcome' };
  }

  if (hook.event === 'session_end') {
    // The handler already applies a minimum-content gate for session end.
    // Preserve a compact handoff trace, but keep it out of automatic context
    // until later qualification.
    return candidate('session-end summary awaits Code Memory qualification');
  }

  if (category === 'file_modify') {
    return candidate('file mutation awaits Code Memory qualification');
  }

  if (category === 'command') {
    if (isValidation && isFocusedValidation && !isRoutineSuccess) {
      return candidate('focused validation result awaits Code Memory qualification');
    }
    if (isValidation || isRoutineSuccess) {
      return ephemeral('routine command result retained only as a short-lived trace');
    }
    return ephemeral('command activity retained only as a short-lived trace');
  }

  if (category === 'search' || category === 'unknown') {
    return content.length >= 300
      ? ephemeral('unverified automatic activity retained only as a short-lived trace')
      : { action: 'drop', reason: 'automatic activity has insufficient evidence' };
  }

  return { action: 'drop', reason: 'capture category is not eligible for automatic storage' };
}
