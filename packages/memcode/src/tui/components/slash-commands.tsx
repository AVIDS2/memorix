/**
 * Slash command system for the memcode TUI.
 *
 * Defines three execution modes:
 *   - "no-arg":    Execute directly (e.g. /clear, /help, /vim)
 *   - "selector":  Show a picker for choices (e.g. /model switch, /theme)
 *   - "text-input": Fill the input with the command prefix (e.g. /memory search)
 *
 * The CommandPicker component renders a filtered, keyboard-navigable
 * command palette above the input bar, following the same visual and
 * interaction patterns as InputBar's suggestion panel.
 */

import { useState, useMemo, useCallback, useEffect } from "react";
import { useKeyboard } from "@opentui/react";
import { theme } from "../theme.ts";

// ============================================================================
// Types
// ============================================================================

/** How the command should be dispatched when selected. */
export type CommandMode = "no-arg" | "selector" | "text-input";

/** Definition of a single slash command. */
export interface Command {
	/** Full command name including leading slash (e.g. "/clear", "/model switch"). */
	name: string;
	/** Human-readable description shown alongside the command. */
	description: string;
	/** Execution mode — determines how the command is dispatched. */
	mode: CommandMode;
	/** Optional direct executor for no-arg commands. Called with no arguments. */
	execute?: () => void | Promise<void>;
}

// ============================================================================
// Command Registry
// ============================================================================

/** All registered slash commands, grouped by execution mode. */
export const COMMANDS: readonly Command[] = [
	// ── No-arg (execute directly) ──
	{ name: "/clear",        description: "Clear conversation history",       mode: "no-arg" },
	{ name: "/help",         description: "Show available commands",          mode: "no-arg" },
	{ name: "/vim",          description: "Toggle vim keybindings",           mode: "no-arg" },
	{ name: "/doctor",       description: "Run diagnostic checks",           mode: "no-arg" },
	{ name: "/inspect",      description: "Inspect last assistant message",  mode: "no-arg" },
	{ name: "/clone",        description: "Clone current session",           mode: "no-arg" },
	{ name: "/git status",   description: "Show git working-tree status",    mode: "no-arg" },
	{ name: "/memory stats", description: "Show memory statistics",          mode: "no-arg" },
	{ name: "/memory diff",  description: "Show pending memory changes",     mode: "no-arg" },
	{ name: "/session export", description: "Export session to file",        mode: "no-arg" },
	{ name: "/session",      description: "Show current session info",       mode: "no-arg" },
	{ name: "/config",       description: "Open configuration",              mode: "no-arg" },
	{ name: "/exit",         description: "Exit memcode",                    mode: "no-arg" },

	// ── Selector (show picker) ──
	{ name: "/session load",   description: "Load a saved session",         mode: "selector" },
	{ name: "/session delete", description: "Delete a saved session",       mode: "selector" },
	{ name: "/session new",    description: "Create a new session",         mode: "selector" },
	{ name: "/resume",         description: "Resume a previous session",    mode: "selector" },
	{ name: "/tree",           description: "Navigate the session tree",    mode: "selector" },
	{ name: "/fork",           description: "Fork session at a point",      mode: "selector" },
	{ name: "/memory show",    description: "Browse stored memories",       mode: "selector" },
	{ name: "/memory delete",  description: "Delete a memory",             mode: "selector" },
	{ name: "/memory promote", description: "Promote a memory to permanent", mode: "selector" },
	{ name: "/model switch",   description: "Switch AI model",              mode: "selector" },
	{ name: "/theme",          description: "Switch color theme",           mode: "selector" },
	{ name: "/git commit",     description: "Create a git commit",          mode: "selector" },

	// ── Text-input (fill input for user to complete) ──
	{ name: "/memory search", description: "Search memories by query",  mode: "text-input" },
	{ name: "/remember",      description: "Store a new memory",        mode: "text-input" },
	{ name: "/label",         description: "Label the current session", mode: "text-input" },
	{ name: "/git diff",      description: "Show diff for a file",      mode: "text-input" },
] as const;

// ============================================================================
// Separator items (internal — used to group commands by mode)
// ============================================================================

interface SeparatorItem {
	kind: "separator";
	label: string;
}

/** Labels for each command mode group. */
const MODE_LABELS: Record<CommandMode, string> = {
	"no-arg":     "Quick Actions",
	"selector":   "Selectors",
	"text-input": "With Input",
};

/** Ordered mode groups for consistent rendering order. */
const MODE_ORDER: CommandMode[] = ["no-arg", "selector", "text-input"];

// ============================================================================
// Props
// ============================================================================

export interface CommandPickerProps {
	/** Current input text (used for substring filtering). */
	inputText: string;
	/** Called for text-input commands — provides the command prefix to fill. */
	onFillInput: (text: string) => void;
	/** Called for no-arg commands — dispatches execution directly. */
	onExecute: (command: Command) => void;
	/** Called when the user presses Escape to dismiss the picker. */
	onDismiss: () => void;
}

// ============================================================================
// CommandPicker
// ============================================================================

/**
 * Filterable, keyboard-navigable slash command palette.
 *
 * Renders as a flat list with mode separators. Substring-matches against
 * both command name and description. Navigates with Up/Down arrows,
 * selects with Enter or Tab, dismisses with Escape.
 */
export function CommandPicker({
	inputText,
	onFillInput,
	onExecute,
	onDismiss,
}: CommandPickerProps) {
	const [selectedIdx, setSelectedIdx] = useState(0);

	// --- Filter and build display list ---

	const displayList = useMemo(() => {
		const q = inputText.trim().toLowerCase();

		// Group commands by mode, preserving MODE_ORDER
		const groups = new Map<CommandMode, Command[]>();
		for (const cmd of COMMANDS) {
			const match =
				!q ||
				cmd.name.toLowerCase().includes(q) ||
				cmd.description.toLowerCase().includes(q);
			if (match) {
				const existing = groups.get(cmd.mode);
				if (existing) {
					existing.push(cmd);
				} else {
					groups.set(cmd.mode, [cmd]);
				}
			}
		}

		// Flatten into display list with separators between non-empty groups
		const list: (Command | SeparatorItem)[] = [];
		for (const mode of MODE_ORDER) {
			const cmds = groups.get(mode);
			if (!cmds || cmds.length === 0) continue;
			list.push({ kind: "separator", label: MODE_LABELS[mode] });
			list.push(...cmds);
		}

		return list;
	}, [inputText]);

	// --- Selectable items (exclude separators) ---

	const selectableItems = useMemo(
		() => displayList.filter((item): item is Command => "name" in item),
		[displayList],
	);

	// --- Clamp selection when filter results change ---

	useEffect(() => {
		if (selectedIdx >= selectableItems.length) {
			setSelectedIdx(selectableItems.length > 0 ? 0 : 0);
		}
	}, [selectableItems.length, selectedIdx]);

	// --- Navigation step helpers (skip separators) ---

	const findSelectableIndex = useCallback(
		(displayIdx: number, direction: -1 | 1): number => {
			let idx = displayIdx;
			for (let i = 0; i < displayList.length; i++) {
				idx += direction;
				if (idx < 0) idx = displayList.length - 1;
				if (idx >= displayList.length) idx = 0;
				if ("name" in displayList[idx]) {
					// Convert display index to selectable index
					let selIdx = 0;
					for (let j = 0; j < idx; j++) {
						if ("name" in displayList[j]) selIdx++;
					}
					return selIdx;
				}
			}
			return selectedIdx;
		},
		[displayList, selectedIdx],
	);

	// --- Select handler ---

	const handleSelect = useCallback(
		(cmd: Command) => {
			if (cmd.mode === "no-arg") {
				onExecute(cmd);
			} else {
				// selector / text-input: fill input with command prefix
				onFillInput(cmd.name + " ");
			}
		},
		[onFillInput, onExecute],
	);

	// --- Keyboard navigation ---

	useKeyboard((e) => {
		if (e.name === "escape") {
			e.preventDefault();
			onDismiss();
			return;
		}

		if (e.name === "up") {
			e.preventDefault();
			setSelectedIdx((i) => (i > 0 ? i - 1 : selectableItems.length - 1));
			return;
		}

		if (e.name === "down") {
			e.preventDefault();
			setSelectedIdx((i) =>
				i < selectableItems.length - 1 ? i + 1 : 0,
			);
			return;
		}

		if (e.name === "return" || e.name === "tab") {
			e.preventDefault();
			if (selectableItems.length > 0) {
				handleSelect(selectableItems[selectedIdx]);
			}
			return;
		}

		// All other keys (letters, backspace, etc.) pass through to the
		// parent input component so the user can keep refining their query.
	});

	// --- Early return if nothing matches ---

	if (selectableItems.length === 0) {
		return (
			<box
				width="100%"
				flexDirection="column"
				flexShrink={0}
				backgroundColor={theme.bgElevated}
			>
				<box paddingLeft={1} paddingRight={1}>
					<text fg={theme.textMuted}>No matching commands</text>
				</box>
			</box>
		);
	}

	// --- Render ---

	// Track the selectable index independently of display index (separators
	// occupy display positions but are not selectable).
	let selectableCounter = 0;

	return (
		<box
			width="100%"
			flexDirection="column"
			flexShrink={0}
			backgroundColor={theme.bgElevated}
		>
			{/* Header row */}
			<box
				width="100%"
				flexDirection="row"
				paddingLeft={1}
				paddingRight={1}
				flexShrink={0}
			>
				<text fg={theme.textMuted}>Commands</text>
				<box flexGrow={1} />
				<text fg={theme.textMuted}>{selectableItems.length}</text>
			</box>

			{/* Command list with mode separators */}
			{displayList.map((item, displayIdx) => {
				if ("kind" in item) {
					// Separator
					return (
						<box
							key={`sep-${item.label}`}
							width="100%"
							flexDirection="row"
							paddingLeft={1}
							paddingRight={1}
							flexShrink={0}
						>
							<text fg={theme.textMuted}>
								{"── "}{item.label}{" ──"}
							</text>
						</box>
					);
				}

				// Command row
				const currentSelIdx = selectableCounter++;
				const isSelected = currentSelIdx === selectedIdx;

				return (
					<box
						key={item.name}
						width="100%"
						flexDirection="row"
						paddingLeft={1}
						paddingRight={1}
						backgroundColor={
							isSelected ? theme.brandDim : undefined
						}
						onMouseUp={() => handleSelect(item)}
						onMouseOver={() => setSelectedIdx(currentSelIdx)}
					>
						<text fg={isSelected ? theme.brand : theme.textPrimary}>
							{item.name}
						</text>
						<text fg={theme.textMuted}>
							{" "}{item.description}
						</text>
					</box>
				);
			})}
		</box>
	);
}
