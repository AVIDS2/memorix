/**
 * HomeView — Project overview and health summary.
 *
 * Shows project info, memory stats, embedding/search status, background status.
 * Quick entry points to other tabs.
 */

import React from 'react';
import { Box, Text } from 'ink';
import { COLORS, SEP, STATUS_DOTS } from '../theme.js';
import { LogoBanner } from '../LogoBanner.js';
import type { ProjectInfo, HealthInfo, BackgroundInfo } from '../data.js';

function separator(width = 50): string {
  return SEP.thin.repeat(width);
}

interface HomeViewProps {
  project: ProjectInfo | null;
  health: HealthInfo;
  background: BackgroundInfo;
  contentWidth: number;
}

export function HomeView({ project, health, background, contentWidth }: HomeViewProps): React.ReactElement {
  if (!project) {
    return (
      <Box flexDirection="column" paddingX={1}>
        <LogoBanner width={contentWidth} />
        <Box flexDirection="column" marginBottom={1} marginTop={1}>
          <Text color={COLORS.warning} bold>{STATUS_DOTS.warn} No project detected</Text>
          <Text color={COLORS.border}>{separator()}</Text>
          <Text color={COLORS.muted}>Memorix works best inside a git repository.</Text>
          <Text color={COLORS.muted}>Navigate to your project directory and re-launch, or:</Text>
        </Box>
        <Box flexDirection="column" marginBottom={1}>
          <Text color={COLORS.brand} bold>Getting Started</Text>
          <Text color={COLORS.border}>{separator()}</Text>
          <Text color={COLORS.textDim}>  git init         Initialize a git repo</Text>
          <Text color={COLORS.textDim}>  /configure       Set up LLM + embedding</Text>
          <Text color={COLORS.textDim}>  /search {'<'}query{'>'}  Search memories</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={1}>
      {/* Project Summary */}
      <Box flexDirection="column" marginBottom={1}>
        <Text color={COLORS.brand} bold>Project</Text>
        <Text color={COLORS.border}>{separator()}</Text>
        <Box>
          <Text color={COLORS.muted}>{'Name'.padEnd(10)}</Text>
          <Text color={COLORS.text}>{project.name}</Text>
        </Box>
        <Box>
          <Text color={COLORS.muted}>{'Root'.padEnd(10)}</Text>
          <Text color={COLORS.textDim}>{project.rootPath}</Text>
        </Box>
      </Box>

      {/* Memory & Search Status */}
      <Box flexDirection="column" marginBottom={1}>
        <Text color={COLORS.brand} bold>Memory</Text>
        <Text color={COLORS.border}>{separator()}</Text>
        <Box>
          <Text color={COLORS.muted}>{'Active'.padEnd(10)}</Text>
          <Text color={COLORS.text}>{health.activeMemories} memories</Text>
        </Box>
        <Box>
          <Text color={COLORS.muted}>{'Total'.padEnd(10)}</Text>
          <Text color={COLORS.textDim}>{health.totalMemories} stored</Text>
        </Box>
        <Box>
          <Text color={COLORS.muted}>{'Sessions'.padEnd(10)}</Text>
          <Text color={COLORS.textDim}>{health.sessions}</Text>
        </Box>
        <Box>
          <Text color={COLORS.muted}>{'Search'.padEnd(10)}</Text>
          <Text color={health.searchModeLabel.toLowerCase().includes('hybrid') ? COLORS.success : COLORS.warning}>
            {STATUS_DOTS.ok} {health.searchModeLabel}
          </Text>
        </Box>
      </Box>

      {/* Embedding status */}
      <Box flexDirection="column" marginBottom={1}>
        <Text color={COLORS.brand} bold>Embedding</Text>
        <Text color={COLORS.border}>{separator()}</Text>
        <Box>
          <Text color={COLORS.muted}>{'Status'.padEnd(10)}</Text>
          <Text color={
            health.embeddingProvider === 'ready' ? COLORS.success :
            health.embeddingProvider === 'unavailable' ? COLORS.warning : COLORS.muted
          }>
            {health.embeddingProvider === 'ready' ? STATUS_DOTS.ok : STATUS_DOTS.off}{' '}
            {health.embeddingLabel}
          </Text>
        </Box>
        {health.searchDiagnostic && (
          <Box>
            <Text color={COLORS.muted}>{''.padEnd(10)}</Text>
            <Text color={COLORS.textDim}>{health.searchDiagnostic}</Text>
          </Box>
        )}
      </Box>

      {/* Background service */}
      <Box flexDirection="column" marginBottom={1}>
        <Text color={COLORS.brand} bold>Background</Text>
        <Text color={COLORS.border}>{separator()}</Text>
        <Box>
          <Text color={
            background.healthy ? COLORS.success :
            background.running ? COLORS.warning : COLORS.muted
          }>
            {background.healthy ? `${STATUS_DOTS.running} Running` :
             background.running ? `${STATUS_DOTS.warn} Unhealthy` :
             `${STATUS_DOTS.stopped} Stopped`}
          </Text>
          {background.port && <Text color={COLORS.textDim}> :{background.port}</Text>}
        </Box>
      </Box>

      {/* Quick navigation hints */}
      <Box flexDirection="column" marginTop={1}>
        <Text color={COLORS.textDim}>
          Alt+2 Knowledge  |  Alt+3 Memory  |  Alt+4 Workbench  |  Alt+5 Graph
        </Text>
      </Box>
    </Box>
  );
}
