/**
 * InputBar — advanced bottom input component for memcode TUI.
 *
 * Features:
 *   1. Input history — Up/Down to navigate, Ctrl+R for reverse search
 *   2. @ memory picker — type @ to trigger memory fuzzy search via compactSearch
 *   3. Attachment preview — shows attached file names
 *   4. Token count display — estimates tokens (~4 chars/token)
 *   5. Multi-line support — Shift+Enter for newline, Enter to submit
 *   6. Slash commands — / triggers command palette
 *
 * Layout:
 *   [attachment preview row]  (when files attached)
 *   [suggestion panel]        (when / @ or Ctrl+R active)
 *   [ 📎 attach]  › input text...  NL  128tok  [esc]
 */

import {
	useState,
	useRef,
	useMemo,
	useCallback,
	useEffect,
} from "react";
import { useKeyboard } from "@opentui/react";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { importFromMemorix } from "../../core/memorix-resolve.ts";
import { theme } from "../theme.ts";

// ============================================================================
// Constants
// ============================================================================

/** Slash commands available in the TUI. */
const SLASH_COMMANDS = [
	{ name: "/help", desc: "Show available commands" },
	{ name: "/clear", desc: "Clear conversation history" },
	{ name: "/compact", desc: "Compact conversation context" },
	{ name: "/model", desc: "Switch AI model" },
	{ name: "/memory", desc: "Search memorix memories" },
] as const;

/** @-mention targets (static fallback when no search results). */
const AT_SUGGESTIONS = [
	{ name: "@file", desc: "Attach a file to context" },
	{ name: "@codebase", desc: "Search entire codebase" },
	{ name: "@git", desc: "Search git history" },
] as const;

import type { VimMode } from "../keymap.ts";

/** Maximum history entries to persist. */
const MAX_HISTORY = 100;

/** Memory search debounce in ms. */
const SEARCH_DEBOUNCE_MS = 300;

/** Fuzzy-match a query against a text string. */
function fuzzyMatch(query: string, text: string): boolean {
	const q = query.toLowerCase();
	const t = text.toLowerCase();
	if (!q) return true;
	if (t.includes(q)) return true;
	const qTokens = q.split(/\s+/).filter(Boolean);
	const tTokens = t.split(/\s+/);
	return qTokens.every((qt) => tTokens.some((tt) => tt.includes(qt)));
}

// ============================================================================
// File-backed history persistence
// ============================================================================

let _historyPath: string | null = null;

function getHistoryPath(): string {
	if (_historyPath) return _historyPath;
	_historyPath = join(tmpdir(), `memcode-input-history-${process.pid}.json`);
	return _historyPath;
}

/** Load persisted input history from disk (best-effort). */
function loadHistoryFromDisk(): string[] {
	try {
		const raw = readFileSync(getHistoryPath(), "utf-8");
		const parsed = JSON.parse(raw);
		if (Array.isArray(parsed)) {
			return parsed.slice(0, MAX_HISTORY);
		}
	} catch {
		// First run or corrupt file — start fresh
	}
	return [];
}

/** Persist input history to disk (fire-and-forget, no locking). */
function saveHistoryToDisk(history: string[]): void {
	try {
		writeFileSync(
			getHistoryPath(),
			JSON.stringify(history.slice(0, MAX_HISTORY)),
			"utf-8",
		);
	} catch {
		// Non-fatal: history just won't persist across restarts
	}
}

// ============================================================================
// Memory search
// ============================================================================

interface MemoryEntry {
	id: string;
	title: string;
	type: string;
	entityName?: string;
	narrative?: string;
}

let _compactSearchFn: ((...args: any[]) => any) | null = null;

async function searchMemories(query: string): Promise<MemoryEntry[]> {
	if (!query.trim()) return [];

	try {
		if (!_compactSearchFn) {
			const mod = await importFromMemorix("compact/engine.js");
			_compactSearchFn = mod.compactSearch;
		}

		const result = await _compactSearchFn!({
			query,
			limit: 10,
		});

		const entries = (result.entries ?? []) as any[];
		return entries.map((e: any) => ({
			id: String(e.id ?? e.index ?? ""),
			title: e.title ?? e.entityName ?? "untitled",
			type: e.type ?? "unknown",
			entityName: e.entityName,
			narrative: e.narrative,
		}));
	} catch {
		// Search failure is non-fatal — fall back to empty results
		return [];
	}
}

/** Estimate token count (~4 characters per token). */
function estimateTokens(text: string): number {
	return Math.ceil(text.length / 4);
}

// ============================================================================
// Types
// ============================================================================

/**
 * UI mode for the input bar.
 * - null:           normal typing
 * - "slash":        slash command palette
 * - "at":           @ memory search
 * - "reverse":      Ctrl+R reverse history search
 * - "history":      Up/Down history browsing
 */
type InputMode = "slash" | "at" | "reverse" | "history" | null;

export interface InputBarProps {
	/** Called when the user submits a message. */
	onSend: (text: string) => void;
	/** Currently attached file paths. */
	attachments?: string[];
	/** Current vim mode. When NORMAL/VISUAL, keyboard input is blocked. */
	vimMode?: VimMode;
	/** Called when Esc is pressed in INSERT mode to switch to NORMAL mode. */
	onSwitchToNormal?: () => void;
}

// ============================================================================
// InputBar
// ============================================================================

export function InputBar({ onSend, attachments = [], vimMode, onSwitchToNormal }: InputBarProps) {
	// --- State ---

	const [inputText, setInputText] = useState("");
	const [activeMode, setActiveMode] = useState<InputMode>(null);
	const [selectedIdx, setSelectedIdx] = useState(0);
	const [memoryResults, setMemoryResults] = useState<MemoryEntry[]>([]);
	const [memoryQuery, setMemoryQuery] = useState("");
	const [isSearching, setIsSearching] = useState(false);
	const [inputHistory, setInputHistory] = useState<string[]>([]);
	const [historyIdx, setHistoryIdx] = useState(-1);

	// --- Refs (stable across renders for useKeyboard) ---

	const inputRef = useRef<any>(null);
	const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const preHistoryTextRef = useRef("");
	const filteredRef = useRef<
		readonly { readonly name: string; readonly desc: string }[]
	>([]);
	const activeModeRef = useRef<InputMode>(null);
	const selectedIdxRef = useRef(0);
	const inputTextRef = useRef("");
	const inputHistoryRef = useRef<string[]>([]);
	const historyIdxRef = useRef(-1);
	const memoryResultsRef = useRef<MemoryEntry[]>([]);
	const memoryQueryRef = useRef("");
	const pendingSubmitRef = useRef("");

	// --- Sync refs to state ---

	useEffect(() => {
		activeModeRef.current = activeMode;
	}, [activeMode]);
	useEffect(() => {
		selectedIdxRef.current = selectedIdx;
	}, [selectedIdx]);
	useEffect(() => {
		inputTextRef.current = inputText;
	}, [inputText]);
	useEffect(() => {
		inputHistoryRef.current = inputHistory;
	}, [inputHistory]);
	useEffect(() => {
		historyIdxRef.current = historyIdx;
	}, [historyIdx]);
	useEffect(() => {
		memoryResultsRef.current = memoryResults;
	}, [memoryResults]);
	useEffect(() => {
		memoryQueryRef.current = memoryQuery;
	}, [memoryQuery]);

	// --- Initialize history from disk ---

	useEffect(() => {
		const loaded = loadHistoryFromDisk();
		if (loaded.length > 0) {
			setInputHistory(loaded);
		}
	}, []);

	// --- Filtered suggestions based on active mode ---

	const filtered = useMemo(() => {
		if (activeMode === "slash") {
			const q = inputText.trim().toLowerCase();
			if (!q) return SLASH_COMMANDS;
			return SLASH_COMMANDS.filter(
				(c) =>
					c.name.toLowerCase().includes(q) ||
					c.desc.toLowerCase().includes(q),
			);
		}
		if (activeMode === "at") {
			// Show memory results if we have them; fall back to static suggestions
			if (memoryResults.length > 0) {
				return memoryResults.map((m) => ({
					name: `@${m.title}`,
					desc: `[${m.type}] ${(m.narrative ?? "").slice(0, 60)}`,
				}));
			}
			const idx = inputText.lastIndexOf("@");
			const q = idx >= 0 ? inputText.slice(idx).toLowerCase() : "";
			if (!q) return AT_SUGGESTIONS;
			return AT_SUGGESTIONS.filter(
				(s) =>
					s.name.toLowerCase().includes(q) ||
					s.desc.toLowerCase().includes(q),
			);
		}
		return [];
	}, [activeMode, inputText, memoryResults]);

	// Keep filteredRef in sync
	useEffect(() => {
		filteredRef.current = filtered;
	}, [filtered]);

	// Clamp selectedIdx when list changes
	useEffect(() => {
		if (selectedIdx >= filtered.length) {
			setSelectedIdx(filtered.length > 0 ? 0 : 0);
		}
	}, [filtered.length, selectedIdx]);

	// --- Memory search with debounce ---

	const triggerMemorySearch = useCallback((query: string) => {
		if (searchTimerRef.current) {
			clearTimeout(searchTimerRef.current);
		}
		if (!query.trim()) {
			setMemoryResults([]);
			setIsSearching(false);
			return;
		}

		setIsSearching(true);
		searchTimerRef.current = setTimeout(async () => {
			const results = await searchMemories(query);
			setMemoryResults(results);
			setIsSearching(false);
			setSelectedIdx(0);
		}, SEARCH_DEBOUNCE_MS);
	}, []);

	// Cleanup debounce timer on unmount
	useEffect(
		() => () => {
			if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
		},
		[],
	);

	// --- History helpers ---

	const saveToHistory = useCallback(
		(text: string) => {
			const trimmed = text.trim();
			if (!trimmed) return;
			const history = inputHistoryRef.current;
			const deduplicated = history.filter((h) => h !== trimmed);
			const updated = [trimmed, ...deduplicated].slice(0, MAX_HISTORY);
			setInputHistory(updated);
			saveHistoryToDisk(updated);
		},
		[],
	);

	const startHistoryBrowsing = useCallback(
		(direction: -1 | 1) => {
			const text = inputTextRef.current;
			const history = inputHistoryRef.current;
			if (history.length === 0) return;

			preHistoryTextRef.current = text;
			const newIndex = historyIdxRef.current + direction;

			if (newIndex < 0 || newIndex >= history.length) {
				// Reached end of history — restore original text
				setHistoryIdx(-1);
				setActiveMode(null);
				setInputText(preHistoryTextRef.current);
				if (
					inputRef.current &&
					typeof inputRef.current.setText === "function"
				) {
					inputRef.current.setText(preHistoryTextRef.current);
				}
				return;
			}

			setHistoryIdx(newIndex);
			setActiveMode("history");
			setInputText(history[newIndex]);
			if (
				inputRef.current &&
				typeof inputRef.current.setText === "function"
			) {
				inputRef.current.setText(history[newIndex]);
			}
		},
		[],
	);

	// --- Select handlers ---

	const selectSlashSuggestion = useCallback(
		(name: string) => {
			setInputText(name + " ");
			setActiveMode(null);
			setSelectedIdx(0);
			if (
				inputRef.current &&
				typeof inputRef.current.setText === "function"
			) {
				inputRef.current.setText(name + " ");
			}
		},
		[],
	);

	const selectMemory = useCallback(
		(name: string) => {
			// Find the memory entry by matching "@title"
			const entry = memoryResultsRef.current.find(
				(m) => `@${m.title}` === name,
			);

			const text = inputTextRef.current;
			const atIndex = text.lastIndexOf("@");

			// Build memory context snippet for the LLM
			const contextSnippet = entry
				? `[memory: ${entry.title} (${entry.type})${entry.narrative ? ` — ${entry.narrative.slice(0, 120)}` : ""}]`
				: name;

			const before = atIndex >= 0 ? text.slice(0, atIndex) : "";
			const after = name + " ";
			const newText = before + after + contextSnippet;

			setInputText(newText);
			setActiveMode(null);
			setSelectedIdx(0);
			setMemoryResults([]);
			setMemoryQuery("");
			if (
				inputRef.current &&
				typeof inputRef.current.setText === "function"
			) {
				inputRef.current.setText(newText);
			}
		},
		[],
	);

	const selectSuggestion = useCallback(
		(name: string) => {
			const mode = activeModeRef.current;
			if (mode === "slash") {
				selectSlashSuggestion(name);
			} else if (mode === "at") {
				selectMemory(name);
			}
		},
		[selectSlashSuggestion, selectMemory],
	);

	// ============================================================================
	// Keyboard handler (refs-based for stable useKeyboard closure)
	// ============================================================================

	const handleKeyboard = useCallback(
		(e: any) => {
			const mode = activeModeRef.current;
			const flt = filteredRef.current;
			const sIdx = selectedIdxRef.current;
			const text = inputTextRef.current;
			const history = inputHistoryRef.current;
			const hIdx = historyIdxRef.current;

			// ── VIM MODE GUARD ──
			// In NORMAL, VISUAL, or COMMAND_LINE mode, defer all keyboard
			// handling to the global keymap (useKeymap). The only exception
			// is when a suggestion panel is actively open in NORMAL mode,
			// in which case we allow Escape to close it first.
			if (vimMode && vimMode !== "INSERT") {
				if (vimMode === "COMMAND_LINE") {
					// Command-line mode — all keys handled by global keymap
					return;
				}
				if (mode && e.name === "escape") {
					// Close the suggestion panel, stay in the same vim mode
					e.preventDefault();
					setActiveMode(null);
					setSelectedIdx(0);
					if (mode === "at") {
						setMemoryResults([]);
						setMemoryQuery("");
					}
					if (mode === "history" || mode === "reverse") {
						setHistoryIdx(-1);
						setInputText(preHistoryTextRef.current);
						if (
							inputRef.current &&
							typeof inputRef.current.setText === "function"
						) {
							inputRef.current.setText(preHistoryTextRef.current);
						}
					}
					return;
				}
				// All other keys in NORMAL/VISUAL are handled by the global keymap
				return;
			}

			// ── MEMORY SEARCH MODE ──
			if (mode === "reverse") {
				if (e.name === "escape") {
					e.preventDefault();
					setActiveMode(null);
					setInputText(preHistoryTextRef.current);
					if (
						inputRef.current &&
						typeof inputRef.current.setText === "function"
					) {
						inputRef.current.setText(preHistoryTextRef.current);
					}
					return;
				}
				if (e.name === "up") {
					e.preventDefault();
					setSelectedIdx((i) =>
						flt.length > 0
							? (i > 0 ? i - 1 : flt.length - 1)
							: 0,
					);
					return;
				}
				if (e.name === "down") {
					e.preventDefault();
					setSelectedIdx((i) =>
						flt.length > 0
							? (i < flt.length - 1 ? i + 1 : 0)
							: 0,
					);
					return;
				}
				if (e.name === "return" && !e.shift) {
					e.preventDefault();
					if (flt.length > 0) {
						const selected = flt[sIdx];
						if (selected) {
							setInputText(selected.name);
							setActiveMode(null);
							setSelectedIdx(0);
							if (
								inputRef.current &&
								typeof inputRef.current.setText === "function"
							) {
								inputRef.current.setText(selected.name);
							}
						}
					}
					return;
				}
				// Other keys pass through to <input> for typing
				return;
			}

			// ── HISTORY BROWSING MODE ──
			if (mode === "history") {
				if (e.name === "up") {
					e.preventDefault();
					startHistoryBrowsing(-1);
					return;
				}
				if (e.name === "down") {
					e.preventDefault();
					startHistoryBrowsing(1);
					return;
				}
				if (e.name === "escape") {
					e.preventDefault();
					setHistoryIdx(-1);
					setActiveMode(null);
					setInputText(preHistoryTextRef.current);
					if (
						inputRef.current &&
						typeof inputRef.current.setText === "function"
					) {
						inputRef.current.setText(preHistoryTextRef.current);
					}
					return;
				}
				// Enter in history mode: restore current history item, exit mode,
				// then re-trigger so next Enter can submit
				if (e.name === "return" && !e.shift) {
					e.preventDefault();
					setHistoryIdx(-1);
					setActiveMode(null);
					// Text is already in inputText — user can press Enter again to submit
					return;
				}
				// Other keys exit history mode and pass through
				setHistoryIdx(-1);
				setActiveMode(null);
				setInputText(preHistoryTextRef.current);
				if (
					inputRef.current &&
					typeof inputRef.current.setText === "function"
				) {
					inputRef.current.setText(preHistoryTextRef.current);
				}
				return;
			}

			// ── SLASH / AT SUGGESTION MODE ──
			if (mode === "slash" || mode === "at") {
				if (e.name === "escape") {
					e.preventDefault();
					setActiveMode(null);
					setSelectedIdx(0);
					if (mode === "at") {
						setMemoryResults([]);
						setMemoryQuery("");
					}
					return;
				}
				if (e.name === "up") {
					e.preventDefault();
					setSelectedIdx((i) =>
						flt.length > 0
							? (i > 0 ? i - 1 : flt.length - 1)
							: 0,
					);
					return;
				}
				if (e.name === "down") {
					e.preventDefault();
					setSelectedIdx((i) =>
						flt.length > 0
							? (i < flt.length - 1 ? i + 1 : 0)
							: 0,
					);
					return;
				}
				if (e.name === "return" && !e.shift) {
					e.preventDefault();
					if (flt.length > 0) {
						const sel = flt[sIdx];
						if (sel) selectSuggestion(sel.name);
					}
					return;
				}
				if (e.name === "tab") {
					e.preventDefault();
					if (flt.length > 0) {
						const sel = flt[sIdx];
						if (sel) selectSuggestion(sel.name);
					}
					return;
				}
				// Other keys pass through to <input>
				return;
			}

			// ── NORMAL MODE ──

			// Ctrl+R: reverse history search
			if (e.name === "r" && e.ctrl) {
				e.preventDefault();
				preHistoryTextRef.current = text;
				setActiveMode("reverse");
				setSelectedIdx(0);
				setInputText("");
				if (
					inputRef.current &&
					typeof inputRef.current.setText === "function"
				) {
					inputRef.current.setText("");
				}
				return;
			}

			// Up/Down: history browsing
			if (e.name === "up" && !e.shift && !e.ctrl) {
				e.preventDefault();
				startHistoryBrowsing(1);
				return;
			}
			if (e.name === "down" && !e.shift && !e.ctrl) {
				e.preventDefault();
				if (hIdx >= 0) {
					startHistoryBrowsing(-1);
				}
				return;
			}

			// Enter (without shift): submit
			if (e.name === "return" && !e.shift) {
				e.preventDefault();
				const trimmed = text.trim();
				if (trimmed) {
					pendingSubmitRef.current = trimmed;
					saveToHistory(trimmed);
					setInputText("");
					setHistoryIdx(-1);
					if (
						inputRef.current &&
						typeof inputRef.current.setText === "function"
					) {
						inputRef.current.setText("");
					}
				}
				return;
			}

			// Escape: with vim mode, switch to NORMAL; without, clear input
			if (e.name === "escape") {
				e.preventDefault();
				if (onSwitchToNormal) {
					// Vim mode active — first Esc switches to NORMAL mode
					onSwitchToNormal();
				} else if (text) {
					// No vim mode — legacy behavior: clear input
					setInputText("");
					setHistoryIdx(-1);
					if (
						inputRef.current &&
						typeof inputRef.current.setText === "function"
					) {
						inputRef.current.setText("");
					}
				}
				return;
			}
		},
		[selectSuggestion, startHistoryBrowsing, saveToHistory, vimMode, onSwitchToNormal],
	);

	useKeyboard(handleKeyboard);

	// --- Flush pending submit after state update ---

	useEffect(() => {
		if (pendingSubmitRef.current) {
			const text = pendingSubmitRef.current;
			pendingSubmitRef.current = "";
			onSend(text);
		}
	});

	// --- Input change handler (value-driven mode detection) ---

	function handleInput(value: string) {
		setInputText(value);
		const trimmed = value.trim();

		// ── Reverse search mode: filter history by query ──
		if (activeMode === "reverse") {
			if (value !== inputText) {
				// Already updated above; just filter
			}
			// Filter is driven by the `filtered` useMemo above when activeMode === "reverse"
			setSelectedIdx(0);
			return;
		}

		// ── History mode: ignore input changes (handled by keyboard) ──
		if (activeMode === "history") return;

		// ── Slash command detection (only at start of input) ──
		if (trimmed === "/") {
			setActiveMode("slash");
			setSelectedIdx(0);
		} else if (trimmed.startsWith("/") && activeMode === "slash") {
			setSelectedIdx(0);
		} else if (activeMode === "slash" && !trimmed.startsWith("/")) {
			setActiveMode(null);
		}

		// ── @ memory picker detection ──
		if (activeMode !== "slash") {
			if (value.includes("@") && activeMode !== "at") {
				setActiveMode("at");
				setSelectedIdx(0);
				// Extract query after @
				const idx = value.lastIndexOf("@");
				const query = idx >= 0 ? value.slice(idx + 1).trim() : "";
				setMemoryQuery(query);
				triggerMemorySearch(query);
			} else if (activeMode === "at") {
				if (!value.includes("@")) {
					// User deleted the @ — exit mode
					setActiveMode(null);
					setMemoryResults([]);
					setMemoryQuery("");
				} else {
					// Update search query
					const idx = value.lastIndexOf("@");
					const query = idx >= 0 ? value.slice(idx + 1).trim() : "";
					setMemoryQuery(query);
					triggerMemorySearch(query);
				}
			}
		}
	}

	// --- Derived display values ---

	const isMultiline = inputText.includes("\n");
	const lineCount = isMultiline ? inputText.split("\n").length : 1;

	const displayMode =
		activeMode === "reverse"
			? "search"
			: activeMode === "at"
				? "memory"
				: activeMode === "slash"
					? "commands"
					: null;

	// History-aware filtered list for reverse search
	const effectiveFiltered = useMemo(() => {
		if (activeMode === "reverse") {
			const q = inputText.trim().toLowerCase();
			if (!q) {
				return inputHistory.slice(0, 20).map((h) => ({
					name: h,
					desc: "(history)",
				}));
			}
			return inputHistory
				.filter((h) => fuzzyMatch(q, h))
				.slice(0, 20)
				.map((h) => ({
					name: h,
					desc: "(history)",
				}));
		}
		return filtered;
	}, [activeMode, inputText, filtered, inputHistory]);

	// Sync effectiveFiltered to ref for useKeyboard
	useEffect(() => {
		filteredRef.current = effectiveFiltered;
	}, [effectiveFiltered]);

	// ============================================================================
	// Render
	// ============================================================================

	return (
		<box
			width="100%"
			flexDirection="column"
			flexShrink={0}
			border={["top"]}
			borderColor={theme.bgBorder}
		>
			{/* ── Attachment preview ── */}
			{attachments.length > 0 ? (
				<box
					width="100%"
					flexDirection="row"
					flexShrink={0}
					paddingLeft={1}
					paddingRight={1}
					gap={1}
					backgroundColor={theme.bgElevated}
				>
					<text fg={theme.info}>
						{attachments.length} file
						{attachments.length !== 1 ? "s" : ""}
					</text>
					{attachments.slice(0, 3).map((f, i) => (
						<text key={i} fg={theme.textSecondary} truncate>
							{f.split("/").pop() ?? f}
						</text>
					))}
					{attachments.length > 3 ? (
						<text fg={theme.textMuted}>
							+{attachments.length - 3} more
						</text>
					) : null}
				</box>
			) : null}

			{/* ── Suggestion / search panel ── */}
			{activeMode ? (
				<box
					width="100%"
					flexDirection="column"
					flexShrink={0}
					backgroundColor={theme.bgElevated}
				>
					{/* Panel header */}
					<box
						width="100%"
						flexDirection="row"
						paddingLeft={1}
						paddingRight={1}
						flexShrink={0}
					>
						<text fg={theme.textMuted}>
							{activeMode === "reverse" ? (
								`Search: ${inputText || "..."}`
							) : displayMode ? (
								displayMode.charAt(0).toUpperCase() +
								displayMode.slice(1)
							) : null}
						</text>
						<box flexGrow={1} />
						{activeMode === "at" && isSearching ? (
							<text fg={theme.textMuted}>searching...</text>
						) : null}
						<text fg={theme.textMuted}>
							{effectiveFiltered.length}
						</text>
					</box>

					{/* Result list */}
					{effectiveFiltered.map((item, i) => (
						<box
							key={item.name}
							width="100%"
							flexDirection="row"
							paddingLeft={1}
							paddingRight={1}
							backgroundColor={
								i === selectedIdx
									? theme.brandDim
									: undefined
							}
							onMouseUp={() => selectSuggestion(item.name)}
							onMouseOver={() => setSelectedIdx(i)}
						>
							<text
								fg={
									i === selectedIdx
										? theme.brand
										: theme.textPrimary
								}
							>
								{item.name}
							</text>
							<text fg={theme.textMuted}>
								{" "}
								{item.desc}
							</text>
						</box>
					))}

					{/* Empty state for reverse search with no history */}
					{activeMode === "reverse" &&
					effectiveFiltered.length === 0 ? (
						<box paddingLeft={1} paddingRight={1}>
							<text fg={theme.textMuted}>
								No matching history
							</text>
						</box>
					) : null}
				</box>
			) : null}

			{/* ── Main input row ── */}
			<box
				width="100%"
				height={1}
				flexDirection="row"
				flexShrink={0}
				alignItems="center"
				paddingLeft={1}
				paddingRight={1}
				gap={1}
				backgroundColor={theme.bgBase}
			>
				{/* Attachment button */}
				<text fg={theme.info} flexShrink={0}>
					{"\u{1F4CE}"} attach
				</text>

				{/* Multiline indicator */}
				{isMultiline ? (
					<text fg={theme.warning} flexShrink={0}>
						NL:{lineCount}
					</text>
				) : null}

				<text fg={theme.textMuted} flexShrink={0}>
					{">"}
				</text>

				{/* Text input */}
				<box flexGrow={1} flexShrink={1}>
					<input
						width="100%"
						placeholder={
							activeMode === "reverse"
								? "search history..."
								: "type here..."
						}
						placeholderColor={theme.textMuted}
						textColor={theme.textPrimary}
						focusedTextColor={theme.textPrimary}
						backgroundColor={theme.bgBase}
						focusedBackgroundColor={theme.bgBase}
						focused={true}
						onInput={handleInput}
						ref={(el: any) => {
							inputRef.current = el;
						}}
					/>
				</box>

				{/* Multiline line hint */}
				{isMultiline ? (
					<text fg={theme.textMuted} flexShrink={0}>
						{"S+Ent"}
					</text>
				) : null}

				{/* Token count */}
				<text fg={theme.textMuted} flexShrink={0}>
					{inputText.length > 0
						? `${estimateTokens(inputText)}tok`
						: "0tok"}
				</text>

				{/* Escape hint */}
				<text fg={theme.textMuted} flexShrink={0}>
					[esc]
				</text>
			</box>
		</box>
	);
}
