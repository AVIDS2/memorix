import { describe, expect, test } from "vitest";
import { BUILTIN_SLASH_COMMANDS } from "../src/core/slash-commands.ts";
import { getTuiSlashCommandsByMode, TUI_SLASH_COMMANDS } from "../src/tui/command-registry.ts";

describe("TUI_SLASH_COMMANDS", () => {
	test("contains the shared TUI-discoverable memory, git, and session commands", () => {
		const names = TUI_SLASH_COMMANDS.map((command) => command.name);

		expect(names).toContain("/memory hooks");
		expect(names).toContain("/git status");
		expect(names).toContain("/session export");
	});

	test("stays aligned with the built-in interactive command surface for core slash commands", () => {
		const builtinNames = new Set(BUILTIN_SLASH_COMMANDS.map((command) => `/${command.name}`));

		expect(builtinNames.has("/memory")).toBe(true);
		expect(builtinNames.has("/session")).toBe(true);
		expect(builtinNames.has("/model")).toBe(true);
		expect(builtinNames.has("/tree")).toBe(true);
	});

	test("does not register duplicate TUI slash command names", () => {
		const names = TUI_SLASH_COMMANDS.map((command) => command.name);
		expect(new Set(names).size).toBe(names.length);
	});

	test("can filter TUI slash commands by mode from the shared registry", () => {
		expect(getTuiSlashCommandsByMode("no-arg").some((command) => command.name === "/memory hooks")).toBe(true);
		expect(getTuiSlashCommandsByMode("selector").some((command) => command.name === "/memory show")).toBe(true);
		expect(getTuiSlashCommandsByMode("text-input").some((command) => command.name === "/memory search")).toBe(
			true,
		);
	});
});
