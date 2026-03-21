/**
 * Sidebar — Right panel with Quick Actions + Health Snapshot
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
  { key: 's', label: 'Search memory',   cmd: '/search' },
  { key: 'r', label: 'Remember',        cmd: '/remember' },
  { key: 'd', label: 'Doctor',          cmd: '/doctor' },
  { key: 'b', label: 'Background',      cmd: '/background' },
  { key: 'w', label: 'Dashboard',       cmd: '/dashboard' },
  { key: 'c', label: 'Configure',       cmd: '/configure' },
  { key: 'i', label: 'Integrate IDE',   cmd: '/integrate' },
];

export function Sidebar({ health, background, activeView }: SidebarProps): React.ReactElement {
  return (
    <Box
      flexDirection="column"
      width={28}
      borderStyle="single"
      borderColor={COLORS.border}
      paddingX={1}
    >
      {/* Quick Actions */}
      <Box flexDirection="column" marginBottom={1}>
        <Text color={COLORS.accentDim} bold>Quick Actions</Text>
        <Text color={COLORS.border}>{'─'.repeat(24)}</Text>
        {ACTIONS.map((a) => (
          <Box key={a.key}>
            <Text color={COLORS.muted}>{a.key} </Text>
            <Text color={COLORS.text}>{a.label}</Text>
          </Box>
        ))}
      </Box>

      {/* Health Snapshot */}
      <Box flexDirection="column">
        <Text color={COLORS.accentDim} bold>Health</Text>
        <Text color={COLORS.border}>{'─'.repeat(24)}</Text>

        <Box>
          <Text color={COLORS.muted}>Provider  </Text>
          <Text color={
            health.embeddingProvider === 'ready' ? COLORS.success
            : health.embeddingProvider === 'unavailable' ? COLORS.warning
            : COLORS.muted
          }>
            {health.embeddingProvider}
          </Text>
        </Box>

        <Box>
          <Text color={COLORS.muted}>Search    </Text>
          <Text color={
            health.searchMode.includes('hybrid') ? COLORS.success
            : health.searchMode.includes('vector') ? COLORS.accent
            : health.searchMode.includes('rerank') ? COLORS.success
            : COLORS.warning
          }>
            {health.searchMode}
          </Text>
        </Box>

        <Box>
          <Text color={COLORS.muted}>Sessions  </Text>
          <Text color={COLORS.text}>{health.sessions}</Text>
        </Box>

        {/* Background status */}
        <Box marginTop={1} flexDirection="column">
          <Text color={COLORS.accentDim} bold>Background</Text>
          <Text color={COLORS.border}>{'─'.repeat(24)}</Text>
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

      {/* Footer hint */}
      <Box marginTop={1}>
        <Text color={COLORS.muted} italic>Type / for commands</Text>
      </Box>
    </Box>
  );
}
