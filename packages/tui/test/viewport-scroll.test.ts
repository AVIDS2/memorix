import assert from "node:assert";
import { describe, it } from "node:test";
import type { Component } from "../src/tui.ts";
import { TUI } from "../src/tui.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

class LinesComponent implements Component {
	lines: string[];

	constructor(lines: string[]) {
		this.lines = lines;
	}

	render(): string[] {
		return this.lines;
	}

	invalidate(): void {}
}

describe("TUI viewport scrolling", () => {
	it("renders older lines when scrolled up and returns to bottom when reset", async () => {
		const terminal = new VirtualTerminal(20, 4);
		const tui = new TUI(terminal);
		const component = new LinesComponent([
			"Line 0",
			"Line 1",
			"Line 2",
			"Line 3",
			"Line 4",
			"Line 5",
			"Line 6",
			"Line 7",
		]);
		tui.addChild(component);
		tui.start();
		await terminal.waitForRender();

		let viewport = terminal.getViewport().join("\n");
		assert.match(viewport, /Line 4/);
		assert.match(viewport, /Line 7/);

		tui.scrollViewportBy(2);
		await terminal.waitForRender();
		viewport = terminal.getViewport().join("\n");
		assert.match(viewport, /Line 2/);
		assert.match(viewport, /Line 5/);
		assert.ok(!viewport.includes("Line 7"));

		tui.resetViewportScroll();
		await terminal.waitForRender();
		viewport = terminal.getViewport().join("\n");
		assert.match(viewport, /Line 4/);
		assert.match(viewport, /Line 7/);

		tui.stop();
	});
});
