import { describe, expect, it, vi } from "vitest";
import { getSuggestionMouseProps } from "../src/tui/suggestion-mouse.ts";

describe("getSuggestionMouseProps", () => {
	it("does not add mouse handlers unless mouse mode is enabled", () => {
		const props = getSuggestionMouseProps({
			enabled: false,
			index: 2,
			name: "/model",
			selectSuggestion: vi.fn(),
			setSelectedIdx: vi.fn(),
		});

		expect(props).toEqual({});
	});

	it("adds suggestion mouse handlers when mouse mode is enabled", () => {
		const selectSuggestion = vi.fn();
		const setSelectedIdx = vi.fn();
		const props = getSuggestionMouseProps({
			enabled: true,
			index: 2,
			name: "/model",
			selectSuggestion,
			setSelectedIdx,
		});

		props.onMouseOver?.();
		props.onMouseUp?.();

		expect(setSelectedIdx).toHaveBeenCalledWith(2);
		expect(selectSuggestion).toHaveBeenCalledWith("/model");
	});
});
