import { describe, expect, it } from "vitest";
import { shouldUseExperimentalTui } from "../src/cli/interactive-ui-mode.ts";

describe("shouldUseExperimentalTui", () => {
	it("defaults to the legacy Pi interactive mode", () => {
		expect(shouldUseExperimentalTui({})).toBe(false);
	});

	it("enables the experimental TUI when MEMCODE_EXPERIMENTAL_TUI is truthy", () => {
		expect(shouldUseExperimentalTui({ MEMCODE_EXPERIMENTAL_TUI: "1" })).toBe(true);
		expect(shouldUseExperimentalTui({ MEMCODE_EXPERIMENTAL_TUI: "true" })).toBe(true);
		expect(shouldUseExperimentalTui({ MEMCODE_EXPERIMENTAL_TUI: "yes" })).toBe(true);
	});

	it("supports the legacy PI_EXPERIMENTAL_TUI env var as a fallback", () => {
		expect(shouldUseExperimentalTui({ PI_EXPERIMENTAL_TUI: "1" })).toBe(true);
	});

	it("treats explicit falsey values as disabled", () => {
		expect(shouldUseExperimentalTui({ MEMCODE_EXPERIMENTAL_TUI: "0" })).toBe(false);
		expect(shouldUseExperimentalTui({ MEMCODE_EXPERIMENTAL_TUI: "false" })).toBe(false);
	});

	it("keeps the legacy interactive mode as the release default unless explicitly opted in", () => {
		expect(shouldUseExperimentalTui({ MEMCODE_EXPERIMENTAL_TUI: undefined, PI_EXPERIMENTAL_TUI: undefined })).toBe(
			false,
		);
	});
});
