import { describe, expect, test } from "vitest";
import { BUILTIN_SLASH_COMMANDS } from "../src/core/slash-commands.ts";
import { getTuiSlashCommandsByMode, TUI_SLASH_COMMANDS } from "../src/tui/command-registry.ts";

describe("TUI_SLASH_COMMANDS", () => {
	test("contains every executable built-in command for autocomplete", () => {
		const names = TUI_SLASH_COMMANDS.map((command) => command.name);

		for (const command of BUILTIN_SLASH_COMMANDS) {
			expect(names).toContain(`/${command.name}`);
		}
	});

	test("contains the executable Memorix memory subcommands", () => {
		const names = TUI_SLASH_COMMANDS.map((command) => command.name);

		expect(names).toContain("/memory status");
		expect(names).toContain("/memory stats");
		expect(names).toContain("/memory hooks");
		expect(names).toContain("/memory search");
		expect(names).toContain("/memory show");
		expect(names).toContain("/memory diff");
		expect(names).toContain("/memory promote");
		expect(names).toContain("/memory delete");
	});

	test("does not advertise legacy commands that interactive mode cannot execute", () => {
		const names = new Set(TUI_SLASH_COMMANDS.map((command) => command.name));

		for (const staleCommand of [
			"/clear",
			"/help",
			"/config",
			"/exit",
			"/git status",
			"/git diff",
			"/git commit",
			"/model switch",
			"/remember",
			"/session export",
		]) {
			expect(names.has(staleCommand)).toBe(false);
		}
	});

	test("does not register duplicate TUI slash command names", () => {
		const names = TUI_SLASH_COMMANDS.map((command) => command.name);
		expect(new Set(names).size).toBe(names.length);
	});

	test("can filter TUI slash commands by mode from the shared registry", () => {
		expect(getTuiSlashCommandsByMode("no-arg").some((command) => command.name === "/memory hooks")).toBe(true);
		expect(getTuiSlashCommandsByMode("selector").some((command) => command.name === "/settings")).toBe(true);
		expect(getTuiSlashCommandsByMode("text-input").some((command) => command.name === "/memory search")).toBe(
			true,
		);
		expect(getTuiSlashCommandsByMode("text-input").some((command) => command.name === "/memory delete")).toBe(
			true,
		);
	});
});
