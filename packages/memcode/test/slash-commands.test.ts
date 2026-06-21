import { describe, expect, test } from "vitest";
import { BUILTIN_SLASH_COMMANDS } from "../src/core/slash-commands.ts";
import { getTuiSlashCommandRows } from "../src/tui/command-registry.ts";

describe("BUILTIN_SLASH_COMMANDS", () => {
	test("includes a discoverable commands index", () => {
		const commands = BUILTIN_SLASH_COMMANDS.map((command) => command.name);

		expect(commands).toContain("commands");
	});

	test("keeps the Pi-style command surface broad enough for normal agent use", () => {
		expect(BUILTIN_SLASH_COMMANDS.length).toBeGreaterThanOrEqual(24);
	});

	test("does not register duplicate built-in command names", () => {
		const names = BUILTIN_SLASH_COMMANDS.map((command) => command.name);
		expect(new Set(names).size).toBe(names.length);
	});

	test("keeps TUI-only discoverability commands separate from legacy built-ins", () => {
		const builtinNames = new Set(BUILTIN_SLASH_COMMANDS.map((command) => `/${command.name}`));
		const tuiRows = getTuiSlashCommandRows();

		expect(tuiRows.some((row) => row.name === "/memory hooks")).toBe(true);
		expect(tuiRows.some((row) => row.name === "/git status")).toBe(true);
		expect(builtinNames.has("/memory")).toBe(true);
		expect(builtinNames.has("/memory hooks")).toBe(false);
	});
});
