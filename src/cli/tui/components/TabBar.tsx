/**
 * TabBar — Top-level tab navigation for the Memorix Workbench.
 *
 * Renders 5 tabs: Home, Knowledge, Memory, Workbench, Graph.
 * Keyboard: Alt+1..5 or Ctrl+Left/Right to switch.
 */

import React from 'react';
import { Box, Text } from 'ink';
import { COLORS } from '../theme.js';

export interface TabDef {
  id: string;
  label: string;
  shortcut: string;
}

export const TABS: TabDef[] = [
  { id: 'home', label: 'Home', shortcut: 'Alt+1' },
  { id: 'knowledge', label: 'Knowledge', shortcut: 'Alt+2' },
  { id: 'memory', label: 'Memory', shortcut: 'Alt+3' },
  { id: 'workbench', label: 'Workbench', shortcut: 'Alt+4' },
  { id: 'graph', label: 'Graph', shortcut: 'Alt+5' },
];

interface TabBarProps {
  activeTab: string;
  contentWidth: number;
}

export function TabBar({ activeTab, contentWidth }: TabBarProps): React.ReactElement {
  const maxWidth = Math.min(contentWidth, 80);

  return (
    <Box flexDirection="row" width={maxWidth} flexShrink={0}>
      {TABS.map((tab) => {
        const isActive = tab.id === activeTab;
        const color = isActive ? COLORS.brand : COLORS.muted;
        const prefix = isActive ? '#' : ' ';
        const label = `${prefix} ${tab.label}`;
        return (
          <Box key={tab.id} marginRight={2}>
            <Text color={color} bold={isActive}>
              {label}
            </Text>
          </Box>
        );
      })}
      <Box flexGrow={1} />
      <Text color={COLORS.textDim}>Ctrl+Left/Right</Text>
    </Box>
  );
}
