/**
 * Top status bar for the Memorix workbench.
 */

import React from 'react';
import { Box, Text } from 'ink';
import { COLORS } from './theme.js';
import type { ProjectInfo, HealthInfo } from './data.js';

interface HeaderBarProps {
  version: string;
  project: ProjectInfo | null;
  health: HealthInfo;
  mode: string;
}

function colorForMode(mode: string): string {
  const normalized = mode.toLowerCase();
  if (normalized.includes('hybrid')) return COLORS.success;
  if (normalized.includes('vector')) return COLORS.accent;
  return COLORS.warning;
}

export function HeaderBar({ version, project, health, mode }: HeaderBarProps): React.ReactElement {
  return (
    <Box
      flexDirection="row"
      justifyContent="space-between"
      flexShrink={0}
      paddingX={1}
      borderStyle="single"
      borderColor={COLORS.border}
      borderBottom={true}
      borderTop={false}
      borderLeft={false}
      borderRight={false}
    >
      <Box>
        <Text color={COLORS.brand} bold>Memorix</Text>
        <Text color={COLORS.muted}> v{version}</Text>
      </Box>

      <Box>
        {project ? (
          <Text color={COLORS.text}>{project.name}</Text>
        ) : (
          <Text color={COLORS.warning}>no project</Text>
        )}
      </Box>

      <Box gap={1}>
        {project ? (
          <>
            <Text color={COLORS.accentDim}>{mode.toLowerCase()}</Text>
            <Text color={COLORS.muted}>|</Text>
            <Text color={colorForMode(health.searchModeLabel)}>{health.searchModeLabel}</Text>
            <Text color={COLORS.muted}>|</Text>
            <Text color={COLORS.text}>{health.activeMemories} mem</Text>
          </>
        ) : (
          <Text color={COLORS.muted}>/configure to get started</Text>
        )}
      </Box>
    </Box>
  );
}
