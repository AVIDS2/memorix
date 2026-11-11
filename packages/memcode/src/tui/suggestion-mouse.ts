import { shouldEnableMouseReporting } from "@memorix/tui";

export interface SuggestionMousePropsOptions {
	enabled?: boolean;
	index: number;
	name: string;
	selectSuggestion: (name: string) => void;
	setSelectedIdx: (index: number) => void;
}

export interface SuggestionMouseProps {
	onMouseUp?: () => void;
	onMouseOver?: () => void;
}

export function getSuggestionMouseProps(options: SuggestionMousePropsOptions): SuggestionMouseProps {
	const enabled = options.enabled ?? shouldEnableMouseReporting();
	if (!enabled) {
		return {};
	}

	return {
		onMouseOver: () => options.setSelectedIdx(options.index),
		onMouseUp: () => options.selectSuggestion(options.name),
	};
}
