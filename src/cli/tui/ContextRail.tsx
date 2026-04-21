import React from 'react';
import { Box, Text } from 'ink';
import { COLORS, SEP, STATUS_DOTS, SYMBOLS } from './theme.js';
import type { ProjectInfo, HealthInfo, BackgroundInfo } from './data.js';
import type { ChatAnswer } from './chat-service.js';
import type { ViewType } from './theme.js';

interface ContextRailProps {
  project: ProjectInfo | null;
  health: HealthInfo;
  background: BackgroundInfo;
  activeView: ViewType;
  lastChat: ChatAnswer | null;
  transcriptCount: number;
  /** Rail width in columns (default 34). Parent should calculate based on terminal size. */
  width?: number;
}

function separator(width: number): string {
  return SEP.thin.repeat(width);
}

function charWidth(ch: string): number {
  const cp = ch.codePointAt(0)!;
  return ((cp >= 0x4E00 && cp <= 0x9FFF) || (cp >= 0x3040 && cp <= 0x30FF) ||
          (cp >= 0xAC00 && cp <= 0xD7AF) || (cp >= 0xFF01 && cp <= 0xFF60) ||
          (cp >= 0x3400 && cp <= 0x4DBF)) ? 2 : 1;
}

function fit(text: string, max: number): string {
  if (max <= 0) return '';
  // Measure display width (CJK chars = 2 columns)
  let w = 0;
  for (const ch of text) {
    w += charWidth(ch);
    if (w > max) break;
  }
  if (w <= max) return text.padEnd(text.length + (max - w));
  // Truncate by display width
  if (max === 1) return '…';
  let result = '';
  let rw = 0;
  for (const ch of text) {
    const cw = charWidth(ch);
    if (rw + cw > max - 1) break;
    result += ch;
    rw += cw;
  }
  const truncated = `${result}…`;
  return truncated.padEnd(truncated.length + Math.max(0, max - (rw + 1)));
}

export function ContextRail({ project, health, background, activeView, lastChat, transcriptCount, width: railWidth = 34 }: ContextRailProps): React.ReactElement {
  const width = railWidth;
  const inner = width - 4;

  return (
    <Box
      flexDirection="column"
      width={width}
      flexShrink={0}
      paddingLeft={1}
      borderStyle="single"
      borderColor={COLORS.border}
      borderLeft={true}
      borderTop={false}
      borderRight={false}
      borderBottom={false}
    >
      <Text color={COLORS.brand} bold wrap="truncate-end">Context</Text>
      <Text color={COLORS.border} wrap="truncate-end">{separator(inner)}</Text>

      <Box flexDirection="column" marginBottom={1}>
        <Text color={COLORS.muted} wrap="truncate-end">View</Text>
        <Text color={COLORS.text} wrap="truncate-end">{fit(activeView, inner)}</Text>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        <Text color={COLORS.muted} wrap="truncate-end">Project</Text>
        <Text color={project ? COLORS.text : COLORS.warning} wrap="truncate-end">{project ? fit(project.name, inner) : 'No project'}</Text>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        <Text color={COLORS.muted} wrap="truncate-end">Retrieval</Text>
        <Text color={health.embeddingProvider === 'ready' ? COLORS.success : COLORS.muted} wrap="truncate-end">
          {`${health.embeddingProvider === 'ready' ? STATUS_DOTS.ok : STATUS_DOTS.off} ${fit(health.searchModeLabel, inner - 2)}`}
        </Text>
        <Text color={COLORS.textDim} wrap="truncate-end">{fit(health.searchDiagnostic, inner)}</Text>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        <Text color={COLORS.muted} wrap="truncate-end">Session</Text>
        <Text color={COLORS.text} wrap="truncate-end">{fit(`${transcriptCount} messages`, inner)}</Text>
        <Text color={background.healthy ? COLORS.success : COLORS.muted} wrap="truncate-end">
          {fit(`${background.healthy ? STATUS_DOTS.running : STATUS_DOTS.off} background${background.port ? ` :${background.port}` : ''}`, inner)}
        </Text>
      </Box>

      {lastChat && lastChat.sources.length > 0 && (
        <Box flexDirection="column" marginBottom={1}>
          <Text color={COLORS.muted} wrap="truncate-end">Last sources</Text>
          {lastChat.sources.slice(0, 3).map((source) => (
            <Text key={source.id} color={COLORS.textDim} wrap="truncate-end">{fit(`[obs:${source.id}] ${source.title}`, inner)}</Text>
          ))}
        </Box>
      )}

      <Box flexDirection="column">
        <Text color={COLORS.muted} wrap="truncate-end">Quick actions</Text>
        <Text color={COLORS.textDim} wrap="truncate-end">{fit(`${SYMBOLS.arrow} /chat ask with memory`, inner)}</Text>
        <Text color={COLORS.textDim} wrap="truncate-end">{fit(`${SYMBOLS.arrow} /search inspect hits`, inner)}</Text>
        <Text color={COLORS.textDim} wrap="truncate-end">{fit(`${SYMBOLS.arrow} /recent recent activity`, inner)}</Text>
        <Text color={COLORS.textDim} wrap="truncate-end">{fit(`${SYMBOLS.arrow} /remember store a note`, inner)}</Text>
        <Text color={COLORS.textDim} wrap="truncate-end">{fit(`${SYMBOLS.arrow} /doctor diagnostics`, inner)}</Text>
      </Box>
    </Box>
  );
}
