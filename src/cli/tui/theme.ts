/**
 * Memorix TUI theme constants and slash commands.
 */

export interface SlashCommand {
  name: string;
  description: string;
  alias?: string;
  /** If true, this command exits Ink and runs an external interactive flow. */
  interactive?: boolean;
}

export const SLASH_COMMANDS: SlashCommand[] = [
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

export const TYPE_ICONS: Record<string, string> = {
  gotcha: '!',
  decision: 'D',
  'problem-solution': 'S',
  discovery: '?',
  'how-it-works': 'H',
  'what-changed': 'C',
  'trade-off': 'T',
  reasoning: 'R',
  'session-request': 'P',
  'why-it-exists': 'W',
};

export const COLORS = {
  accent: 'cyan',
  accentDim: '#5f8787',
  success: '#5faf5f',
  warning: '#d7af5f',
  error: '#af5f5f',
  muted: 'gray',
  text: 'white',
  textDim: '#808080',
  border: '#444444',
  highlight: '#3a3a3a',
  brand: 'cyan',
  bg: '#1a1a1a',
} as const;

export const BOX = {
  tl: '+', tr: '+', bl: '+', br: '+',
  h: '-', v: '|',
  lt: '+', rt: '+', tt: '+', bt: '+',
  cross: '+',
} as const;

export type ViewType =
  | 'home'
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
