import { describe, expect, test } from "vitest";
import { StartupWelcomeCard } from "../src/modes/interactive/components/startup-welcome-card.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

function renderCard(width = 110): string {
	initTheme("dark");
	const card = new StartupWelcomeCard({
		appName: "memcode",
		version: "1.0.11",
		getProjectLabel: () => "E:\\project\\memorix",
		getModelLabel: () => "deepseek/deepseek-v4-pro · thinking high",
		getDetailsKey: () => "ctrl+o",
		compactInstructions: "ctrl+c to interrupt",
		expandedInstructions: "ctrl+o to expand details",
	});

	return stripAnsi(card.render(width).join("\n"));
}

describe("StartupWelcomeCard", () => {
	test("orients users with agent status, commands, and Memorix state", () => {
		const rendered = renderCard();

		expect(rendered).toContain("Ready when you are");
		expect(rendered).toContain("deepseek/deepseek-v4-pr");
		expect(rendered).toContain("project E:\\project\\memorix");
		expect(rendered).toContain("Start here");
		expect(rendered).toContain("/commands");
		expect(rendered).toContain("Memorix native");
		expect(rendered).toContain("/memory hooks");
	});

	test("keeps the startup mascot compact", () => {
		const rendered = renderCard();
		const widestMascotLine = rendered
			.split("\n")
			.filter((line) => line.includes("▄") || line.includes("▀"))
			.reduce((max, line) => {
				const runs = line.match(/[▄▀]+/g) ?? [];
				return Math.max(max, ...runs.map((run) => run.length));
			}, 0);

		expect(widestMascotLine).toBeLessThanOrEqual(32);
	});
});
