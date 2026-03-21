/**
 * Content views for the Memorix TUI.
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

function separator(width = 50): string {
  return '-'.repeat(width);
}

function truncate(text: string, max = 60): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}...`;
}

interface HomeViewProps {
  project: ProjectInfo | null;
  health: HealthInfo;
  background: BackgroundInfo;
  loading: boolean;
}

export function HomeView({ project, health, background }: HomeViewProps): React.ReactElement {
  return (
    <Box flexDirection="column" paddingX={1}>
      <Box flexDirection="column" marginBottom={1}>
        <Text color={COLORS.accentDim} bold>Project</Text>
        <Text color={COLORS.border}>{separator()}</Text>
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

      <Box flexDirection="column" marginBottom={1}>
        <Text color={COLORS.accentDim} bold>Status</Text>
        <Text color={COLORS.border}>{separator()}</Text>
        <Box>
          <Text color={COLORS.muted}>{'Memories'.padEnd(12)}</Text>
          <Text color={COLORS.text}>{health.activeMemories} active</Text>
        </Box>
        <Box>
          <Text color={COLORS.muted}>{'Embedding'.padEnd(12)}</Text>
          <Text
            color={
              health.embeddingProvider === 'ready'
                ? COLORS.success
                : health.embeddingProvider === 'unavailable'
                  ? COLORS.warning
                  : COLORS.muted
            }
          >
            {health.embeddingLabel}
          </Text>
        </Box>
        {health.embeddingProviderName && (
          <Box>
            <Text color={COLORS.muted}>{'Provider'.padEnd(12)}</Text>
            <Text color={COLORS.textDim}>{health.embeddingProviderName}</Text>
          </Box>
        )}
        <Box>
          <Text color={COLORS.muted}>{'Search Mode'.padEnd(12)}</Text>
          <Text color={health.searchModeLabel.toLowerCase().includes('hybrid') ? COLORS.success : COLORS.warning}>
            {health.searchModeLabel}
          </Text>
        </Box>
        {health.searchDiagnostic && (
          <Box>
            <Text color={COLORS.muted}>{''.padEnd(12)}</Text>
            <Text color={COLORS.textDim}>{health.searchDiagnostic}</Text>
          </Box>
        )}
        <Box>
          <Text color={COLORS.muted}>{'Background'.padEnd(12)}</Text>
          <Text color={background.healthy ? COLORS.success : background.running ? COLORS.warning : COLORS.muted}>
            {background.healthy ? 'Running' : background.running ? 'Unhealthy' : 'Stopped'}
          </Text>
          {background.port && <Text color={COLORS.textDim}> :{background.port}</Text>}
        </Box>
      </Box>

      <Text color={COLORS.muted}>Use /recent to view recent memory activity</Text>
    </Box>
  );
}

interface RecentViewProps {
  recentMemories: MemoryItem[];
  loading: boolean;
}

const DEV_NOISE_PATTERNS = [
  /^Revert\s+"feat:/i,
  /^Revert\s+"fix:/i,
  /^fix:.*TUI/i,
  /^feat:.*TUI.*moderniz/i,
  /^feat:.*center-first/i,
  /^feat:.*full TUI/i,
];

export function RecentView({ recentMemories, loading }: RecentViewProps): React.ReactElement {
  const filtered = recentMemories.filter((memory) => !DEV_NOISE_PATTERNS.some((pattern) => pattern.test(memory.title)));

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text color={COLORS.accentDim} bold>Recent Memory Activity</Text>
      <Text color={COLORS.border}>{separator()}</Text>
      {loading ? (
        <Text color={COLORS.muted}>Loading...</Text>
      ) : filtered.length === 0 ? (
        <Text color={COLORS.muted}>No recent activity. Use /remember to store a memory.</Text>
      ) : (
        filtered.map((memory) => (
          <Box key={memory.id}>
            <Text color={COLORS.muted}>[{TYPE_ICONS[memory.type] || '.'}] </Text>
            <Text color={COLORS.textDim}>#{memory.id} </Text>
            <Text color={COLORS.text}>{truncate(memory.title)}</Text>
          </Box>
        ))
      )}
      {filtered.length < recentMemories.length && (
        <Text color={COLORS.textDim}>({recentMemories.length - filtered.length} dev/noise entries hidden)</Text>
      )}
    </Box>
  );
}

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
        {!loading && <Text color={COLORS.muted}> - {results.length} results</Text>}
      </Box>
      <Text color={COLORS.border}>{separator()}</Text>

      {loading ? (
        <Text color={COLORS.muted}>Searching...</Text>
      ) : results.length === 0 ? (
        <Text color={COLORS.muted}>No results found.</Text>
      ) : (
        results.map((result) => (
          <Box key={result.id}>
            <Text color={COLORS.muted}>[{result.icon}] </Text>
            <Text color={COLORS.textDim}>#{result.id} </Text>
            <Text color={COLORS.text}>{truncate(result.title)}</Text>
            <Text color={COLORS.muted}> ({(result.score * 100).toFixed(0)}%)</Text>
          </Box>
        ))
      )}
    </Box>
  );
}

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
  ok: '+',
  warn: '!',
  error: 'x',
  info: '-',
};

export function DoctorView({ doctor, loading }: DoctorViewProps): React.ReactElement {
  return (
    <Box flexDirection="column" paddingX={1}>
      <Text color={COLORS.accentDim} bold>Diagnostics</Text>
      <Text color={COLORS.border}>{separator()}</Text>

      {loading ? (
        <Text color={COLORS.muted}>Running diagnostics...</Text>
      ) : !doctor ? (
        <Text color={COLORS.warning}>Failed to run diagnostics.</Text>
      ) : (
        <Box flexDirection="column">
          {doctor.sections.map((section, index) => (
            <Box key={index} flexDirection="column" marginBottom={1}>
              <Text color={COLORS.text} bold>{section.title}</Text>
              {section.items.map((item, itemIndex) => (
                <Box key={itemIndex}>
                  <Text color={STATUS_COLORS[item.status] || COLORS.muted}>
                    {STATUS_ICONS[item.status] || '.'}{' '}
                  </Text>
                  <Text color={COLORS.muted}>{item.label.padEnd(12)}</Text>
                  <Text color={COLORS.text}>{item.value}</Text>
                </Box>
              ))}
            </Box>
          ))}

          <Box marginTop={1} flexDirection="column">
            <Text color={COLORS.accentDim} bold>Next</Text>
            <Text color={COLORS.muted}>  /dashboard  /background  /search  /recent</Text>
          </Box>
        </Box>
      )}
    </Box>
  );
}

interface ProjectViewProps {
  project: ProjectInfo | null;
}

export function ProjectView({ project }: ProjectViewProps): React.ReactElement {
  return (
    <Box flexDirection="column" paddingX={1}>
      <Text color={COLORS.accentDim} bold>Project Details</Text>
      <Text color={COLORS.border}>{separator()}</Text>

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

interface BackgroundViewProps {
  background: BackgroundInfo;
  loading: boolean;
}

export function BackgroundView({ background, loading }: BackgroundViewProps): React.ReactElement {
  return (
    <Box flexDirection="column" paddingX={1}>
      <Text color={COLORS.accentDim} bold>Background Control Plane</Text>
      <Text color={COLORS.border}>{separator()}</Text>

      {loading ? (
        <Text color={COLORS.muted}>Checking status...</Text>
      ) : (
        <Box flexDirection="column">
          <Box>
            <Text color={COLORS.muted}>{'Status'.padEnd(12)}</Text>
            <Text color={background.healthy ? COLORS.success : background.running ? COLORS.warning : COLORS.muted}>
              {background.healthy ? 'Running & healthy' : background.running ? 'Running (unhealthy)' : 'Not running'}
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

          <Box marginTop={1} flexDirection="column">
            <Text color={COLORS.accentDim} bold>Actions</Text>
            <Text color={COLORS.border}>{separator()}</Text>
            {background.running ? (
              <Box flexDirection="column">
                {background.dashboard && (
                  <Box>
                    <Text color={COLORS.accent}>  w  Open dashboard  </Text>
                    <Text color={COLORS.textDim}>{background.dashboard}</Text>
                  </Box>
                )}
                <Box><Text color={COLORS.text}>  1  Restart control plane</Text></Box>
                <Box><Text color={COLORS.text}>  2  Stop control plane</Text></Box>
                <Box><Text color={COLORS.text}>  3  View logs</Text></Box>
                {background.mcp && (
                  <Box><Text color={COLORS.muted}>  MCP: {background.mcp}</Text></Box>
                )}
              </Box>
            ) : (
              <Box flexDirection="column">
                <Box><Text color={COLORS.success}>  1  Start control plane</Text></Box>
                <Box><Text color={COLORS.text}>  2  Launch standalone dashboard</Text></Box>
              </Box>
            )}
          </Box>
        </Box>
      )}
    </Box>
  );
}

interface DashboardViewProps {
  background: BackgroundInfo;
}

export function DashboardView({ background }: DashboardViewProps): React.ReactElement {
  return (
    <Box flexDirection="column" paddingX={1}>
      <Text color={COLORS.accentDim} bold>Dashboard</Text>
      <Text color={COLORS.border}>{separator()}</Text>

      {background.healthy && background.dashboard ? (
        <Box flexDirection="column">
          <Box marginBottom={1}>
            <Text color={COLORS.muted}>{'URL'.padEnd(12)}</Text>
            <Text color={COLORS.accent} bold>{background.dashboard}</Text>
          </Box>
          <Text color={COLORS.accentDim} bold>Actions</Text>
          <Text color={COLORS.border}>{separator()}</Text>
          <Box><Text color={COLORS.accent}>  1  Open {background.dashboard} in browser</Text></Box>
          <Box><Text color={COLORS.text}>  2  Launch standalone dashboard</Text></Box>
        </Box>
      ) : (
        <Box flexDirection="column">
          <Box marginBottom={1}>
            <Text color={COLORS.warning}>No running control plane</Text>
          </Box>
          <Text color={COLORS.accentDim} bold>Actions</Text>
          <Text color={COLORS.border}>{separator()}</Text>
          <Box>
            <Text color={COLORS.success}>  1  Start control plane  </Text>
            <Text color={COLORS.muted}>(then open dashboard)</Text>
          </Box>
          <Box><Text color={COLORS.text}>  2  Launch standalone dashboard</Text></Box>
        </Box>
      )}
    </Box>
  );
}

interface CleanupViewProps {
  onAction: (action: string) => void;
  statusText: string;
}

export function CleanupView({ statusText }: CleanupViewProps): React.ReactElement {
  return (
    <Box flexDirection="column" paddingX={1}>
      <Text color={COLORS.accentDim} bold>Cleanup & Purge</Text>
      <Text color={COLORS.border}>{separator()}</Text>
      <Box flexDirection="column" marginTop={1}>
        <Box><Text color={COLORS.text}>  1  Uninstall project artifacts</Text></Box>
        <Box><Text color={COLORS.text}>  2  Purge current project memory</Text></Box>
        <Box><Text color={COLORS.warning}>  3  Purge ALL memory (danger)</Text></Box>
        <Box><Text color={COLORS.muted}>  h  Back to home</Text></Box>
      </Box>
      {statusText && (
        <Box marginTop={1}><Text color={COLORS.muted}>{statusText}</Text></Box>
      )}
    </Box>
  );
}

interface IngestViewProps {
  onAction: (action: string) => void;
  statusText: string;
}

export function IngestView({ statusText }: IngestViewProps): React.ReactElement {
  return (
    <Box flexDirection="column" paddingX={1}>
      <Text color={COLORS.accentDim} bold>Git &gt; Memory</Text>
      <Text color={COLORS.border}>{separator()}</Text>
      <Box flexDirection="column" marginTop={1}>
        <Box><Text color={COLORS.text}>  1  Ingest latest commit</Text></Box>
        <Box><Text color={COLORS.text}>  2  Batch ingest recent git log</Text></Box>
        <Box><Text color={COLORS.text}>  3  Install post-commit hook</Text></Box>
        <Box><Text color={COLORS.text}>  4  Uninstall post-commit hook</Text></Box>
        <Box><Text color={COLORS.muted}>  h  Back to home</Text></Box>
      </Box>
      {statusText && (
        <Box marginTop={1}><Text color={COLORS.muted}>{statusText}</Text></Box>
      )}
    </Box>
  );
}

interface IntegrateViewProps {
  statusText: string;
}

export function IntegrateView({ statusText }: IntegrateViewProps): React.ReactElement {
  return (
    <Box flexDirection="column" paddingX={1}>
      <Text color={COLORS.accentDim} bold>Integrate IDE</Text>
      <Text color={COLORS.border}>{separator()}</Text>
      <Box flexDirection="column" marginTop={1}>
        <Box><Text color={COLORS.text}>  1  Claude Code</Text></Box>
        <Box><Text color={COLORS.text}>  2  Windsurf</Text></Box>
        <Box><Text color={COLORS.text}>  3  Cursor</Text></Box>
        <Box><Text color={COLORS.text}>  4  GitHub Copilot</Text></Box>
        <Box><Text color={COLORS.text}>  5  Kiro</Text></Box>
        <Box><Text color={COLORS.text}>  6  Codex</Text></Box>
        <Box><Text color={COLORS.text}>  7  Antigravity</Text></Box>
        <Box><Text color={COLORS.text}>  8  OpenCode</Text></Box>
        <Box><Text color={COLORS.text}>  9  Trae</Text></Box>
        <Box><Text color={COLORS.muted}>  h  Back to home</Text></Box>
      </Box>
      <Box marginTop={1}>
        <Text color={COLORS.textDim}>Installs only for the current project.</Text>
      </Box>
      {statusText && (
        <Box marginTop={1}><Text color={COLORS.muted}>{statusText}</Text></Box>
      )}
    </Box>
  );
}

interface StatusMessageProps {
  message: string;
  type: 'success' | 'error' | 'info';
}

export function StatusMessage({ message, type }: StatusMessageProps): React.ReactElement {
  const color = type === 'success' ? COLORS.success : type === 'error' ? COLORS.error : COLORS.muted;
  const icon = type === 'success' ? '+' : type === 'error' ? 'x' : 'i';
  return (
    <Box paddingX={1}>
      <Text color={color}>{icon} {message}</Text>
    </Box>
  );
}
