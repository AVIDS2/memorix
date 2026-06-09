/**
 * StatusBar - dynamic thinking/status indicator with vim mode display.
 *
 * Displays a spinning status message between messages.
 * Shows the current vim mode (INSERT/NORMAL/VISUAL) in a badge when
 * vim mode is active. In COMMAND_LINE mode, shows the : command buffer.
 * Hidden when status is empty and mode is INSERT.
 */

import { useEffect, useState } from "react";
import { createTextAttributes } from "@opentui/core";
import type { VimMode } from "../keymap.ts";
import { theme } from "../theme.ts";

const SPINNER_FRAMES = ["\u{280B}", "\u{2819}", "\u{2839}", "\u{2838}", "\u{283C}", "\u{2834}", "\u{2826}", "\u{2827}", "\u{2807}", "\u{280F}"];
const SPINNER_INTERVAL = 80;
const BOLD = createTextAttributes({ bold: true });

interface StatusBarProps {
	status: string;
	/** Current vim mode. When NORMAL or VISUAL, displays a mode badge. */
	vimMode?: VimMode;
	/** Command-line buffer content (shown in COMMAND_LINE mode). */
	cmdLineBuffer?: string;
}

const MODE_COLORS: Record<VimMode, string> = {
	INSERT: theme.success,
	NORMAL: theme.info,
	VISUAL: theme.warning,
	COMMAND_LINE: theme.brand,
};

const MODE_LABELS: Record<VimMode, string> = {
	INSERT: "-- INSERT --",
	NORMAL: "-- NORMAL --",
	VISUAL: "-- VISUAL --",
	COMMAND_LINE: "",
};

function StatusBar({ status, vimMode, cmdLineBuffer }: StatusBarProps) {
	const [frame, setFrame] = useState(0);

	useEffect(() => {
		if (!status) return;

		const interval = setInterval(() => {
			setFrame((f) => (f + 1) % SPINNER_FRAMES.length);
		}, SPINNER_INTERVAL);

		return () => clearInterval(interval);
	}, [status]);

	const showStatus = !!status;
	const showMode = vimMode && vimMode !== "INSERT";
	const isCommandLine = vimMode === "COMMAND_LINE";

	if (!showStatus && !showMode) return null;

	return (
		<box paddingLeft={1} paddingRight={1} flexDirection="row" gap={1}>
			{/* Vim mode badge */}
			{showMode && !isCommandLine ? (
				<text fg={MODE_COLORS[vimMode]} attributes={BOLD}>
					{MODE_LABELS[vimMode]}
				</text>
			) : null}

			{/* Command-line buffer display */}
			{isCommandLine ? (
				<text fg={theme.brand}>
					{cmdLineBuffer || "/"}
					<text fg={theme.textMuted}>{"\u{2502}"}</text>
				</text>
			) : null}

			{/* Status spinner */}
			{showStatus ? (
				<text fg={theme.warning}>
					{SPINNER_FRAMES[frame]} {status}
				</text>
			) : null}
		</box>
	);
}

export { StatusBar };
export type { StatusBarProps };
