/**
 * Hooks Module — Public API
 */

export { normalizeHookInput } from './normalizer.js';
export { detectPatterns, detectBestPattern, patternToObservationType } from './pattern-detector.js';
export { handleHookEvent, runHook } from './handler.js';
export { detectInstalledAgents, installHooks, uninstallHooks, getHookStatus } from './installers/index.js';
export type {
  HookEvent,
  AgentName,
  NormalizedHookInput,
  HookOutput,
  PatternType,
  DetectedPattern,
  AgentHookConfig,
} from './types.js';
