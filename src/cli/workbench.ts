/**
 * Memorix Workbench — Fullscreen Terminal UI
 *
 * A terminal-native workbench that takes over the entire screen,
 * inspired by opencode's clean TUI design.
 *
 * Features:
 * - Alternate screen buffer (no shell prompt visible)
 * - Real-time keystroke handling with raw mode
 * - Slash command autocomplete popup on '/'
 * - Persistent header with project/mode/health status
 * - Clean exit restoring original terminal state
 */

import { createRequire } from 'node:module';
import * as readline from 'node:readline';

const require = createRequire(import.meta.url);
const pkg = require('../../package.json') as { version: string };

// ── ANSI Escape Codes ──────────────────────────────────────────
const ESC = '\x1b';
const CSI = `${ESC}[`;
const ALT_SCREEN_ON = `${CSI}?1049h`;
const ALT_SCREEN_OFF = `${CSI}?1049l`;
const CURSOR_HIDE = `${CSI}?25l`;
const CURSOR_SHOW = `${CSI}?25h`;
const CLEAR_SCREEN = `${CSI}2J${CSI}H`;
const CLEAR_LINE = `${CSI}2K`;

const moveTo = (row: number, col: number) => `${CSI}${row};${col}H`;
const DIM = `${CSI}2m`;
const BOLD = `${CSI}1m`;
const RESET = `${CSI}0m`;
const CYAN = `${CSI}36m`;
const GREEN = `${CSI}32m`;
const YELLOW = `${CSI}33m`;
const BLUE = `${CSI}34m`;
const WHITE = `${CSI}37m`;
const BG_DARK = `${CSI}48;5;236m`;
const BG_HIGHLIGHT = `${CSI}48;5;238m`;
const BG_RESET = `${CSI}49m`;
const INVERSE = `${CSI}7m`;

// ── Slash Commands ─────────────────────────────────────────────
interface SlashCommand {
  name: string;
  description: string;
  alias?: string;
}

const SLASH_COMMANDS: SlashCommand[] = [
  { name: '/search', description: 'Search memories', alias: '/s' },
  { name: '/remember', description: 'Store a quick memory', alias: '/r' },
  { name: '/recent', description: 'View recent memories' },
  { name: '/doctor', description: 'System diagnostics' },
  { name: '/project', description: 'Project details' },
  { name: '/background', description: 'Background service', alias: '/bg' },
  { name: '/dashboard', description: 'Open dashboard', alias: '/dash' },
  { name: '/configure', description: 'Settings', alias: '/config' },
  { name: '/integrate', description: 'Set up an IDE' },
  { name: '/help', description: 'Show all commands' },
  { name: '/exit', description: 'Exit workbench', alias: '/q' },
];

// ── State ──────────────────────────────────────────────────────
interface WorkbenchState {
  input: string;
  cursorPos: number;
  showSlashMenu: boolean;
  slashMenuIndex: number;
  filteredCommands: SlashCommand[];
  outputLines: string[];
  headerLines: string[];
  running: boolean;
  statusLine: string;
  _headerInfo: HeaderInfo;
}

// ── ASCII Art Logo ─────────────────────────────────────────────
const LOGO_LINES = [
  ' _____ _____ _____ _____ _____ _____ __ __',
  '|     |   __|     |     | __  |     |  |  |',
  '| | | |   __| | | |  |  |    -|-   -|_   _|',
  '|_|_|_|_____|_|_|_|_____|__|__|_____|_|___|',
];
const LOGO_WIDTH = 44;

// ── Header Detection ───────────────────────────────────────────
interface HeaderInfo {
  projectName: string;
  projectId: string;
  mode: string;
  modeDetail: string;
  search: string;
  memCount: string;
}

async function detectHeaderInfo(): Promise<HeaderInfo> {
  const info: HeaderInfo = {
    projectName: '', projectId: '', mode: 'CLI', modeDetail: '',
    search: 'BM25', memCount: '--',
  };

  try {
    const { detectProject } = await import('../project/detector.js');
    const proj = detectProject(process.cwd());
    if (proj) {
      info.projectName = proj.name;
      info.projectId = proj.id;
    }
  } catch { /* ignore */ }

  try {
    const { existsSync, readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { homedir } = await import('node:os');
    const bgPath = join(homedir(), '.memorix', 'background.json');
    if (existsSync(bgPath)) {
      const bg = JSON.parse(readFileSync(bgPath, 'utf-8'));
      try { process.kill(bg.pid, 0); info.mode = 'Background'; info.modeDetail = `port ${bg.port}`; } catch { /* dead */ }
    }
  } catch { /* ignore */ }

  try {
    const { getEmbeddingMode } = await import('../config.js');
    if (getEmbeddingMode() !== 'off') info.search = 'Hybrid';
  } catch { /* ignore */ }

  if (info.projectName) {
    try {
      const { getProjectDataDir, loadObservationsJson } = await import('../store/persistence.js');
      const dataDir = await getProjectDataDir(info.projectId);
      const { existsSync } = await import('node:fs');
      const { join } = await import('node:path');
      if (existsSync(join(dataDir, 'observations.json'))) {
        const obs = await loadObservationsJson(dataDir) as any[];
        const active = obs.filter((o: any) => (o.status ?? 'active') === 'active').length;
        info.memCount = String(active);
      }
    } catch { /* ignore */ }
  }

  return info;
}

// ── Centered text helper ───────────────────────────────────────
function centerText(text: string, width: number, visibleLen?: number): string {
  const len = visibleLen ?? text.length;
  const pad = Math.max(0, Math.floor((width - len) / 2));
  return ' '.repeat(pad) + text;
}

// ── Rendering ──────────────────────────────────────────────────
function render(state: WorkbenchState): void {
  const W = process.stdout.columns || 80;
  const H = process.stdout.rows || 24;
  const contentW = Math.min(W, 80);
  const marginL = Math.max(1, Math.floor((W - contentW) / 2));
  const pad = (s: string) => ' '.repeat(marginL) + s;
  let out = CLEAR_SCREEN;

  // ── Logo (centered, top third) ──
  const logoStart = Math.max(2, Math.floor(H * 0.15));
  for (let i = 0; i < LOGO_LINES.length; i++) {
    out += moveTo(logoStart + i, 1) + centerText(`${BOLD}${CYAN}${LOGO_LINES[i]}${RESET}`, W, LOGO_WIDTH);
  }

  // ── Subtitle + status badges (below logo, centered) ──
  const badgeRow = logoStart + LOGO_LINES.length + 1;
  const info = state._headerInfo;

  // Project badge
  const projBadge = info.projectName
    ? `${WHITE}${info.projectName}${RESET}`
    : `${DIM}no project${RESET}`;
  // Mode badge
  const modeBadge = info.mode === 'Background'
    ? `${GREEN}${info.mode}${RESET} ${DIM}${info.modeDetail}${RESET}`
    : `${DIM}${info.mode}${RESET}`;
  // Search badge
  const searchBadge = info.search === 'Hybrid'
    ? `${CYAN}${info.search}${RESET}`
    : `${DIM}${info.search}${RESET}`;
  // Memory badge
  const memBadge = info.memCount !== '--'
    ? `${WHITE}${info.memCount}${RESET} ${DIM}memories${RESET}`
    : `${DIM}-- memories${RESET}`;

  const statusLine = `${projBadge}  ${DIM}·${RESET}  ${modeBadge}  ${DIM}·${RESET}  ${searchBadge}  ${DIM}·${RESET}  ${memBadge}`;
  const statusVisLen = (info.projectName || 'no project').length + 3 + info.mode.length + (info.modeDetail ? 1 + info.modeDetail.length : 0) + 3 + info.search.length + 3 + (info.memCount !== '--' ? info.memCount.length + 9 : 12);
  out += moveTo(badgeRow, 1) + centerText(statusLine, W, statusVisLen);

  // ── Input box (centered, with left accent border) ──
  const inputRow = badgeRow + 3;
  const boxW = Math.min(contentW - 4, 68);
  const boxL = Math.max(1, Math.floor((W - boxW) / 2));
  const inputDisplay = state.input || '';
  const placeholder = !inputDisplay ? `${DIM}Search memories or type / for commands${RESET}` : '';
  const inputContent = `${placeholder}${WHITE}${inputDisplay}${RESET}`;

  // Top border with accent
  out += moveTo(inputRow, boxL) + `${CYAN}┌${DIM}${'─'.repeat(boxW - 2)}${CYAN}┐${RESET}`;
  // Input line
  out += moveTo(inputRow + 1, boxL) + `${CYAN}│${RESET} ${inputContent}`;
  // Fill rest of box width
  out += moveTo(inputRow + 1, boxL + boxW - 1) + `${DIM}│${RESET}`;
  // Bottom border
  out += moveTo(inputRow + 2, boxL) + `${CYAN}└${DIM}${'─'.repeat(boxW - 2)}${CYAN}┘${RESET}`;

  // ── Slash command popup (below input box, aligned) ──
  if (state.showSlashMenu && state.filteredCommands.length > 0) {
    const menuRow = inputRow + 3;
    const cmds = state.filteredCommands;
    const maxVisible = Math.min(cmds.length, H - menuRow - 3);
    const menuW = Math.min(boxW, 56);
    const menuL = boxL;

    for (let i = 0; i < maxVisible; i++) {
      const cmd = cmds[i];
      const isSelected = i === state.slashMenuIndex;
      const nameStr = `${isSelected ? YELLOW : CYAN}${cmd.name.padEnd(16)}${RESET}`;
      const descStr = `${DIM}${cmd.description}${RESET}`;
      const bg = isSelected ? BG_HIGHLIGHT : '';
      const bgEnd = isSelected ? BG_RESET : '';
      const lineContent = `${bg} ${nameStr} ${descStr}`;
      const fillLen = Math.max(0, menuW - cmd.name.length - cmd.description.length - 20);
      out += moveTo(menuRow + i, menuL) + `${lineContent}${' '.repeat(fillLen)}${bgEnd}`;
    }
  }

  // ── Keyboard hints (centered, below input) ──
  const hintRow = state.showSlashMenu
    ? inputRow + 4 + Math.min(state.filteredCommands.length, H - inputRow - 7)
    : inputRow + 4;

  const hints = `${DIM}/ commands${RESET}    ${DIM}esc clear${RESET}    ${DIM}ctrl+c exit${RESET}`;
  out += moveTo(hintRow, 1) + centerText(hints, W, 38);

  // ── Output area (below hints) ──
  const outputStart = hintRow + 2;
  const maxOutputLines = Math.max(0, H - outputStart - 2);
  const visibleOutput = state.outputLines.slice(-maxOutputLines);
  for (let i = 0; i < visibleOutput.length; i++) {
    out += moveTo(outputStart + i, boxL) + visibleOutput[i];
  }

  // ── Bottom bar ──
  const verStr = `${DIM}v${pkg.version}${RESET}`;
  out += moveTo(H, W - pkg.version.length - 2) + verStr;

  // Position cursor inside the input box
  out += moveTo(inputRow + 1, boxL + 2 + state.cursorPos);
  out += CURSOR_SHOW;

  process.stdout.write(out);
}

// ── Command Execution ──────────────────────────────────────────
async function executeCommand(state: WorkbenchState, input: string): Promise<void> {
  const raw = input.trim();
  if (!raw) return;

  if (raw.startsWith('/')) {
    const parts = raw.slice(1).split(/\s+/);
    const cmd = parts[0]?.toLowerCase();
    const arg = parts.slice(1).join(' ');

    switch (cmd) {
      case 'search':
      case 's':
        if (arg) {
          await doSearch(state, arg);
        } else {
          state.outputLines.push(`${YELLOW}Usage: /search <query>${RESET}`);
        }
        break;
      case 'remember':
      case 'r':
        if (arg) {
          await doRemember(state, arg);
        } else {
          state.outputLines.push(`${YELLOW}Usage: /remember <text>${RESET}`);
        }
        break;
      case 'recent':
        await doRecent(state);
        break;
      case 'doctor':
        state.outputLines.push(`${DIM}Running diagnostics...${RESET}`);
        render(state);
        await doDoctor(state);
        break;
      case 'project':
      case 'status':
        await doProject(state);
        break;
      case 'background':
      case 'bg':
        state.outputLines.push(`${DIM}Use CLI: memorix background start|stop|status|restart${RESET}`);
        break;
      case 'dashboard':
      case 'dash':
        state.outputLines.push(`${DIM}Use CLI: memorix dashboard${RESET}`);
        break;
      case 'configure':
      case 'config':
        state.outputLines.push(`${DIM}Use CLI: memorix configure${RESET}`);
        break;
      case 'integrate':
      case 'setup':
        state.outputLines.push(`${DIM}Use CLI: memorix integrate${RESET}`);
        break;
      case 'help':
      case '?':
        for (const c of SLASH_COMMANDS) {
          state.outputLines.push(`  ${CYAN}${c.name.padEnd(16)}${RESET}${DIM}${c.description}${c.alias ? ` (${c.alias})` : ''}${RESET}`);
        }
        break;
      case 'exit':
      case 'quit':
      case 'q':
        state.running = false;
        break;
      default:
        state.outputLines.push(`${YELLOW}Unknown command: /${cmd}${RESET} ${DIM}Type /help for available commands${RESET}`);
    }
  } else {
    // Default: search
    await doSearch(state, raw);
  }
}

async function doSearch(state: WorkbenchState, query: string): Promise<void> {
  state.outputLines.push(`${DIM}Searching: "${query}"...${RESET}`);
  render(state);

  try {
    const { searchObservations, getDb } = await import('../store/orama-store.js');
    const { getProjectDataDir } = await import('../store/persistence.js');
    const { detectProject } = await import('../project/detector.js');
    const { initObservations } = await import('../memory/observations.js');

    const proj = detectProject(process.cwd());
    if (!proj) { state.outputLines.push(`${YELLOW}No project detected. Run git init first.${RESET}`); return; }
    const dataDir = await getProjectDataDir(proj.id);
    await initObservations(dataDir);
    await getDb();

    const results = await searchObservations({ query, limit: 8, projectId: proj.id });
    state.outputLines.pop(); // Remove "Searching..."

    if (results.length === 0) {
      state.outputLines.push(`${DIM}No results for "${query}"${RESET}`);
      return;
    }

    state.outputLines.push(`${GREEN}${results.length} results${RESET} ${DIM}for "${query}"${RESET}`);
    for (const r of results) {
      state.outputLines.push(`  ${r.icon} ${DIM}#${r.id}${RESET} ${WHITE}${r.title.slice(0, 70)}${RESET}`);
    }
  } catch (err) {
    state.outputLines.push(`${YELLOW}Search error: ${err instanceof Error ? err.message : err}${RESET}`);
  }
}

async function doRemember(state: WorkbenchState, text: string): Promise<void> {
  try {
    const { detectProject } = await import('../project/detector.js');
    const { getProjectDataDir } = await import('../store/persistence.js');
    const { initObservations, storeObservation } = await import('../memory/observations.js');

    const proj = detectProject(process.cwd());
    if (!proj) { state.outputLines.push(`${YELLOW}No project detected.${RESET}`); return; }
    const dataDir = await getProjectDataDir(proj.id);
    await initObservations(dataDir);

    const result = await storeObservation({
      entityName: 'quick-note', type: 'discovery',
      title: text.slice(0, 100), narrative: text, facts: [], projectId: proj.id,
    });

    state.outputLines.push(`${GREEN}Stored${RESET} #${result.observation.id}: ${text.slice(0, 60)}${text.length > 60 ? '...' : ''}`);
  } catch (err) {
    state.outputLines.push(`${YELLOW}Store error: ${err instanceof Error ? err.message : err}${RESET}`);
  }
}

async function doRecent(state: WorkbenchState): Promise<void> {
  try {
    const { detectProject } = await import('../project/detector.js');
    const { getProjectDataDir, loadObservationsJson } = await import('../store/persistence.js');

    const proj = detectProject(process.cwd());
    if (!proj) { state.outputLines.push(`${YELLOW}No project detected.${RESET}`); return; }
    const dataDir = await getProjectDataDir(proj.id);
    const obs = await loadObservationsJson(dataDir) as any[];
    const active = obs.filter((o: any) => (o.status ?? 'active') === 'active');
    const recent = active.slice(-8).reverse();

    if (recent.length === 0) {
      state.outputLines.push(`${DIM}No memories yet.${RESET}`);
      return;
    }

    const typeIcons: Record<string, string> = {
      gotcha: '!', decision: 'D', 'problem-solution': 'S', discovery: '?',
      'how-it-works': 'H', 'what-changed': 'C', 'trade-off': 'T', reasoning: 'R',
    };

    state.outputLines.push(`${GREEN}Recent memories${RESET} ${DIM}(${active.length} active)${RESET}`);
    for (const o of recent) {
      const icon = typeIcons[o.type] || '.';
      state.outputLines.push(`  ${DIM}[${icon}]${RESET} ${DIM}#${o.id}${RESET} ${WHITE}${(o.title || '').slice(0, 65)}${RESET}`);
    }
  } catch (err) {
    state.outputLines.push(`${YELLOW}Error: ${err instanceof Error ? err.message : err}${RESET}`);
  }
}

async function doDoctor(state: WorkbenchState): Promise<void> {
  try {
    const m = await import('./commands/doctor.js');
    // Capture doctor output
    const origLog = console.log;
    const captured: string[] = [];
    console.log = (...args: any[]) => captured.push(args.join(' '));
    await m.default.run?.({ args: { _: [], json: false }, rawArgs: [], cmd: m.default } as any);
    console.log = origLog;
    for (const line of captured) {
      if (line.trim()) state.outputLines.push(line);
    }
  } catch (err) {
    state.outputLines.push(`${YELLOW}Doctor error: ${err instanceof Error ? err.message : err}${RESET}`);
  }
}

async function doProject(state: WorkbenchState): Promise<void> {
  try {
    const { detectProject } = await import('../project/detector.js');
    const { getProjectDataDir } = await import('../store/persistence.js');
    const proj = detectProject(process.cwd());
    if (!proj) { state.outputLines.push(`${YELLOW}No project detected.${RESET}`); return; }
    const dataDir = await getProjectDataDir(proj.id);
    state.outputLines.push(`${GREEN}Project${RESET}`);
    state.outputLines.push(`  ${DIM}Name:${RESET}    ${WHITE}${proj.name}${RESET}`);
    state.outputLines.push(`  ${DIM}ID:${RESET}      ${WHITE}${proj.id}${RESET}`);
    state.outputLines.push(`  ${DIM}Root:${RESET}    ${WHITE}${proj.rootPath}${RESET}`);
    state.outputLines.push(`  ${DIM}Remote:${RESET}  ${WHITE}${proj.gitRemote || 'none'}${RESET}`);
    state.outputLines.push(`  ${DIM}Data:${RESET}    ${WHITE}${dataDir}${RESET}`);
  } catch (err) {
    state.outputLines.push(`${YELLOW}Error: ${err instanceof Error ? err.message : err}${RESET}`);
  }
}

// ── Main Entry ─────────────────────────────────────────────────
export async function startWorkbench(): Promise<void> {
  // Enter alternate screen
  process.stdout.write(ALT_SCREEN_ON + CURSOR_HIDE + CLEAR_SCREEN);

  // Enable raw mode
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }
  process.stdin.resume();

  const defaultInfo: HeaderInfo = { projectName: '', projectId: '', mode: 'CLI', modeDetail: '', search: 'BM25', memCount: '--' };
  const state: WorkbenchState = {
    input: '',
    cursorPos: 0,
    showSlashMenu: false,
    slashMenuIndex: 0,
    filteredCommands: [],
    outputLines: [],
    headerLines: [],
    running: true,
    statusLine: '',
    _headerInfo: defaultInfo,
  };

  // Detect header info
  try {
    state._headerInfo = await detectHeaderInfo();
  } catch { /* use defaults */ }

  // Clean exit handler
  const cleanup = () => {
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    process.stdout.write(CURSOR_SHOW + ALT_SCREEN_OFF);
  };

  process.on('exit', cleanup);
  process.on('SIGINT', () => { cleanup(); process.exit(0); });
  process.on('SIGTERM', () => { cleanup(); process.exit(0); });

  // Handle terminal resize
  process.stdout.on('resize', () => render(state));

  // Initial render
  render(state);

  // Input loop
  return new Promise<void>((resolve) => {
    process.stdin.on('data', async (data: Buffer) => {
      if (!state.running) return;

      const key = data.toString('utf-8');
      const code = data[0];

      // Ctrl+C — exit
      if (code === 3) {
        state.running = false;
        cleanup();
        process.exit(0);
      }

      // Escape — clear input or close menu
      if (code === 27 && data.length === 1) {
        if (state.showSlashMenu) {
          state.showSlashMenu = false;
        } else {
          state.input = '';
          state.cursorPos = 0;
          state.outputLines = [];
        }
        render(state);
        return;
      }

      // Arrow keys in slash menu
      if (state.showSlashMenu && data.length === 3 && data[0] === 27 && data[1] === 91) {
        if (data[2] === 65) { // Up
          state.slashMenuIndex = Math.max(0, state.slashMenuIndex - 1);
          render(state);
          return;
        }
        if (data[2] === 66) { // Down
          state.slashMenuIndex = Math.min(state.filteredCommands.length - 1, state.slashMenuIndex + 1);
          render(state);
          return;
        }
      }

      // Enter
      if (code === 13) {
        if (state.showSlashMenu && state.filteredCommands.length > 0) {
          // Accept selected slash command
          const selected = state.filteredCommands[state.slashMenuIndex];
          state.input = selected.name + ' ';
          state.cursorPos = state.input.length;
          state.showSlashMenu = false;
          render(state);
          return;
        }
        // Execute input
        const input = state.input;
        state.input = '';
        state.cursorPos = 0;
        state.showSlashMenu = false;
        state.outputLines.push('');
        render(state);
        await executeCommand(state, input);
        if (!state.running) {
          cleanup();
          resolve();
          return;
        }
        render(state);
        return;
      }

      // Backspace
      if (code === 127 || code === 8) {
        if (state.cursorPos > 0) {
          state.input = state.input.slice(0, state.cursorPos - 1) + state.input.slice(state.cursorPos);
          state.cursorPos--;
        }
        updateSlashMenu(state);
        render(state);
        return;
      }

      // Tab — autocomplete slash command
      if (code === 9 && state.showSlashMenu && state.filteredCommands.length > 0) {
        const selected = state.filteredCommands[state.slashMenuIndex];
        state.input = selected.name + ' ';
        state.cursorPos = state.input.length;
        state.showSlashMenu = false;
        render(state);
        return;
      }

      // Printable character
      if (key.length === 1 && code >= 32) {
        state.input = state.input.slice(0, state.cursorPos) + key + state.input.slice(state.cursorPos);
        state.cursorPos++;
        updateSlashMenu(state);
        render(state);
        return;
      }
    });
  });
}

function updateSlashMenu(state: WorkbenchState): void {
  if (state.input.startsWith('/')) {
    const partial = state.input.toLowerCase();
    // Don't show menu if there's already a space (command + argument)
    if (partial.includes(' ')) {
      state.showSlashMenu = false;
      return;
    }
    state.filteredCommands = SLASH_COMMANDS.filter(c =>
      c.name.startsWith(partial) || (c.alias && c.alias.startsWith(partial))
    );
    state.showSlashMenu = state.filteredCommands.length > 0;
    state.slashMenuIndex = Math.min(state.slashMenuIndex, Math.max(0, state.filteredCommands.length - 1));
  } else {
    state.showSlashMenu = false;
  }
}
