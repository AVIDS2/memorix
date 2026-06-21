/**
 * Keyboard shortcuts and vim mode for the memcode TUI.
 *
 * Exports a useKeymap() hook that registers all global keyboard shortcuts
 * and manages vim mode state. Returns the current mode and an action
 * dispatcher for programmatic control.
 *
 * Vim modes:
 *   INSERT       — normal typing (default)
 *   NORMAL       — navigation and commands (j/k scroll, g/G top/bottom, etc.)
 *   VISUAL       — reserved for future selection mode
 *   COMMAND_LINE — typing a / command (accumulated buffer shown in statusbar)
 *
 * Global shortcuts:
 *   Esc     — first: NORMAL mode, second (within 500ms): interrupt generation
 *   Ctrl+C  — exit with dialog confirm
 *   ?       — show help
 *
 * NORMAL mode shortcuts:
 *   j/k     — scroll messages down/up
 *   g/G     — scroll to top/bottom
 *   PgUp/PgDn — page scroll
 *   Space/Tab — toggle tool call expansion
 *   n/N     — next/prev tool call
 *   p       — promote last AI response to memory
 *   i       — switch to INSERT mode
 *   /       — enter command-line mode
 *   /vim    — toggle vim mode off (back to INSERT)
 */

import { useState, useCallback, useRef, useEffect } from "react";
import { useKeyboard } from "@opentui/react";

// ============================================================================
// Types
// ============================================================================

export type VimMode = "INSERT" | "NORMAL" | "VISUAL" | "COMMAND_LINE";

export interface ScrollControl {
	scrollDown: () => void;
	scrollUp: () => void;
	scrollToTop: () => void;
	scrollToBottom: () => void;
	pageDown: () => void;
	pageUp: () => void;
}

export interface KeymapCallbacks {
	/** Interrupt the current generation (agent runtime). */
	onInterrupt: () => void;
	/** Exit the application (triggered by Ctrl+C). */
	onExit: () => void;
	/** Show/hide help overlay. Returns true if help was visible and got closed. */
	onHelp: () => boolean;
	/** Promote the last AI response to a stored memory. */
	onPromote: () => void;
	/** Toggle vim mode (called by /vim command). */
	onToggleVim?: () => void;
	/** Scroll control for the message list. */
	scroll: ScrollControl;
}

export interface KeymapAPI {
	/** Current vim mode. */
	vimMode: VimMode;
	/** Programmatically set the vim mode. */
	setVimMode: (mode: VimMode) => void;
	/** Toggle vim mode on/off (INSERT <-> NORMAL). */
	toggleVim: () => void;
	/** Current command-line buffer (only non-empty in COMMAND_LINE mode). */
	cmdLineBuffer: string;
}

// ============================================================================
// Constants
// ============================================================================

/** Max time (ms) between two key presses for a chord sequence. */
const CHORD_TIMEOUT_MS = 500;

/** Page scroll step (lines). */
const PAGE_STEP = 20;

// ============================================================================
// Command registry
// ============================================================================

interface CommandDef {
	/** Command name (without leading /). */
	name: string;
	/** Execute the command. */
	action: (cb: KeymapCallbacks, setMode: (m: VimMode) => void) => void;
}

const COMMANDS: CommandDef[] = [
	{
		name: "vim",
		action: (_cb, setMode) => {
			// Toggle vim mode: NORMAL -> INSERT (exit vim mode)
			setMode("INSERT");
		},
	},
	{
		name: "noh",
		action: (_cb, setMode) => {
			setMode("INSERT");
		},
	},
	// Future commands can be added here:
	// { name: "q", action: (cb) => cb.onExit() },
	// { name: "w", action: (cb) => cb.onSave() },
];

// ============================================================================
// useKeymap
// ============================================================================

export function useKeymap(callbacks: KeymapCallbacks): KeymapAPI {
	// --- State ---

	const [vimMode, setVimMode] = useState<VimMode>("INSERT");
	const [cmdLineBuffer, setCmdLineBuffer] = useState("");

	// --- Refs (stable across renders for useKeyboard closure) ---

	const vimModeRef = useRef<VimMode>("INSERT");
	const cmdLineBufferRef = useRef("");
	const pendingKeyRef = useRef<{ key: string; ts: number } | null>(null);
	const chordTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const callbacksRef = useRef<KeymapCallbacks>(callbacks);

	// --- Sync refs ---

	useEffect(() => {
		vimModeRef.current = vimMode;
	}, [vimMode]);

	useEffect(() => {
		cmdLineBufferRef.current = cmdLineBuffer;
	}, [cmdLineBuffer]);

	useEffect(() => {
		callbacksRef.current = callbacks;
	}, [callbacks]);

	// Cleanup chord timer on unmount
	useEffect(
		() => () => {
			if (chordTimerRef.current) clearTimeout(chordTimerRef.current);
		},
		[],
	);

	// --- Toggle vim ---

	const toggleVim = useCallback(() => {
		setVimMode((prev) => (prev === "INSERT" ? "NORMAL" : "INSERT"));
	}, []);

	// --- Command-line execution ---

	function executeCommand(input: string): void {
		const trimmed = input.trim().toLowerCase();
		if (!trimmed) return;

		const cb = callbacksRef.current;

		for (const cmd of COMMANDS) {
			if (trimmed === cmd.name) {
				cmd.action(cb, setVimMode);
				return;
			}
		}

		// Unknown command — just exit command-line mode
		setVimMode("NORMAL");
	}

	// --- Chord sequence helper ---

	function matchChord(key: string): boolean {
		const pending = pendingKeyRef.current;
		if (!pending) return false;

		const elapsed = Date.now() - pending.ts;
		if (elapsed > CHORD_TIMEOUT_MS) {
			pendingKeyRef.current = null;
			if (chordTimerRef.current) {
				clearTimeout(chordTimerRef.current);
				chordTimerRef.current = null;
			}
			return false;
		}

		if (pending.key === key) {
			pendingKeyRef.current = null;
			if (chordTimerRef.current) {
				clearTimeout(chordTimerRef.current);
				chordTimerRef.current = null;
			}
			return true;
		}

		return false;
	}

	function startChord(key: string): void {
		if (chordTimerRef.current) {
			clearTimeout(chordTimerRef.current);
		}
		pendingKeyRef.current = { key, ts: Date.now() };
		chordTimerRef.current = setTimeout(() => {
			pendingKeyRef.current = null;
			chordTimerRef.current = null;
		}, CHORD_TIMEOUT_MS);
	}

	// --- Keyboard handler ---

	useKeyboard((e) => {
		const mode = vimModeRef.current;
		const cb = callbacksRef.current;

		// ══════════════════════════════════════════════════════════════════
		// GLOBAL SHORTCUTS (all modes except COMMAND_LINE)
		// ══════════════════════════════════════════════════════════════════

		// Ctrl+C — exit (works in all modes)
		if (e.name === "c" && e.ctrl) {
			e.preventDefault();
			cb.onExit();
			return;
		}

		// ══════════════════════════════════════════════════════════════════
		// COMMAND LINE MODE — typing a / command
		// ══════════════════════════════════════════════════════════════════

		if (mode === "COMMAND_LINE") {
			e.preventDefault();

			if (e.name === "escape") {
				// Cancel command-line, return to NORMAL
				setCmdLineBuffer("");
				setVimMode("NORMAL");
				return;
			}

			if (e.name === "return") {
				// Execute the accumulated command
				const cmd = cmdLineBufferRef.current;
				setCmdLineBuffer("");
				executeCommand(cmd);
				return;
			}

			if (e.name === "backspace") {
				setCmdLineBuffer((prev) => {
					if (prev.length <= 1) {
						// Buffer empty after backspace — cancel command-line
						setVimMode("NORMAL");
						return "";
					}
					return prev.slice(0, -1);
				});
				return;
			}

			// Append printable character to buffer
			if (e.name && e.name.length === 1 && !e.ctrl && !e.option && !e.meta) {
				setCmdLineBuffer((prev) => prev + e.name);
				return;
			}

			// All other keys ignored in command-line mode
			return;
		}

		// ══════════════════════════════════════════════════════════════════
		// ESCAPE — mode transition / interrupt / close overlays
		// ══════════════════════════════════════════════════════════════════

		if (e.name === "escape") {
			e.preventDefault();

			// If help overlay is open, close it (takes priority over mode switch)
			if (cb.onHelp()) {
				return;
			}

			if (mode === "INSERT") {
				// INSERT -> NORMAL
				setVimMode("NORMAL");
				return;
			}

			if (mode === "VISUAL") {
				// VISUAL -> NORMAL
				setVimMode("NORMAL");
				return;
			}

			// NORMAL mode — double-Esc interrupts
			if (mode === "NORMAL") {
				if (matchChord("escape")) {
					cb.onInterrupt();
				} else {
					startChord("escape");
				}
				return;
			}
		}

		// ══════════════════════════════════════════════════════════════════
		// INSERT MODE — limited global shortcuts only
		// (Most keys pass through to the InputBar)
		// ══════════════════════════════════════════════════════════════════

		if (mode === "INSERT") {
			return;
		}

		// ══════════════════════════════════════════════════════════════════
		// NORMAL / VISUAL MODE — navigation and command shortcuts
		// ══════════════════════════════════════════════════════════════════

		e.preventDefault();

		// --- Mode switch: i -> INSERT ---

		if (e.name === "i" && !e.ctrl && !e.option && !e.meta) {
			setVimMode("INSERT");
			return;
		}

		// --- ? — show help (must check before / to avoid shift+/ conflict) ---

		if ((e.name === "?" || (e.name === "/" && e.shift)) && !e.ctrl) {
			cb.onHelp();
			return;
		}

		// --- / command-line mode (unshifted / only) ---

		if (e.name === "/" && !e.shift && !e.ctrl && !e.option && !e.meta) {
			setCmdLineBuffer("/");
			setVimMode("COMMAND_LINE");
			return;
		}

		// --- Message navigation: j/k ---

		if (e.name === "j" && !e.ctrl && !e.option && !e.meta) {
			cb.scroll.scrollDown();
			return;
		}
		if (e.name === "k" && !e.ctrl && !e.option && !e.meta) {
			cb.scroll.scrollUp();
			return;
		}

		// --- g/G chords: gg = top, G = bottom ---

		if (e.name === "g" && !e.ctrl && !e.option && !e.meta) {
			if (matchChord("g")) {
				cb.scroll.scrollToTop();
			} else {
				startChord("g");
			}
			return;
		}
		if (e.name === "g" && e.shift && !e.ctrl && !e.option) {
			cb.scroll.scrollToBottom();
			return;
		}

		// --- Page scroll: PgUp/PgDn ---

		if (e.name === "pageup") {
			cb.scroll.pageUp();
			return;
		}
		if (e.name === "pagedown") {
			cb.scroll.pageDown();
			return;
		}

		// --- Tool call expansion: Space/Tab ---

		if (e.name === "space" || e.name === "tab") {
			// Handled by ToolCallBlock's own useKeyboard
			return;
		}

		// --- Tool call navigation: n/N ---

		if (e.name === "n" && !e.ctrl && !e.option && !e.meta && !e.shift) {
			// Next tool call — TODO: wire to focused-tool-call index
			return;
		}
		if (e.name === "n" && e.shift && !e.ctrl && !e.option) {
			// Previous tool call — TODO: wire to focused-tool-call index
			return;
		}

		// --- Memory promote: p ---

		if (e.name === "p" && !e.ctrl && !e.option && !e.meta) {
			cb.onPromote();
			return;
		}

		// --- All other keys in NORMAL/VISUAL are swallowed ---
	});

	// --- API ---

	return {
		vimMode,
		setVimMode,
		toggleVim,
		cmdLineBuffer,
	};
}
