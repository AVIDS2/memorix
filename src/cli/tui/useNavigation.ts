/**
 * Centralized keyboard navigation for the Memorix TUI.
 *
 * Three-layer priority model:
 * 1. Action view local keys (1-9, h, w, Esc) — highest
 * 2. CommandBar input mode — captures all printable chars when focused
 * 3. Global nav keys (s, r, v, d, b, w, p, c, i, h) — lowest, only when idle
 */

import type { ViewType } from './theme.js';

/** Maps single-char shortcut keys to view navigation commands */
export const NAV_KEY_MAP: Record<string, string> = {
  s: '/search',
  r: '/remember',
  v: '/recent',
  d: '/doctor',
  b: '/background',
  w: '/dashboard',
  p: '/project',
  c: '/configure',
  i: '/integrate',
  h: '/home',
};

/** Views that handle their own number/letter keys (action views) */
export const ACTION_VIEWS: Set<ViewType> = new Set([
  'cleanup', 'ingest', 'background', 'dashboard', 'integrate', 'configure',
]);

/** Views where Esc returns to home */
export const ESC_RETURNABLE_VIEWS: Set<ViewType> = new Set([
  'recent', 'doctor', 'project', 'cleanup', 'ingest',
  'background', 'dashboard', 'integrate', 'configure', 'search',
]);

/**
 * Determine if a key press should be handled as global navigation.
 *
 * Returns the command string (e.g. '/recent') if the key is a nav key
 * and the current context allows it, or null otherwise.
 */
export function resolveGlobalNav(
  ch: string,
  currentView: ViewType,
  isInputFocused: boolean,
): string | null {
  // Never intercept during input
  if (isInputFocused) return null;

  // Action views handle their own keys — only allow 'h' for home
  if (ACTION_VIEWS.has(currentView)) return null;

  const cmd = NAV_KEY_MAP[ch];
  return cmd ?? null;
}
