import { describe, expect, test, vi } from "vitest";
import {
	ActivityStatus,
	formatActivityCompletion,
	renderActivityText,
} from "../src/modes/interactive/components/activity-status.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";

function stripAnsi(text: string): string {
	return text.replace(/\u001b\[[0-9;]*m/g, "");
}

describe("ActivityStatus", () => {
	test("renders an animated activity word with elapsed thinking metadata", () => {
		initTheme("dark");

		const rendered = stripAnsi(
			renderActivityText({
				word: "Thundering",
				frame: 2,
				elapsedMs: 5000,
				thinking: true,
				outputTokens: 28,
			}),
		);

		expect(rendered).toBe("✶ Thundering... (5s · ↓ 28 tokens · thinking)");
	});

	test("formats the persistent completion line with only duration", () => {
		initTheme("dark");

		const rendered = stripAnsi(
			formatActivityCompletion({
				word: "Cooked",
				durationMs: 12_200,
			}),
		);

		expect(rendered).toBe("✻ Cooked for 12s");
	});

	test("requests renders while the wave advances", () => {
		initTheme("dark");
		vi.useFakeTimers();
		vi.setSystemTime(0);
		const ui = { requestRender: vi.fn() };
		const status = new ActivityStatus(ui, { word: "Brewing", intervalMs: 80 });

		status.start();
		expect(ui.requestRender).toHaveBeenCalledTimes(1);

		vi.advanceTimersByTime(80);
		expect(ui.requestRender).toHaveBeenCalledTimes(2);

		status.stop();
		vi.useRealTimers();
	});

	test("updates token metadata while running and replaces itself on completion", () => {
		initTheme("dark");
		vi.useFakeTimers();
		vi.setSystemTime(0);
		const ui = { requestRender: vi.fn() };
		const status = new ActivityStatus(ui, { word: "Brewing", intervalMs: 80 });

		status.start();
		status.setThinking(true);
		status.setOutputTokens(147);
		expect(stripAnsi(status.render(120).join("\n"))).toContain("Brewing... (0s · ↓ 147 tokens · thinking)");

		vi.setSystemTime(5000);
		status.complete({ word: "Distilled", durationMs: 5000 });

		expect(stripAnsi(status.render(120).join("\n"))).toContain("✻ Distilled for 5s");
		expect(stripAnsi(status.render(120).join("\n"))).not.toContain("Brewing");
		expect(stripAnsi(status.render(120).join("\n"))).not.toContain("tokens");
		expect(stripAnsi(status.render(120).join("\n"))).not.toContain("thinking");

		status.stop();
		vi.useRealTimers();
	});
});
