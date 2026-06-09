/**
 * StatusBar - dynamic thinking/status indicator.
 *
 * Displays a spinning status message between messages.
 * Hidden when status is empty; first token arrival clears it.
 */

import { useEffect, useState } from "react";
import { theme } from "../theme.ts";

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const SPINNER_INTERVAL = 80;

interface StatusBarProps {
	status: string;
}

function StatusBar({ status }: StatusBarProps) {
	const [frame, setFrame] = useState(0);

	useEffect(() => {
		if (!status) return;

		const interval = setInterval(() => {
			setFrame((f) => (f + 1) % SPINNER_FRAMES.length);
		}, SPINNER_INTERVAL);

		return () => clearInterval(interval);
	}, [status]);

	if (!status) return null;

	return (
		<box paddingLeft={1} paddingRight={1}>
			<text fg={theme.warning}>
				{SPINNER_FRAMES[frame]} {status}
			</text>
		</box>
	);
}

export { StatusBar };
export type { StatusBarProps };
