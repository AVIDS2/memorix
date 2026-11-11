import assert from "node:assert";
import { describe, it, mock } from "node:test";
import { setKittyProtocolActive } from "../src/keys.ts";
import {
	normalizeAppleTerminalInput,
	ProcessTerminal,
	shouldEnableMouseReporting,
	shouldUseAlternateScreen,
} from "../src/terminal.ts";

describe("normalizeAppleTerminalInput", () => {
	it("rewrites Apple Terminal Return to CSI-u Shift+Enter when Shift is pressed", () => {
		assert.equal(normalizeAppleTerminalInput("\r", true, true), "\x1b[13;2u");
	});

	it("leaves Apple Terminal Return unchanged when Shift is not pressed", () => {
		assert.equal(normalizeAppleTerminalInput("\r", true, false), "\r");
	});

	it("leaves non-Apple Terminal Return unchanged when Shift is pressed", () => {
		assert.equal(normalizeAppleTerminalInput("\r", false, true), "\r");
	});

	it("leaves non-Return input unchanged", () => {
		assert.equal(normalizeAppleTerminalInput("\x1b[13;2u", true, true), "\x1b[13;2u");
		assert.equal(normalizeAppleTerminalInput("a", true, true), "a");
	});
});

describe("ProcessTerminal Kitty keyboard protocol negotiation", () => {
	type NegotiationHarness = {
		terminal: ProcessTerminal;
		writes: string[];
		send(data: string): void;
		getInput(): string | undefined;
		cleanup(): void;
	};

	function setupNegotiation(): NegotiationHarness {
		const terminal = new ProcessTerminal();
		const writes: string[] = [];
		let input: string | undefined;
		let dataHandler: ((data: string) => void) | undefined;
		let cleaned = false;
		const previousWrite = process.stdout.write;
		const previousOn = process.stdin.on;

		process.stdout.write = ((chunk: string | Uint8Array) => {
			writes.push(String(chunk));
			return true;
		}) as typeof process.stdout.write;
		process.stdin.on = ((event: string | symbol, listener: (...args: unknown[]) => void) => {
			if (event === "data") dataHandler = listener as (data: string) => void;
			return process.stdin;
		}) as typeof process.stdin.on;

		(
			terminal as unknown as {
				inputHandler?: (data: string) => void;
				queryAndEnableKittyProtocol(): void;
			}
		).inputHandler = (data) => {
			input = data;
		};
		(terminal as unknown as { queryAndEnableKittyProtocol(): void }).queryAndEnableKittyProtocol();

		return {
			terminal,
			writes,
			send(data: string): void {
				dataHandler?.(data);
			},
			getInput(): string | undefined {
				return input;
			},
			cleanup(): void {
				if (cleaned) return;
				cleaned = true;
				try {
					terminal.stop();
				} finally {
					process.stdout.write = previousWrite;
					process.stdin.on = previousOn;
					setKittyProtocolActive(false);
				}
			},
		};
	}

	it("queries Kitty mode before enabling modifyOtherKeys fallback", () => {
		const harness = setupNegotiation();
		try {
			assert.equal(harness.writes[0], "\x1b[>7u\x1b[?u\x1b[c");
			assert.equal(harness.writes.includes("\x1b[>4;2m"), false);
			assert.equal(harness.terminal.kittyProtocolActive, false);
		} finally {
			harness.cleanup();
		}
	});

	it("activates Kitty mode for non-zero negotiated flags", () => {
		const harness = setupNegotiation();
		try {
			harness.send("\x1b[?7u");

			assert.equal(harness.getInput(), undefined);
			assert.equal(harness.terminal.kittyProtocolActive, true);
			assert.equal(harness.writes.includes("\x1b[>4;2m"), false);
			assert.equal(harness.writes.includes("\x1b[>4;0m"), false);

			harness.cleanup();
			assert.equal(harness.writes.filter((write) => write === "\x1b[<u").length, 1);
			assert.equal(harness.writes.includes("\x1b[>4;0m"), false);
		} finally {
			harness.cleanup();
		}
	});

	it("falls back to modifyOtherKeys for zero Kitty flags", () => {
		const harness = setupNegotiation();
		try {
			harness.send("\x1b[?0u");

			assert.equal(harness.getInput(), undefined);
			assert.equal(harness.terminal.kittyProtocolActive, false);
			assert.equal(harness.writes.filter((write) => write === "\x1b[>4;2m").length, 1);

			harness.cleanup();
			assert.equal(harness.writes.filter((write) => write === "\x1b[>4;0m").length, 1);
		} finally {
			harness.cleanup();
		}
	});

	it("falls back to modifyOtherKeys for device attributes without Kitty flags", () => {
		const harness = setupNegotiation();
		try {
			harness.send("\x1b[?62;4;52c");

			assert.equal(harness.getInput(), undefined);
			assert.equal(harness.terminal.kittyProtocolActive, false);
			assert.equal(harness.writes.filter((write) => write === "\x1b[>4;2m").length, 1);
		} finally {
			harness.cleanup();
		}
	});

	it("forwards normal input while waiting for Kitty response", () => {
		const harness = setupNegotiation();
		try {
			harness.send("a");

			assert.equal(harness.getInput(), "a");
			assert.equal(harness.terminal.kittyProtocolActive, false);
		} finally {
			harness.cleanup();
		}
	});

	it("tracks split Kitty confirmation", () => {
		mock.timers.enable({ apis: ["setTimeout"] });
		const harness = setupNegotiation();
		try {
			harness.send("\x1b[?7");
			mock.timers.tick(10);

			assert.equal(harness.getInput(), undefined);

			harness.send("u");

			assert.equal(harness.terminal.kittyProtocolActive, true);
			assert.equal(harness.writes.includes("\x1b[>4;2m"), false);
		} finally {
			harness.cleanup();
			mock.timers.reset();
		}
	});

	it("replays buffered CSI-prefix input when it is not a Kitty response", () => {
		mock.timers.enable({ apis: ["setTimeout"] });
		const harness = setupNegotiation();
		try {
			harness.send("\x1b[");
			mock.timers.tick(10);

			assert.equal(harness.getInput(), undefined);

			mock.timers.tick(150);

			assert.equal(harness.getInput(), "\x1b[");
		} finally {
			harness.cleanup();
			mock.timers.reset();
		}
	});
});

describe("ProcessTerminal mouse reporting", () => {
	it("uses an explicit opt-in environment flag", () => {
		assert.equal(shouldEnableMouseReporting({}), false);
		assert.equal(shouldEnableMouseReporting({ MEMCODE_TUI_MOUSE: "1" }), true);
		assert.equal(shouldEnableMouseReporting({ MEMCODE_TUI_MOUSE: "true" }), true);
		assert.equal(shouldEnableMouseReporting({ MEMCODE_TUI_MOUSE: "yes" }), true);
		assert.equal(shouldEnableMouseReporting({ PI_TUI_MOUSE: "1" }), true);
		assert.equal(shouldEnableMouseReporting({ MEMCODE_TUI_MOUSE: "0", PI_TUI_MOUSE: "1" }), false);
	});

	it("does not enable mouse reporting by default so terminal text selection still works", () => {
		const writes: string[] = [];
		const terminal = new ProcessTerminal();
		const previousWrite = process.stdout.write;

		try {
			process.stdout.write = ((chunk: string | Uint8Array) => {
				writes.push(String(chunk));
				return true;
			}) as typeof process.stdout.write;

			(terminal as unknown as { inputHandler?: (data: string) => void }).inputHandler = () => {};
			terminal.start(() => {}, () => {});

			assert.equal(writes.includes("\x1b[?1000h\x1b[?1006h"), false);
		} finally {
			terminal.stop();
			process.stdout.write = previousWrite;
		}
	});

	it("enables mouse reporting only when explicitly requested", () => {
		const writes: string[] = [];
		const previousWrite = process.stdout.write;
		const previousEnv = process.env.MEMCODE_TUI_MOUSE;
		let terminal: ProcessTerminal | undefined;

		try {
			process.env.MEMCODE_TUI_MOUSE = "1";
			terminal = new ProcessTerminal();
			process.stdout.write = ((chunk: string | Uint8Array) => {
				writes.push(String(chunk));
				return true;
			}) as typeof process.stdout.write;

			(terminal as unknown as { inputHandler?: (data: string) => void }).inputHandler = () => {};
			terminal.start(() => {}, () => {});

			assert.equal(writes.includes("\x1b[?1000h\x1b[?1006h"), true);
		} finally {
			terminal?.stop();
			process.stdout.write = previousWrite;
			if (previousEnv === undefined) delete process.env.MEMCODE_TUI_MOUSE;
			else process.env.MEMCODE_TUI_MOUSE = previousEnv;
		}
	});
});

describe("ProcessTerminal alternate screen", () => {
	it("does not use alternate screen by default so terminal scrollback can handle wheel scrolling", () => {
		assert.equal(shouldUseAlternateScreen({}), false);
	});

	it("uses alternate screen only for explicit fullscreen or mouse modes", () => {
		assert.equal(shouldUseAlternateScreen({ MEMCODE_TUI_ALT_SCREEN: "1" }), true);
		assert.equal(shouldUseAlternateScreen({ PI_TUI_ALT_SCREEN: "1" }), true);
		assert.equal(shouldUseAlternateScreen({ MEMCODE_TUI_MOUSE: "1" }), true);
		assert.equal(shouldUseAlternateScreen({ MEMCODE_TUI_ALT_SCREEN: "0", PI_TUI_ALT_SCREEN: "1" }), false);
	});

	it("does not enter or leave alternate screen by default", () => {
		const writes: string[] = [];
		const terminal = new ProcessTerminal();
		const previousWrite = process.stdout.write;

		try {
			process.stdout.write = ((chunk: string | Uint8Array) => {
				writes.push(String(chunk));
				return true;
			}) as typeof process.stdout.write;

			terminal.start(() => {}, () => {});
			terminal.stop();

			assert.equal(writes.includes("\x1b[?1049h"), false);
			assert.equal(writes.includes("\x1b[?1049l"), false);
		} finally {
			process.stdout.write = previousWrite;
		}
	});

	it("enters and leaves alternate screen when explicitly requested", () => {
		const writes: string[] = [];
		const previousWrite = process.stdout.write;
		const previousEnv = process.env.MEMCODE_TUI_ALT_SCREEN;
		let terminal: ProcessTerminal | undefined;

		try {
			process.env.MEMCODE_TUI_ALT_SCREEN = "1";
			terminal = new ProcessTerminal();
			process.stdout.write = ((chunk: string | Uint8Array) => {
				writes.push(String(chunk));
				return true;
			}) as typeof process.stdout.write;

			terminal.start(() => {}, () => {});
			terminal.stop();

			assert.equal(writes.includes("\x1b[?1049h"), true);
			assert.equal(writes.includes("\x1b[?1049l"), true);
		} finally {
			process.stdout.write = previousWrite;
			if (previousEnv === undefined) delete process.env.MEMCODE_TUI_ALT_SCREEN;
			else process.env.MEMCODE_TUI_ALT_SCREEN = previousEnv;
		}
	});
});

describe("ProcessTerminal dimensions", () => {
	it("falls back to COLUMNS and LINES before default dimensions", () => {
		const previousColumnsDescriptor = Object.getOwnPropertyDescriptor(process.stdout, "columns");
		const previousRowsDescriptor = Object.getOwnPropertyDescriptor(process.stdout, "rows");
		const previousColumns = process.env.COLUMNS;
		const previousLines = process.env.LINES;

		try {
			Object.defineProperty(process.stdout, "columns", { value: undefined, configurable: true });
			Object.defineProperty(process.stdout, "rows", { value: undefined, configurable: true });
			process.env.COLUMNS = "123";
			process.env.LINES = "45";

			const terminal = new ProcessTerminal();

			assert.equal(terminal.columns, 123);
			assert.equal(terminal.rows, 45);
		} finally {
			if (previousColumnsDescriptor) {
				Object.defineProperty(process.stdout, "columns", previousColumnsDescriptor);
			} else {
				Reflect.deleteProperty(process.stdout, "columns");
			}
			if (previousRowsDescriptor) {
				Object.defineProperty(process.stdout, "rows", previousRowsDescriptor);
			} else {
				Reflect.deleteProperty(process.stdout, "rows");
			}
			if (previousColumns === undefined) {
				delete process.env.COLUMNS;
			} else {
				process.env.COLUMNS = previousColumns;
			}
			if (previousLines === undefined) {
				delete process.env.LINES;
			} else {
				process.env.LINES = previousLines;
			}
		}
	});
});
