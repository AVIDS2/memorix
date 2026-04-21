/**
 * Memorix TUI theme constants and slash commands.
 *
 * Modern design system: blue brand gradient, Unicode box-drawing,
 * status dots, and upgraded type icons.
 */

export interface SlashCommand {
  name: string;
  description: string;
  alias?: string;
  /** If true, this command exits Ink and runs an external interactive flow. */
  interactive?: boolean;
}

export const SLASH_COMMANDS: SlashCommand[] = [
  { name: '/chat',       description: 'Chat with project memory', alias: '/ask' },
  { name: '/clear',      description: 'Clear chat history',       alias: '/cc' },
  { name: '/resume',     description: 'Explicitly resume a saved chat thread', alias: '/cr' },
  { name: '/new',        description: 'Start new chat thread',     alias: '/cn' },
  { name: '/search',     description: 'Search memories',        alias: '/s' },
  { name: '/remember',   description: 'Store a quick memory',   alias: '/r' },
  { name: '/recent',     description: 'Recent memory activity', alias: '/v' },
  { name: '/doctor',     description: 'Run diagnostics',        alias: '/d' },
  { name: '/project',    description: 'Current project info',   alias: '/p' },
  { name: '/background', description: 'Control plane service',  alias: '/bg' },
  { name: '/dashboard',  description: 'Open web dashboard',     alias: '/dash' },
  { name: '/home',       description: 'Back to home',           alias: '/h' },
  { name: '/configure',  description: 'Settings',               alias: '/config' },
  { name: '/integrate',  description: 'Set up an IDE',          alias: '/setup' },
  { name: '/cleanup',    description: 'Cleanup and purge' },
  { name: '/ingest',     description: 'Git to Memory' },
  { name: '/help',       description: 'Show commands',          alias: '/?' },
  { name: '/exit',       description: 'Exit workbench',         alias: '/q' },
];

export const COMMAND_BAR_ROWS = 2;
export const COMMAND_PALETTE_CHROME_ROWS = 5;

export function getCommandPaletteHeight(itemCount: number): number {
  return itemCount > 0 ? COMMAND_PALETTE_CHROME_ROWS + itemCount : 0;
}

export function getCommandPaletteTop(termHeight: number, itemCount: number): number {
  const paletteHeight = getCommandPaletteHeight(itemCount);
  return paletteHeight > 0 ? Math.max(0, termHeight - COMMAND_BAR_ROWS - paletteHeight) : 0;
}

export function getHomeSeparatorWidth(contentWidth: number): number {
  return Math.max(0, Math.min(50, contentWidth - 8));
}

export function getStatusMessageRows(message: string): number {
  return Math.max(1, message.split('\n').length);
}

// ── Type icons: Unicode symbols for observation types ──────────────
export const TYPE_ICONS: Record<string, string> = {
  gotcha: '⚠',
  decision: '◆',
  'problem-solution': '✦',
  discovery: '◈',
  'how-it-works': '◉',
  'what-changed': '△',
  'trade-off': '⚖',
  reasoning: '◇',
  'session-request': '▸',
  'why-it-exists': '⊕',
};

// ── Color palette: blue brand gradient + Tailwind Slate dark theme ──
export const COLORS = {
  // Brand gradient (matches Memorix-Bridge logo blue tones)
  brand:      '#5EADF2',
  brandDim:   '#3B7AB8',
  brandBright:'#8ECBFF',

  // Accent
  accent:     '#7DD3FC',
  accentDim:  '#38BDF8',

  // Assistant identity (bright orange — stands out from blue brand)
  assistant:  '#FF9F43',

  // Semantic
  success:    '#4ADE80',
  warning:    '#FBBF24',
  error:      '#F87171',
  info:       '#94A3B8',

  // Text hierarchy (Tailwind Slate)
  text:       '#E2E8F0',
  textDim:    '#94A3B8',
  muted:      '#64748B',
  textBright: '#FFFFFF',

  // Surface & chrome
  border:     '#334155',
  surface:    '#1E293B',
  highlight:  '#475569',
  bg:         '#0F172A',
} as const;

// ── Status dots ─────────────────────────────────────────────────────
export const STATUS_DOTS: Record<string, string> = {
  ok:      '●',
  warn:    '◐',
  error:   '●',
  off:     '○',
  running: '●',
  stopped: '○',
};

// ── Unicode box-drawing characters (rounded) ────────────────────────
export const BOX = {
  tl: '╭', tr: '╮', bl: '╰', br: '╯',
  h: '─', v: '│',
  hBold: '━', vBold: '┃',
  lt: '╡', rt: '╞', tt: '╨', bt: '╥',
  cross: '┼',
} as const;

// ── Separator characters ────────────────────────────────────────────
export const SEP = {
  thin: '─',
  thick: '━',
  dot: '╌',
  dash: '╍',
} as const;

// ── Misc symbols ────────────────────────────────────────────────────
export const SYMBOLS = {
  bullet: '◆',
  arrow: '>',
  check: '✓',
  cross: '✗',
  info: 'ℹ',
  pill: (text: string) => `[${text}]`,
} as const;

export type ViewType =
  | 'home'
  | 'chat'
  | 'search'
  | 'doctor'
  | 'project'
  | 'background'
  | 'dashboard'
  | 'recent'
  | 'cleanup'
  | 'ingest'
  | 'integrate'
  | 'configure';

/** Compute responsive sidebar and content widths from terminal width.
 *  Shared between App.tsx and ChatView.tsx to avoid DRY drift. */
export function computeLayoutWidths(termWidth: number): { sidebarWidth: number; contentWidth: number; narrow: boolean; veryNarrow: boolean } {
  const narrow = termWidth < 80;
  const veryNarrow = termWidth < 60;
  const sidebarWidth = narrow ? (veryNarrow ? 0 : 24) : Math.min(40, Math.max(26, Math.floor(termWidth * 0.28)));
  const contentWidth = Math.max(0, narrow ? termWidth - 4 : termWidth - sidebarWidth - 4);
  return { sidebarWidth, contentWidth, narrow, veryNarrow };
}
