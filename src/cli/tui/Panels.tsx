/**
 * Panels -- Content views for Memorix TUI
 *
 * All views use the same modern design language:
 * - Centered content, no fixed sidebar
 * - Clean spacing, no ASCII separator lines
 * - Action-first panels for dashboard/background
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
  HealthInfo,
} from './data.js';

// -- Source badge colors
const SRC: Record<string, string> = {
  git: '#5faf5f', agent: 'cyan', hook: '#d7af5f',
  session: '#af87d7', manual: '#5f87af', skill: '#87afaf', reasoning: '#af87af',
};

// -- Grouping for recent activity
interface GroupedItem extends MemoryItem { count: number; }
function groupRecent(items: MemoryItem[]): GroupedItem[] {
  if (!items.length) return [];
  const g: GroupedItem[] = [];
  let cur: GroupedItem = { ...items[0], count: 1 };
  for (let i = 1; i < items.length; i++) {
    const m = items[i];
    if ((cur.entityName && m.entityName && cur.entityName === m.entityName) ||
        cur.title.slice(0, 20) === m.title.slice(0, 20)) {
      cur.count++;
    } else { g.push(cur); cur = { ...m, count: 1 }; }
  }
  g.push(cur);
  return g;
}

// ================================================================
// Landing View -- OpenCode-inspired center-first launch surface
// ================================================================

interface LandingViewProps {
  recentMemories: MemoryItem[];
  highValueSignals: MemoryItem[];
  project: ProjectInfo | null;
  background: BackgroundInfo;
  health: { activeMemories: number; searchMode: string; embeddingProvider: string };
  loading: boolean;
}

// Brand mark -- small block text inspired by OpenCode's pixel logo
const BRAND_LINES = [
  ' __  __ ___ __  __  ___  ___ _____  __',
  '|  \\/  | __|  \\/  |/ _ \\| _ \\_ _\\ \\/ /',
  '| |\\/| | _|| |\\/| | (_) |   /| | >  < ',
  '|_|  |_|___|_|  |_|\\___/|_|_\\___|/_/\\_\\',
];

export function LandingView({ recentMemories, highValueSignals, project, background, health, loading }: LandingViewProps): React.ReactElement {
  return (
    <Box flexDirection="column" alignItems="center" justifyContent="center" flexGrow={1}>
      {/* Brand logo */}
      <Box flexDirection="column" alignItems="center" marginBottom={1}>
        {BRAND_LINES.map((line, i) => (
          <Text key={i} color={i < 2 ? COLORS.accent : COLORS.accentDim}>{line}</Text>
        ))}
      </Box>

      {/* Hint below command bar area */}
      <Box marginBottom={1}>
        <Text color={COLORS.muted}>Memory workbench for code and agents</Text>
      </Box>

      {/* Keyboard hints -- OpenCode style */}
      <Box gap={2} marginBottom={1}>
        <Text color={COLORS.muted}>tab</Text>
        <Text color={COLORS.textDim}>commands</Text>
        <Text color={COLORS.muted}>/doctor</Text>
        <Text color={COLORS.textDim}>diagnose</Text>
        <Text color={COLORS.muted}>/bg</Text>
        <Text color={COLORS.textDim}>control plane</Text>
      </Box>

      {/* Focus signals -- only 1-2, very compact */}
      {!loading && highValueSignals.length > 0 && (
        <Box flexDirection="column" alignItems="center" marginBottom={1}>
          {highValueSignals.slice(0, 2).map((m) => (
            <Box key={m.id}>
              <Text color={COLORS.warning}>{TYPE_ICONS[m.type] || '.'} </Text>
              <Text color={SRC[m.source] || COLORS.muted}>{(m.source || '?').padEnd(6)} </Text>
              <Text color={COLORS.text}>{m.title.slice(0, 50)}{m.title.length > 50 ? '...' : ''}</Text>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}

// ================================================================
// Search Results
// ================================================================

interface SearchResultsViewProps {
  results: SearchResult[];
  query: string;
  loading: boolean;
}

export function SearchResultsView({ results, query, loading }: SearchResultsViewProps): React.ReactElement {
  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Box marginBottom={1}>
        <Text color={COLORS.accent} bold>Search </Text>
        <Text color={COLORS.text}>"{query}"</Text>
        {!loading && <Text color={COLORS.muted}> -- {results.length} results</Text>}
      </Box>

      {loading ? (
        <Text color={COLORS.muted}>Searching...</Text>
      ) : results.length === 0 ? (
        <Box flexDirection="column" alignItems="center" paddingY={2}>
          <Text color={COLORS.muted}>No results found for "{query}"</Text>
          <Text color={COLORS.textDim}>Try different keywords or /help for commands</Text>
        </Box>
      ) : (
        results.map((r) => (
          <Box key={r.id} marginBottom={0}>
            <Text color={COLORS.muted}>{r.icon} </Text>
            <Text color={COLORS.textDim}>#{String(r.id).padEnd(4)} </Text>
            <Text color={COLORS.text}>{r.title.slice(0, 55)}{r.title.length > 55 ? '...' : ''}</Text>
            <Text color={COLORS.muted}> {(r.score * 100).toFixed(0)}%</Text>
          </Box>
        ))
      )}
    </Box>
  );
}

// ================================================================
// Doctor -- diagnostic cards
// ================================================================

interface DoctorViewProps {
  doctor: DoctorResult | null;
  health: HealthInfo;
  background: BackgroundInfo;
  project: ProjectInfo | null;
  loading: boolean;
}

const SI: Record<string, string> = { ok: '+', warn: '!', error: 'x', info: '.' };
const SC: Record<string, string> = { ok: COLORS.success, warn: COLORS.warning, error: COLORS.error, info: COLORS.textDim };

export function DoctorView({ doctor, health, background, project, loading }: DoctorViewProps): React.ReactElement {
  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Box marginBottom={1}>
        <Text color={COLORS.accent} bold>Diagnostics</Text>
        {project && <Text color={COLORS.muted}> -- {project.name}</Text>}
      </Box>

      {loading ? (
        <Text color={COLORS.muted}>Running diagnostics...</Text>
      ) : !doctor ? (
        <Text color={COLORS.warning}>Failed to run diagnostics.</Text>
      ) : (
        <Box flexDirection="column">
          {/* Quick status cards */}
          <Box marginBottom={1} gap={2}>
            <Box flexDirection="column">
              <Text color={COLORS.muted}>Memories</Text>
              <Text color={COLORS.text} bold>{health.activeMemories}</Text>
            </Box>
            <Box flexDirection="column">
              <Text color={COLORS.muted}>Search</Text>
              <Text color={health.searchMode.includes('hybrid') ? COLORS.success : COLORS.warning} bold>{health.searchMode}</Text>
            </Box>
            <Box flexDirection="column">
              <Text color={COLORS.muted}>Embed</Text>
              <Text color={health.embeddingProvider === 'ready' ? COLORS.success : COLORS.muted} bold>{health.embeddingProvider}</Text>
            </Box>
            <Box flexDirection="column">
              <Text color={COLORS.muted}>Background</Text>
              <Text color={background.healthy ? COLORS.success : COLORS.muted} bold>{background.healthy ? 'healthy' : background.running ? 'unhealthy' : 'stopped'}</Text>
            </Box>
          </Box>

          {/* Detailed diagnostics */}
          {doctor.sections.map((section, i) => (
            <Box key={i} flexDirection="column" marginBottom={1}>
              <Text color={COLORS.text} bold>{section.title}</Text>
              {section.items.map((item, j) => (
                <Box key={j}>
                  <Text color={SC[item.status] || COLORS.muted}>{SI[item.status] || '.'} </Text>
                  <Text color={COLORS.muted}>{item.label.padEnd(14)}</Text>
                  <Text color={COLORS.text}>{item.value}</Text>
                </Box>
              ))}
            </Box>
          ))}

          {/* Next actions */}
          <Box flexDirection="column">
            <Text color={COLORS.accentDim}>Next: /dashboard /background /search</Text>
          </Box>
        </Box>
      )}
    </Box>
  );
}

// ================================================================
// Project -- compact inspector
// ================================================================

interface ProjectViewProps {
  project: ProjectInfo | null;
  health: HealthInfo;
}

export function ProjectView({ project, health }: ProjectViewProps): React.ReactElement {
  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Box marginBottom={1}>
        <Text color={COLORS.accent} bold>Project</Text>
      </Box>

      {!project ? (
        <Text color={COLORS.warning}>No project detected. Run git init first.</Text>
      ) : (
        <Box flexDirection="column">
          {([
            ['Name', project.name],
            ['ID', project.id],
            ['Root', project.rootPath],
            ['Remote', project.gitRemote],
          ] as [string, string][]).map(([label, value]) => (
            <Box key={label}>
              <Text color={COLORS.muted}>{label.padEnd(8)}</Text>
              <Text color={COLORS.text}>{value}</Text>
            </Box>
          ))}
          <Box marginTop={1} gap={2}>
            <Box flexDirection="column">
              <Text color={COLORS.muted}>Memories</Text>
              <Text color={COLORS.text} bold>{health.activeMemories}</Text>
            </Box>
            <Box flexDirection="column">
              <Text color={COLORS.muted}>Search</Text>
              <Text color={COLORS.text} bold>{health.searchMode}</Text>
            </Box>
          </Box>
        </Box>
      )}
    </Box>
  );
}

// ================================================================
// Background -- action surface
// ================================================================

interface BackgroundViewProps {
  background: BackgroundInfo;
  loading: boolean;
}

export function BackgroundView({ background, loading }: BackgroundViewProps): React.ReactElement {
  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Box marginBottom={1}>
        <Text color={COLORS.accent} bold>Control Plane</Text>
      </Box>

      {loading ? (
        <Text color={COLORS.muted}>Checking...</Text>
      ) : (
        <Box flexDirection="column">
          {/* Status */}
          <Box marginBottom={1}>
            <Text color={background.healthy ? COLORS.success : background.running ? COLORS.warning : COLORS.muted} bold>
              {background.healthy ? '+ Running' : background.running ? '! Unhealthy' : 'x Stopped'}
            </Text>
          </Box>

          {/* Details */}
          {background.port && (
            <Box flexDirection="column" marginBottom={1}>
              <Box><Text color={COLORS.muted}>{'Port'.padEnd(10)}</Text><Text color={COLORS.text}>{background.port}</Text></Box>
              <Box><Text color={COLORS.muted}>{'Dashboard'.padEnd(10)}</Text><Text color={COLORS.accent}>{background.dashboard}</Text></Box>
              <Box><Text color={COLORS.muted}>{'MCP'.padEnd(10)}</Text><Text color={COLORS.accent}>{background.mcp}</Text></Box>
              {background.pid && <Box><Text color={COLORS.muted}>{'PID'.padEnd(10)}</Text><Text color={COLORS.text}>{background.pid}</Text></Box>}
            </Box>
          )}

          {/* Actions */}
          <Box flexDirection="column">
            <Text color={COLORS.accentDim} bold>Actions</Text>
            {background.running ? (
              <>
                <Text color={COLORS.text}>  memorix background restart</Text>
                <Text color={COLORS.text}>  memorix background stop</Text>
                <Text color={COLORS.text}>  memorix background logs</Text>
                {background.dashboard && <Text color={COLORS.accent}>  Open {background.dashboard}</Text>}
              </>
            ) : (
              <>
                <Text color={COLORS.success}>  memorix background start</Text>
                <Text color={COLORS.text}>  memorix dashboard  (standalone)</Text>
              </>
            )}
          </Box>
        </Box>
      )}
    </Box>
  );
}

// ================================================================
// Dashboard -- action surface
// ================================================================

interface DashboardViewProps {
  background: BackgroundInfo;
}

export function DashboardView({ background }: DashboardViewProps): React.ReactElement {
  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Box marginBottom={1}>
        <Text color={COLORS.accent} bold>Dashboard</Text>
      </Box>

      {background.healthy && background.dashboard ? (
        <Box flexDirection="column">
          <Box marginBottom={1}>
            <Text color={COLORS.accent} bold>{background.dashboard}</Text>
          </Box>
          <Text color={COLORS.accentDim} bold>Actions</Text>
          <Text color={COLORS.text}>  Open {background.dashboard} in browser</Text>
          <Text color={COLORS.text}>  memorix dashboard  (standalone)</Text>
        </Box>
      ) : (
        <Box flexDirection="column">
          <Box marginBottom={1}>
            <Text color={COLORS.warning}>No running control plane</Text>
          </Box>
          <Text color={COLORS.accentDim} bold>Actions</Text>
          <Text color={COLORS.success}>  memorix background start</Text>
          <Text color={COLORS.text}>  memorix dashboard  (standalone)</Text>
        </Box>
      )}
    </Box>
  );
}

// ================================================================
// Status Message
// ================================================================

interface StatusMessageProps {
  message: string;
  type: 'success' | 'error' | 'info';
}

export function StatusMessage({ message, type }: StatusMessageProps): React.ReactElement {
  const color = type === 'success' ? COLORS.success : type === 'error' ? COLORS.error : COLORS.muted;
  const icon = type === 'success' ? '+' : type === 'error' ? 'x' : '.';
  return (
    <Box paddingX={1}>
      <Text color={color}>{icon} {message}</Text>
    </Box>
  );
}
