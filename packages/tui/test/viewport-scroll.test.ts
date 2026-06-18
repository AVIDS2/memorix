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

	it("keeps the same viewport anchored while content grows above the live bottom", async () => {
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

		tui.scrollViewportBy(2);
		await terminal.waitForRender();
		const anchoredViewport = terminal.getViewport().join("\n");
		assert.match(anchoredViewport, /Line 2/);
		assert.match(anchoredViewport, /Line 5/);

		component.lines.push("Line 8", "Line 9");
		tui.requestRender();
		await terminal.waitForRender();

		const viewportAfterAppend = terminal.getViewport().join("\n");
		assert.equal(viewportAfterAppend, anchoredViewport);
		assert.ok(!terminal.getOutput().includes("\x1b[3J"));

		tui.stop();
	});

	it("keeps full content history across consecutive manual scroll ticks", async () => {
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
			"Line 8",
			"Line 9",
			"Line 10",
			"Line 11",
		]);
		tui.addChild(component);
		tui.start();
		await terminal.waitForRender();

		tui.scrollViewportBy(2);
		await terminal.waitForRender();
		assert.match(terminal.getViewport().join("\n"), /Line 6/);

		tui.scrollViewportBy(1);
		await terminal.waitForRender();
		const viewport = terminal.getViewport().join("\n");

		assert.match(viewport, /Line 5/);
		assert.ok(!viewport.includes("Line 0"), `viewport jumped to top:\n${viewport}`);

		tui.stop();
	});

	it("does not replay the top of the transcript while rendering anchored scroll updates", async () => {
		const terminal = new VirtualTerminal(20, 4);
		const tui = new TUI(terminal);
		const component = new LinesComponent([
			"Welcome card",
			"Startup diagnostics",
			"Prompt 1",
			"Response 1",
			"Prompt 2",
			"Response 2",
			"Prompt 3",
			"Response 3",
		]);
		tui.addChild(component);
		tui.start();
		await terminal.waitForRender();

		tui.scrollViewportBy(2);
		await terminal.waitForRender();
		terminal.clearOutput();

		component.lines.push("Streaming response line");
		tui.requestRender();
		await terminal.waitForRender();

		const output = terminal.getOutput();
		assert.ok(!output.includes("Welcome card"), `scroll update replayed startup content:\n${output}`);
		assert.ok(!output.includes("Startup diagnostics"), `scroll update replayed startup diagnostics:\n${output}`);

		tui.stop();
	});

	it("manual scroll redraws do not append old frames into terminal scrollback", async () => {
		const terminal = new VirtualTerminal(20, 4);
		const tui = new TUI(terminal);
		const component = new LinesComponent([
			"Welcome card",
			"Startup diagnostics",
			"Prompt 1",
			"Response 1",
			"Prompt 2",
			"Response 2",
			"Prompt 3",
			"Response 3",
		]);
		tui.addChild(component);
		tui.start();
		await terminal.waitForRender();

		terminal.clearOutput();
		tui.scrollViewportBy(2);
		await terminal.waitForRender();

		const output = terminal.getOutput();
		assert.ok(!output.includes("\r\nWelcome card"), `manual scroll replayed full transcript:\n${output}`);
		assert.ok(!output.includes("\r\nStartup diagnostics"), `manual scroll replayed startup diagnostics:\n${output}`);

		tui.stop();
	});

	it("forced redraw clears in place instead of appending the full transcript", async () => {
		const terminal = new VirtualTerminal(20, 4);
		const tui = new TUI(terminal);
		const component = new LinesComponent([
			"Welcome card",
			"Startup diagnostics",
			"Prompt 1",
			"Response 1",
			"Prompt 2",
			"Response 2",
			"Prompt 3",
			"Response 3",
		]);
		tui.addChild(component);
		tui.start();
		await terminal.waitForRender();

		terminal.clearOutput();
		tui.requestRender(true);
		await terminal.waitForRender();

		const output = terminal.getOutput();
		assert.ok(output.includes("\x1b[2J\x1b[H"), `forced redraw did not clear/home first:\n${output}`);
		assert.ok(!output.includes("\r\nWelcome card"), `forced redraw appended startup content:\n${output}`);
		assert.ok(!output.includes("\r\nStartup diagnostics"), `forced redraw appended startup diagnostics:\n${output}`);

		tui.stop();
	});
});
