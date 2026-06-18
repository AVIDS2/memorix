import { afterEach, describe, expect, test, vi } from "vitest";

const main = vi.hoisted(() => vi.fn(async () => undefined));
const configureHttpDispatcher = vi.hoisted(() => vi.fn());
const importFromMemorix = vi.hoisted(() => vi.fn(async () => ({
	getResolvedConfigForCwd: () => ({}),
})));

vi.mock("../src/main.ts", () => ({ main }));
vi.mock("../src/core/http-dispatcher.ts", () => ({ configureHttpDispatcher }));
vi.mock("../src/core/memorix-resolve.ts", () => ({ importFromMemorix }));

const originalEnv = { ...process.env };
const originalEmitWarning = process.emitWarning;

const { runCli } = await import("../src/cli.ts");

describe("memcode CLI bootstrap", () => {
	afterEach(() => {
		process.env = { ...originalEnv };
		process.emitWarning = originalEmitWarning;
		main.mockClear();
		configureHttpDispatcher.mockClear();
		importFromMemorix.mockClear();
	});

	test("does not grab terminal mouse by default so text selection still works", async () => {
		delete process.env.MEMCODE_TUI_MOUSE;
		delete process.env.MEMORIX_EMBEDDING;

		await runCli(["--help"]);

		expect(process.env.MEMCODE_CODING_AGENT).toBe("true");
		expect(process.env.MEMCODE_TUI_MOUSE).toBeUndefined();
		expect(process.env.MEMORIX_EMBEDDING).toBe("auto");
		expect(main).toHaveBeenCalledWith(["--help"]);
	});

	test("respects explicit terminal mouse and embedding settings", async () => {
		process.env.MEMCODE_TUI_MOUSE = "0";
		process.env.MEMORIX_EMBEDDING = "off";

		await runCli(["--help"]);

		expect(process.env.MEMCODE_TUI_MOUSE).toBe("0");
		expect(process.env.MEMORIX_EMBEDDING).toBe("off");
	});
});
