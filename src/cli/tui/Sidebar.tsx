/**
 * Sidebar right panel with quick action hints and health snapshot.
 *
 * Modern design: Unicode separators, status dots, active indicator
 * with arrow symbol, brand-colored section headers.
 */

import React from 'react';
import { Box, Text, useInput } from 'ink';
import { COLORS, SEP, STATUS_DOTS, SYMBOLS } from './theme.js';
import type { HealthInfo, BackgroundInfo } from './data.js';
import type { ViewType } from './theme.js';

interface SidebarProps {
  health: HealthInfo;
  background: BackgroundInfo;
  onAction: (cmd: string) => void;
  activeView: ViewType;
  /** When true, Sidebar captures shortcut keys and drives navigation. */
  isFocused?: boolean;
}

const ACTIONS = [
  { key: 's', label: 'Search', cmd: '/search' },
  { key: 'r', label: 'Remember', cmd: '/remember' },
  { key: 'v', label: 'Recent', cmd: '/recent' },
  { key: 'd', label: 'Doctor', cmd: '/doctor' },
  { key: 'b', label: 'Background', cmd: '/background' },
  { key: 'w', label: 'Dashboard', cmd: '/dashboard' },
  { key: 'p', label: 'Project', cmd: '/project' },
  { key: 'c', label: 'Configure', cmd: '/configure' },
  { key: 'i', label: 'Integrate', cmd: '/integrate' },
  { key: 'h', label: 'Home', cmd: '/home' },
];

const SIDEBAR_WIDTH = 32;
const INNER_WIDTH = SIDEBAR_WIDTH - 4;
const ACTION_LABEL_WIDTH = INNER_WIDTH - 2;
const VALUE_WIDTH = INNER_WIDTH - 8;

function separator(width: number): string {
  return SEP.thin.repeat(width);
}

function colorForMode(mode: string): string {
  const normalized = mode.toLowerCase();
  if (normalized.includes('hybrid')) return COLORS.success;
  if (normalized.includes('vector')) return COLORS.accent;
  return COLORS.warning;
}

function charWidth(ch: string): number {
  const cp = ch.codePointAt(0)!;
  return ((cp >= 0x4E00 && cp <= 0x9FFF) || (cp >= 0x3040 && cp <= 0x30FF) ||
          (cp >= 0xAC00 && cp <= 0xD7AF) || (cp >= 0xFF01 && cp <= 0xFF60) ||
          (cp >= 0x3400 && cp <= 0x4DBF)) ? 2 : 1;
}

function fit(text: string, max: number): string {
  if (max <= 0) return '';
  let width = 0;
  for (const ch of text) {
    width += charWidth(ch);
    if (width > max) break;
  }
  if (width <= max) return text.padEnd(text.length + (max - width));
  if (max === 1) return '…';
  let result = '';
  let used = 0;
  for (const ch of text) {
    const cw = charWidth(ch);
    if (used + cw > max - 1) break;
    result += ch;
    used += cw;
  }
  const truncated = `${result}…`;
  return truncated.padEnd(truncated.length + Math.max(0, max - (used + 1)));
}

// Build a key→cmd lookup from ACTIONS for O(1) dispatch
const KEY_TO_CMD: Record<string, string> = {};
for (const a of ACTIONS) KEY_TO_CMD[a.key] = a.cmd;

export function Sidebar({ health, background, onAction, activeView, isFocused = false }: SidebarProps): React.ReactElement {
  // ── Interactive navigation: Sidebar owns shortcut key dispatch ──
  useInput((ch, key) => {
    // Esc: return home from any secondary view
    if (key.escape && activeView !== 'home') {
      onAction('/home');
      return;
    }
    const cmd = KEY_TO_CMD[ch];
    if (cmd) {
      onAction(cmd);
    }
  }, { isActive: isFocused });

  // Map view types to sidebar action commands for highlight
  const activeCmd = ACTIONS.find(a => {
    const viewMap: Record<string, string> = {
      '/search': 'search', '/recent': 'recent', '/doctor': 'doctor',
      '/background': 'background', '/dashboard': 'dashboard',
      '/project': 'project', '/configure': 'configure',
      '/integrate': 'integrate', '/home': 'home',
    };
    return viewMap[a.cmd] === activeView;
  })?.cmd;

  return (
    <Box
      flexDirection="column"
      width={SIDEBAR_WIDTH}
      borderStyle="single"
      borderColor={COLORS.border}
      paddingX={1}
    >
      <Box flexDirection="column" marginBottom={1}>
        <Text color={COLORS.brand} bold>Quick Actions</Text>
        <Text color={COLORS.border}>{separator(INNER_WIDTH)}</Text>
        {ACTIONS.map((action) => {
          const isActive = action.cmd === activeCmd;
          return (
            <Box key={action.key}>
              <Text color={isActive ? COLORS.brand : COLORS.muted}>
                {`${isActive ? SYMBOLS.arrow : action.key} `}
              </Text>
              <Text color={isActive ? COLORS.accent : COLORS.text} bold={isActive}>{fit(action.label, ACTION_LABEL_WIDTH)}</Text>
            </Box>
          );
        })}
      </Box>

      <Box flexDirection="column">
        <Text color={COLORS.brand} bold>Health</Text>
        <Text color={COLORS.border}>{separator(INNER_WIDTH)}</Text>

        <Box>
          <Text color={COLORS.muted}>{'Embed'.padEnd(8)}</Text>
          <Text color={
            health.embeddingProvider === 'ready' ? COLORS.success
            : health.embeddingProvider === 'unavailable' ? COLORS.warning
            : COLORS.muted
          }>
            {fit(`${health.embeddingProvider === 'ready' ? STATUS_DOTS.ok : health.embeddingProvider === 'unavailable' ? STATUS_DOTS.warn : STATUS_DOTS.off} ${health.embeddingLabel}`, VALUE_WIDTH)}
          </Text>
        </Box>
        <Box>
          <Text color={COLORS.muted}>{'Search'.padEnd(8)}</Text>
          <Text color={colorForMode(health.searchModeLabel)}>{fit(`${STATUS_DOTS.ok} ${health.searchModeLabel}`, VALUE_WIDTH)}</Text>
        </Box>
        <Box>
          <Text color={COLORS.muted}>{'Sess'.padEnd(8)}</Text>
          <Text color={COLORS.text}>{fit(`${health.sessions}`, VALUE_WIDTH)}</Text>
        </Box>

        <Box marginTop={1} flexDirection="column">
          <Text color={COLORS.brand} bold>Background</Text>
          <Text color={COLORS.border}>{separator(INNER_WIDTH)}</Text>
          <Box>
            <Text color={COLORS.muted}>{'Status'.padEnd(8)}</Text>
            <Text color={background.healthy ? COLORS.success : background.running ? COLORS.warning : COLORS.muted}>
              {fit(`${background.healthy ? STATUS_DOTS.running : background.running ? STATUS_DOTS.warn : STATUS_DOTS.stopped} ${background.healthy ? 'Running' : background.running ? 'Warning' : 'Stopped'}`, VALUE_WIDTH)}
            </Text>
          </Box>
          {background.port && (
            <Box>
              <Text color={COLORS.muted}>{'Port'.padEnd(8)}</Text>
              <Text color={COLORS.text}>{fit(`${background.port}`, VALUE_WIDTH)}</Text>
            </Box>
          )}
        </Box>
      </Box>

      <Box marginTop={1}>
        <Text color={COLORS.muted} italic>Keys or /cmd</Text>
      </Box>
    </Box>
  );
}
