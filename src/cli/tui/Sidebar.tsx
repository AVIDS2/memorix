/**
 * Sidebar right panel with quick action hints and health snapshot.
 */

import React from 'react';
import { Box, Text } from 'ink';
import { COLORS } from './theme.js';
import type { HealthInfo, BackgroundInfo } from './data.js';
import type { ViewType } from './theme.js';

interface SidebarProps {
  health: HealthInfo;
  background: BackgroundInfo;
  onAction: (cmd: string) => void;
  activeView: ViewType;
}

const ACTIONS = [
  { key: 's', label: 'Search memory', cmd: '/search' },
  { key: 'r', label: 'Remember', cmd: '/remember' },
  { key: 'v', label: 'Recent activity', cmd: '/recent' },
  { key: 'd', label: 'Doctor', cmd: '/doctor' },
  { key: 'b', label: 'Background', cmd: '/background' },
  { key: 'w', label: 'Dashboard', cmd: '/dashboard' },
  { key: 'p', label: 'Project info', cmd: '/project' },
  { key: 'c', label: 'Configure', cmd: '/configure' },
  { key: 'i', label: 'Integrate IDE', cmd: '/integrate' },
  { key: 'h', label: 'Home', cmd: '/home' },
];

function separator(width: number): string {
  return '-'.repeat(width);
}

function colorForMode(mode: string): string {
  const normalized = mode.toLowerCase();
  if (normalized.includes('hybrid')) return COLORS.success;
  if (normalized.includes('vector')) return COLORS.accent;
  return COLORS.warning;
}

function truncate(text: string, max = 16): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}...`;
}

export function Sidebar({ health, background }: SidebarProps): React.ReactElement {
  return (
    <Box
      flexDirection="column"
      width={28}
      borderStyle="single"
      borderColor={COLORS.border}
      paddingX={1}
    >
      <Box flexDirection="column" marginBottom={1}>
        <Text color={COLORS.accentDim} bold>Quick Actions</Text>
        <Text color={COLORS.border}>{separator(24)}</Text>
        {ACTIONS.map((action) => (
          <Box key={action.key}>
            <Text color={COLORS.muted}>{action.key} </Text>
            <Text color={COLORS.text}>{action.label}</Text>
          </Box>
        ))}
      </Box>

      <Box flexDirection="column">
        <Text color={COLORS.accentDim} bold>Health</Text>
        <Text color={COLORS.border}>{separator(24)}</Text>

        <Box>
          <Text color={COLORS.muted}>{'Embed'.padEnd(10)}</Text>
          <Text color={
            health.embeddingProvider === 'ready' ? COLORS.success
            : health.embeddingProvider === 'unavailable' ? COLORS.warning
            : COLORS.muted
          }>{health.embeddingLabel}</Text>
        </Box>
        {health.embeddingProviderName && (
          <Box>
            <Text color={COLORS.muted}>{'  '}</Text>
            <Text color={COLORS.textDim}>{truncate(health.embeddingProviderName, 20)}</Text>
          </Box>
        )}
        <Box>
          <Text color={COLORS.muted}>{'Search'.padEnd(10)}</Text>
          <Text color={colorForMode(health.searchModeLabel)}>{health.searchModeLabel}</Text>
        </Box>
        <Box>
          <Text color={COLORS.muted}>{'Sessions'.padEnd(10)}</Text>
          <Text color={COLORS.text}>{health.sessions}</Text>
        </Box>

        <Box marginTop={1} flexDirection="column">
          <Text color={COLORS.accentDim} bold>Background</Text>
          <Text color={COLORS.border}>{separator(24)}</Text>
          <Box>
            <Text color={COLORS.muted}>Status    </Text>
            <Text color={background.healthy ? COLORS.success : background.running ? COLORS.warning : COLORS.muted}>
              {background.healthy ? 'Running' : background.running ? 'Unhealthy' : 'Stopped'}
            </Text>
          </Box>
          {background.port && (
            <Box>
              <Text color={COLORS.muted}>Port      </Text>
              <Text color={COLORS.text}>{background.port}</Text>
            </Box>
          )}
        </Box>
      </Box>

      <Box marginTop={1}>
        <Text color={COLORS.muted} italic>Type / for commands</Text>
      </Box>
    </Box>
  );
}
