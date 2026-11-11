/**
 * LogoBanner — ASCII art Memorix-Bridge logo with gradient coloring.
 *
 * Uses ink-gradient for the brand gradient effect.
 * Falls back to a compact single-line on narrow terminals (< 50 cols).
 */

import React from 'react';
import { Box, Text } from 'ink';
import BigText from 'ink-big-text';
import Gradient from 'ink-gradient';
import { COLORS } from './theme.js';

const SUBTITLE = 'Memory workbench for coding agents';

interface LogoBannerProps {
  /** Terminal width — used to decide full vs compact mode */
  width?: number;
  /** App version string, e.g. "1.0.8" */
  version?: string;
}

export function LogoBanner({ width = 80, version }: LogoBannerProps): React.ReactElement {
  const compact = width < 54;
  const full = width >= 72;
  const brandColors = [COLORS.brandBright, COLORS.brand, COLORS.brandDim];

  if (compact) {
    return (
      <Box paddingX={1} flexDirection="column" alignItems="center">
        <Gradient colors={brandColors}>
          <Text bold>Memorix</Text>
        </Gradient>
        <Text color={COLORS.textDim}>Memory workbench</Text>
        {version && <Text color={COLORS.muted}>v{version}</Text>}
      </Box>
    );
  }

  return (
    <Box flexDirection="column" alignItems="center" paddingX={1}>
      <Gradient colors={brandColors}>
        {full ? <BigText text="MEMORIX" font="block" /> : <Text bold>MEMORIX</Text>}
      </Gradient>
      <Box>
        <Text color={COLORS.textDim}>{SUBTITLE}</Text>
        {version && <Text color={COLORS.muted}>  v{version}</Text>}
      </Box>
    </Box>
  );
}
