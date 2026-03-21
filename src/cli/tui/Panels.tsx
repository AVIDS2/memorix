/**
 * Panels — Content panels for the main work area
 *
 * HomeView, SearchResultsView, DoctorView, ProjectView, BackgroundView
 */

import React from 'react';
import { Box, Text } from 'ink';
import { COLORS, TYPE_ICONS } from './theme.js';
import type {
  MemoryItem,
  SearchResult,
  DoctorResult,
  ProjectInfo,
  BackgroundInfo,
} from './data.js';

// ── Home View ──────────────────────────────────────────────────

interface HomeViewProps {
  recentMemories: MemoryItem[];
  project: ProjectInfo | null;
  loading: boolean;
}

export function HomeView({ recentMemories, project, loading }: HomeViewProps): React.ReactElement {
  return (
    <Box flexDirection="column" paddingX={1}>
      {/* Project summary */}
      <Box flexDirection="column" marginBottom={1}>
        <Text color={COLORS.accentDim} bold>Project</Text>
        <Text color={COLORS.border}>{'─'.repeat(50)}</Text>
        {project ? (
          <Box flexDirection="column">
            <Box>
              <Text color={COLORS.muted}>{'Name'.padEnd(10)}</Text>
              <Text color={COLORS.text}>{project.name}</Text>
            </Box>
            <Box>
              <Text color={COLORS.muted}>{'Root'.padEnd(10)}</Text>
              <Text color={COLORS.textDim}>{project.rootPath}</Text>
            </Box>
            <Box>
              <Text color={COLORS.muted}>{'Remote'.padEnd(10)}</Text>
              <Text color={COLORS.textDim}>{project.gitRemote}</Text>
            </Box>
          </Box>
        ) : (
          <Text color={COLORS.warning}>No project detected. Run git init first.</Text>
        )}
      </Box>

      {/* Recent memories */}
      <Box flexDirection="column">
        <Text color={COLORS.accentDim} bold>Recent Memories</Text>
        <Text color={COLORS.border}>{'─'.repeat(50)}</Text>
        {loading ? (
          <Text color={COLORS.muted}>Loading...</Text>
        ) : recentMemories.length === 0 ? (
          <Text color={COLORS.muted}>No memories yet. Use /remember to store one.</Text>
        ) : (
          recentMemories.map((m) => (
            <Box key={m.id}>
              <Text color={COLORS.muted}>[{(TYPE_ICONS[m.type] || '·')}] </Text>
              <Text color={COLORS.textDim}>#{m.id} </Text>
              <Text color={COLORS.text}>{m.title.slice(0, 60)}{m.title.length > 60 ? '…' : ''}</Text>
            </Box>
          ))
        )}
      </Box>
    </Box>
  );
}

// ── Search Results View ────────────────────────────────────────

interface SearchResultsViewProps {
  results: SearchResult[];
  query: string;
  loading: boolean;
}

export function SearchResultsView({ results, query, loading }: SearchResultsViewProps): React.ReactElement {
  return (
    <Box flexDirection="column" paddingX={1}>
      <Box>
        <Text color={COLORS.accentDim} bold>Search: </Text>
        <Text color={COLORS.text}>"{query}"</Text>
        {!loading && <Text color={COLORS.muted}> — {results.length} results</Text>}
      </Box>
      <Text color={COLORS.border}>{'─'.repeat(50)}</Text>

      {loading ? (
        <Text color={COLORS.muted}>Searching...</Text>
      ) : results.length === 0 ? (
        <Text color={COLORS.muted}>No results found.</Text>
      ) : (
        results.map((r) => (
          <Box key={r.id}>
            <Text color={COLORS.muted}>[{r.icon}] </Text>
            <Text color={COLORS.textDim}>#{r.id} </Text>
            <Text color={COLORS.text}>{r.title.slice(0, 60)}{r.title.length > 60 ? '…' : ''}</Text>
            <Text color={COLORS.muted}> ({(r.score * 100).toFixed(0)}%)</Text>
          </Box>
        ))
      )}
    </Box>
  );
}

// ── Doctor View ────────────────────────────────────────────────

interface DoctorViewProps {
  doctor: DoctorResult | null;
  loading: boolean;
}

const STATUS_COLORS: Record<string, string> = {
  ok: COLORS.success,
  warn: COLORS.warning,
  error: COLORS.error,
  info: COLORS.textDim,
};

const STATUS_ICONS: Record<string, string> = {
  ok: '✓',
  warn: '⚠',
  error: '✗',
  info: '·',
};

export function DoctorView({ doctor, loading }: DoctorViewProps): React.ReactElement {
  return (
    <Box flexDirection="column" paddingX={1}>
      <Text color={COLORS.accentDim} bold>Diagnostics</Text>
      <Text color={COLORS.border}>{'─'.repeat(50)}</Text>

      {loading ? (
        <Text color={COLORS.muted}>Running diagnostics...</Text>
      ) : !doctor ? (
        <Text color={COLORS.warning}>Failed to run diagnostics.</Text>
      ) : (
        doctor.sections.map((section, i) => (
          <Box key={i} flexDirection="column" marginBottom={1}>
            <Text color={COLORS.text} bold>{section.title}</Text>
            {section.items.map((item, j) => (
              <Box key={j}>
                <Text color={STATUS_COLORS[item.status] || COLORS.muted}>
                  {STATUS_ICONS[item.status] || '·'}{' '}
                </Text>
                <Text color={COLORS.muted}>{item.label.padEnd(12)}</Text>
                <Text color={COLORS.text}>{item.value}</Text>
              </Box>
            ))}
          </Box>
        ))
      )}
    </Box>
  );
}

// ── Project View ───────────────────────────────────────────────

interface ProjectViewProps {
  project: ProjectInfo | null;
}

export function ProjectView({ project }: ProjectViewProps): React.ReactElement {
  return (
    <Box flexDirection="column" paddingX={1}>
      <Text color={COLORS.accentDim} bold>Project Details</Text>
      <Text color={COLORS.border}>{'─'.repeat(50)}</Text>

      {!project ? (
        <Text color={COLORS.warning}>No project detected. Run git init first.</Text>
      ) : (
        <Box flexDirection="column">
          {([
            ['Name', project.name],
            ['ID', project.id],
            ['Root', project.rootPath],
            ['Remote', project.gitRemote],
          ] as const).map(([label, value]) => (
            <Box key={label}>
              <Text color={COLORS.muted}>{String(label).padEnd(10)}</Text>
              <Text color={COLORS.text}>{value}</Text>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}

// ── Background View ────────────────────────────────────────────

interface BackgroundViewProps {
  background: BackgroundInfo;
  loading: boolean;
}

export function BackgroundView({ background, loading }: BackgroundViewProps): React.ReactElement {
  return (
    <Box flexDirection="column" paddingX={1}>
      <Text color={COLORS.accentDim} bold>Background Control Plane</Text>
      <Text color={COLORS.border}>{'─'.repeat(50)}</Text>

      {loading ? (
        <Text color={COLORS.muted}>Checking status...</Text>
      ) : (
        <Box flexDirection="column">
          <Box>
            <Text color={COLORS.muted}>{'Status'.padEnd(12)}</Text>
            <Text color={background.healthy ? COLORS.success : background.running ? COLORS.warning : COLORS.muted}>
              {background.healthy ? '✓ Running & Healthy' : background.running ? '⚠ Running (unhealthy)' : '✗ Not running'}
            </Text>
          </Box>
          {background.pid && (
            <Box>
              <Text color={COLORS.muted}>{'PID'.padEnd(12)}</Text>
              <Text color={COLORS.text}>{background.pid}</Text>
            </Box>
          )}
          {background.port && (
            <>
              <Box>
                <Text color={COLORS.muted}>{'Port'.padEnd(12)}</Text>
                <Text color={COLORS.text}>{background.port}</Text>
              </Box>
              <Box>
                <Text color={COLORS.muted}>{'Dashboard'.padEnd(12)}</Text>
                <Text color={COLORS.accent}>{background.dashboard}</Text>
              </Box>
              <Box>
                <Text color={COLORS.muted}>{'MCP'.padEnd(12)}</Text>
                <Text color={COLORS.accent}>{background.mcp}</Text>
              </Box>
            </>
          )}
          {background.startedAt && (
            <Box>
              <Text color={COLORS.muted}>{'Started'.padEnd(12)}</Text>
              <Text color={COLORS.text}>{background.startedAt}</Text>
            </Box>
          )}
          {background.agents != null && (
            <Box>
              <Text color={COLORS.muted}>{'Agents'.padEnd(12)}</Text>
              <Text color={COLORS.text}>{background.agents}</Text>
            </Box>
          )}
          {background.sessions != null && (
            <Box>
              <Text color={COLORS.muted}>{'Sessions'.padEnd(12)}</Text>
              <Text color={COLORS.text}>{background.sessions}</Text>
            </Box>
          )}
          {background.message && (
            <Box marginTop={1}>
              <Text color={COLORS.muted}>{background.message}</Text>
            </Box>
          )}

          {/* Action hints */}
          <Box marginTop={1} flexDirection="column">
            <Text color={COLORS.muted}>
              {background.running
                ? 'Use CLI: memorix background stop|restart|logs'
                : 'Use CLI: memorix background start'}
            </Text>
          </Box>
        </Box>
      )}
    </Box>
  );
}

// ── Dashboard View ─────────────────────────────────────────────

interface DashboardViewProps {
  background: BackgroundInfo;
}

export function DashboardView({ background }: DashboardViewProps): React.ReactElement {
  return (
    <Box flexDirection="column" paddingX={1}>
      <Text color={COLORS.accentDim} bold>Dashboard</Text>
      <Text color={COLORS.border}>{'─'.repeat(50)}</Text>

      {background.healthy && background.dashboard ? (
        <Box flexDirection="column">
          <Box>
            <Text color={COLORS.muted}>URL  </Text>
            <Text color={COLORS.accent} bold>{background.dashboard}</Text>
          </Box>
          <Box marginTop={1}>
            <Text color={COLORS.muted}>Open this URL in your browser to view the Memorix dashboard.</Text>
          </Box>
        </Box>
      ) : (
        <Box flexDirection="column">
          <Text color={COLORS.warning}>No running control plane detected.</Text>
          <Box marginTop={1}>
            <Text color={COLORS.muted}>Start one with: memorix background start</Text>
          </Box>
          <Text color={COLORS.muted}>Or run standalone: memorix dashboard</Text>
        </Box>
      )}
    </Box>
  );
}

// ── Status Message ─────────────────────────────────────────────

interface StatusMessageProps {
  message: string;
  type: 'success' | 'error' | 'info';
}

export function StatusMessage({ message, type }: StatusMessageProps): React.ReactElement {
  const color = type === 'success' ? COLORS.success : type === 'error' ? COLORS.error : COLORS.muted;
  const icon = type === 'success' ? '✓' : type === 'error' ? '✗' : '·';
  return (
    <Box paddingX={1}>
      <Text color={color}>{icon} {message}</Text>
    </Box>
  );
}
