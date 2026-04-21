/**
 * Top status bar for the Memorix workbench.
 *
 * Modern design: brand symbol, pill-style badges, status dots,
 * Unicode separators.
 */

import React from 'react';
import { Box, Text } from 'ink';
import { COLORS, STATUS_DOTS, SYMBOLS } from './theme.js';
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
      {/* Brand */}
      <Box gap={1}>
        <Text color={COLORS.brand} bold>{SYMBOLS.bullet} Memorix</Text>
        <Text color={COLORS.muted}>v{version}</Text>
      </Box>

      {/* Project name */}
      <Box>
        {project ? (
          <Text color={COLORS.text}>{project.name}</Text>
        ) : (
          <Text color={COLORS.warning}>{STATUS_DOTS.warn} no project</Text>
        )}
      </Box>

      {/* Status badges */}
      <Box gap={1}>
        {project ? (
          <>
            <Text color={COLORS.muted}>{SYMBOLS.pill(mode.toLowerCase())}</Text>
            <Text color={COLORS.border}>│</Text>
            <Text color={colorForMode(health.searchModeLabel)}>{STATUS_DOTS.ok} {health.searchModeLabel}</Text>
            <Text color={COLORS.border}>│</Text>
            <Text color={COLORS.text}>{health.activeMemories} mem</Text>
          </>
        ) : (
          <Text color={COLORS.muted}>/configure to get started</Text>
        )}
      </Box>
    </Box>
  );
}
