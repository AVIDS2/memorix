/**
 * ToolCallBlock - expandable tool call display for the memcode TUI.
 *
 * Renders tool call invocations with three states: running, done, error.
 * Collapsed by default; expandable via Space/Tab or mouse click.
 *
 * Layout (collapsed):
 *   ✓ bash  0.3s  ▸
 *
 * Layout (expanded):
 *   ✓ bash  0.3s  ▾
 *     $ echo hello
 *     hello
 */

import { useEffect, useState, useCallback } from "react";
import { SyntaxStyle } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { theme } from "../theme.ts";

const syntaxStyle = SyntaxStyle.create();

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const SPINNER_INTERVAL = 80;

// ============================================================================
// Types
// ============================================================================

interface ToolCallBlockProps {
	name: string;
	input: any;
	result?: string;
	status: "running" | "done" | "error";
	duration?: number;
}

// ============================================================================
// Helpers
// ============================================================================

function formatDuration(seconds: number): string {
	if (seconds < 1) return `${Math.round(seconds * 1000)}ms`;
	return `${seconds.toFixed(1)}s`;
}

function formatInput(input: any): string {
	if (typeof input === "string") return input;
	try {
		return JSON.stringify(input, null, 2);
	} catch {
		return String(input);
	}
}

// ============================================================================
// Components
// ============================================================================

function StatusIcon({ status }: { status: "running" | "done" | "error" }) {
	const [frame, setFrame] = useState(0);

	useEffect(() => {
		if (status !== "running") return;
		const interval = setInterval(() => {
			setFrame((f) => (f + 1) % SPINNER_FRAMES.length);
		}, SPINNER_INTERVAL);
		return () => clearInterval(interval);
	}, [status]);

	if (status === "running") return <text fg={theme.warning}>{SPINNER_FRAMES[frame]}</text>;
	if (status === "done") return <text fg={theme.success}>{"✓"}</text>;
	return <text fg={theme.error}>{"✗"}</text>;
}

// ============================================================================
// ToolCallBlock
// ============================================================================

function ToolCallBlock({ name, input, result, status, duration }: ToolCallBlockProps) {
	const [expanded, setExpanded] = useState(false);

	const toggle = useCallback(() => {
		setExpanded((prev) => !prev);
	}, []);

	useKeyboard((e) => {
		if (e.name === "space" || e.name === "tab") {
			e.preventDefault();
			toggle();
		}
	});

	const statusColor = status === "error" ? theme.error : theme.textSecondary;
	const caret = expanded ? "▽" : "▷";

	return (
		<box flexDirection="column" paddingLeft={1} paddingRight={1}>
			{/* ── Header row ── */}
			<box
				flexDirection="row"
				alignItems="center"
				gap={1}
				onMouseUp={toggle}
			>
				<StatusIcon status={status} />
				<text>
					<b fg={theme.textPrimary}>{name}</b>
				</text>
				{duration != null && (
					<text fg={statusColor}>{formatDuration(duration)}</text>
				)}
				<text fg={theme.textMuted}>{caret}</text>
			</box>

			{/* ── Expanded details ── */}
			{expanded && (
				<box flexDirection="column" paddingLeft={2} paddingTop={1}>
					{/* Input params */}
					<code
						content={formatInput(input)}
						syntaxStyle={syntaxStyle}
						drawUnstyledText
					/>

					{/* Result */}
					{result != null && (
						<box paddingTop={1}>
							<text
								fg={status === "error" ? theme.error : theme.textSecondary}
							>
								{result}
							</text>
						</box>
					)}
				</box>
			)}
		</box>
	);
}

// ============================================================================
// Exports
// ============================================================================

export { ToolCallBlock };
export type { ToolCallBlockProps };
