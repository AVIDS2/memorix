/**
 * StatusBar - clean split footer with model info and keyboard hints.
 *
 * Layout:
 *   <model> · <thinking>               esc  ctrl+c
 *
 * Left side: model name + thinking level (theme.textSecondary)
 * Right side: keyboard shortcuts (theme.textMuted)
 * Status messages (Thinking..., Using tool...) are rendered ABOVE
 * the footer by the parent App component.
 */

import { theme } from "../theme.ts";

interface StatusBarProps {
	model?: string;
	thinkingLevel?: string;
}

function StatusBar({ model, thinkingLevel }: StatusBarProps) {
	const left = [model, thinkingLevel].filter(Boolean).join(" · ");
	const right = "esc  ctrl+c";

	return (
		<box
			height={1}
			paddingLeft={1}
			paddingRight={1}
			flexDirection="row"
		>
			<text fg={theme.textSecondary}>{left || " "}</text>
			<box flexGrow={1} />
			<text fg={theme.textMuted}>{right}</text>
		</box>
	);
}

export { StatusBar };
export type { StatusBarProps };
