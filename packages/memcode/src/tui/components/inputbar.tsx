/**
 * InputBar — fixed bottom input component for memcode TUI.
 *
 * Layout:
 *   [attachment preview]  (when files attached)
 *   [suggestion panel]   (when / or @ active)
 *   [📎 attach]  › type here...  128tok  [esc]
 *
 * Features:
 *   - Text input with placeholder
 *   - Token count display (~4 chars/token estimate)
 *   - Attachment preview line
 *   - Slash command suggestions (trigger: / at start)
 *   - @ memory picker (trigger: @ anywhere)
 */

import { useState, useRef, useMemo, useCallback, useEffect } from "react";
import { useKeyboard } from "@opentui/react";
import { theme } from "../theme.ts";

/** Slash commands available in the TUI. */
const SLASH_COMMANDS = [
	{ name: "/help", desc: "Show available commands" },
	{ name: "/clear", desc: "Clear conversation history" },
	{ name: "/compact", desc: "Compact conversation context" },
	{ name: "/model", desc: "Switch AI model" },
	{ name: "/memory", desc: "Search memorix memories" },
] as const;

/** @-mention file targets (placeholder — wired to file picker later). */
const FILE_SUGGESTIONS = [
	{ name: "@file", desc: "Attach a file to context" },
	{ name: "@codebase", desc: "Search entire codebase" },
	{ name: "@git", desc: "Search git history" },
] as const;

/** Props for the InputBar component. */
export interface InputBarProps {
	/** Called when the user submits a message (Enter key). */
	onSend: (text: string) => void;
	/** Currently attached file paths. */
	attachments?: string[];
}

/** Estimate token count (~4 characters per token). */
function estimateTokens(text: string): number {
	return Math.ceil(text.length / 4);
}

/** InputBar — fixed bottom bar with text input, token counter, and suggestions. */
export function InputBar({ onSend, attachments = [] }: InputBarProps) {
	const [inputText, setInputText] = useState("");
	const [activeMode, setActiveMode] = useState<"slash" | "at" | null>(null);
	const [selectedIdx, setSelectedIdx] = useState(0);
	const inputRef = useRef<any>(null);

	// Filtered suggestions based on current mode and query
	const filtered = useMemo(() => {
		if (activeMode === "slash") {
			const q = inputText.trim().toLowerCase();
			if (!q) return SLASH_COMMANDS;
			return SLASH_COMMANDS.filter((c) =>
				c.name.toLowerCase().includes(q) ||
				c.desc.toLowerCase().includes(q)
			);
		}
		if (activeMode === "at") {
			const idx = inputText.lastIndexOf("@");
			const q = idx >= 0 ? inputText.slice(idx).toLowerCase() : "";
			if (!q) return FILE_SUGGESTIONS;
			return FILE_SUGGESTIONS.filter(
				(s) =>
					s.name.toLowerCase().includes(q) ||
					s.desc.toLowerCase().includes(q)
			);
		}
		return [];
	}, [activeMode, inputText]);

	// Reset selectedIdx when filtered list changes and index is out of bounds.
	useEffect(() => {
		if (selectedIdx >= filtered.length) {
			setSelectedIdx(filtered.length > 0 ? 0 : 0);
		}
	}, [filtered.length, selectedIdx]);

	/** Replace the active trigger text with the chosen suggestion. */
	const selectSuggestion = useCallback(
		(name: string) => {
			if (activeMode === "slash") {
				setInputText(name + " ");
			} else if (activeMode === "at") {
				const idx = inputText.lastIndexOf("@");
				setInputText(
					(idx >= 0 ? inputText.slice(0, idx) : "") + name + " "
				);
			}
			setActiveMode(null);
			setSelectedIdx(0);
		},
		[activeMode, inputText]
	);

	/** Keep inputRef and state in sync as the user types. */
	// Not wrapped in useCallback — fresh closure each render avoids stale activeMode.
	function handleInput(value: string) {
		setInputText(value);
		const trimmed = value.trim();

		// Slash command detection (only at start of input)
		if (trimmed === "/") {
			setActiveMode("slash");
			setSelectedIdx(0);
		} else if (trimmed.startsWith("/") && activeMode === "slash") {
			// Still typing slash command — keep mode, reset index
			setSelectedIdx(0);
		} else if (activeMode === "slash" && !trimmed.startsWith("/")) {
			// Left slash prefix — exit mode
			setActiveMode(null);
		}

		// @ memory picker detection (check input value, not key event)
		// Only activate outside of slash mode.
		if (activeMode !== "slash") {
			if (value.includes("@") && activeMode !== "at") {
				setActiveMode("at");
				setSelectedIdx(0);
			} else if (activeMode === "at" && !value.includes("@")) {
				// User deleted the @ — exit mode
				setActiveMode(null);
			}
		}
	}

	// --- Keyboard handling ---

	useKeyboard((e) => {
		// --- Slash / At mode: suggestion navigation ---
		if (activeMode) {
			if (e.name === "escape") {
				e.preventDefault();
				setActiveMode(null);
				setSelectedIdx(0);
				return;
			}
			if (e.name === "up") {
				e.preventDefault();
				setSelectedIdx((i) => (i > 0 ? i - 1 : filtered.length - 1));
				return;
			}
			if (e.name === "down") {
				e.preventDefault();
				setSelectedIdx((i) =>
					i < filtered.length - 1 ? i + 1 : 0
				);
				return;
			}
			if (e.name === "return") {
				e.preventDefault();
				if (filtered.length > 0) {
					selectSuggestion(filtered[selectedIdx].name);
				}
				return;
			}
			// Tab completes with the currently selected suggestion
			if (e.name === "tab") {
				e.preventDefault();
				if (filtered.length > 0) {
					selectSuggestion(filtered[selectedIdx].name);
				}
				return;
			}
			// Non-special keys (letters, numbers, backspace, etc.)
			// — let them pass through to the <input> component
			return;
		}

		// --- Normal mode ---
		// Submit on Enter (without shift)
		if (e.name === "return" && !e.shift) {
			e.preventDefault();
			const trimmed = inputText.trim();
			if (trimmed) {
				onSend(trimmed);
				setInputText("");
				// Clear the input renderable's internal text
				if (inputRef.current && !inputRef.current.isDestroyed) {
					inputRef.current.setText("");
				}
			}
			return;
		}

		// Escape clears input
		if (e.name === "escape") {
			e.preventDefault();
			if (inputText) {
				setInputText("");
				if (inputRef.current && !inputRef.current.isDestroyed) {
					inputRef.current.setText("");
				}
			}
			return;
		}

		// @ detection is now handled in handleInput (value-based, not key-event).
		// All other keys pass through to the <input> component naturally.
	});

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

			{/* ── Suggestion panel ── */}
			{activeMode ? (
				<box
					width="100%"
					flexDirection="column"
					flexShrink={0}
					backgroundColor={theme.bgElevated}
				>
					<box
						width="100%"
						flexDirection="row"
						paddingLeft={1}
						paddingRight={1}
						flexShrink={0}
					>
						<text fg={theme.textMuted}>
							{activeMode === "slash"
								? "Commands"
								: "Memory"}
						</text>
						<box flexGrow={1} />
						<text fg={theme.textMuted}>
							{filtered.length}
						</text>
					</box>
					{filtered.map((item, i) => (
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

				<text fg={theme.textMuted} flexShrink={0}>
					{"›"}
				</text>

				{/* Text input */}
				<box flexGrow={1} flexShrink={1}>
					<input
						width="100%"
						placeholder="type here..."
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
