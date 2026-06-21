import { describe, expect, test, vi } from "vitest";

const compactSearch = vi.hoisted(() => vi.fn());
const initObservations = vi.hoisted(() => vi.fn());
const ensureFreshObservations = vi.hoisted(() => vi.fn());
const prepareSearchIndex = vi.hoisted(() => vi.fn());
const resolveMemorixProjectContext = vi.hoisted(() => vi.fn());

vi.mock("../src/core/memorix-resolve.ts", () => ({
	importFromMemorix: async (specifier: string) => {
		if (specifier === "compact/engine.js") {
			return { compactSearch };
		}
		if (specifier === "memory/observations.js") {
			return {
				initObservations,
				ensureFreshObservations,
				prepareSearchIndex,
			};
		}
		throw new Error(`Unexpected import: ${specifier}`);
	},
}));

vi.mock("../src/memory/memorix-runtime-context.ts", () => ({
	resolveMemorixProjectContext,
}));

const { MEMORY_COMMANDS } = await import("../src/tui/commands/memory-commands.ts");

describe("TUI /memory commands", () => {
	test("initializes the Memorix project store and search index before /memory search", async () => {
		resolveMemorixProjectContext.mockResolvedValue({
			canonicalId: "AVIDS2/memorix",
			dataDir: "C:\\Users\\Lenovo\\.memorix\\data",
		});
		compactSearch.mockResolvedValue({
			entries: [{ id: 1, title: "Search works", type: "discovery" }],
			formatted: "Found project memory",
			totalTokens: 4,
		});
		const addMessage = vi.fn();

		const result = await MEMORY_COMMANDS.search("project memory", {
			cwd: "E:\\project\\memorix",
			toast: vi.fn(),
			addMessage,
		});

		expect(initObservations).toHaveBeenCalledWith("C:\\Users\\Lenovo\\.memorix\\data");
		expect(ensureFreshObservations).toHaveBeenCalled();
		expect(prepareSearchIndex).toHaveBeenCalled();
		expect(compactSearch).toHaveBeenCalledWith({
			query: "project memory",
			projectId: "AVIDS2/memorix",
			limit: 20,
		});
		expect(addMessage).toHaveBeenCalledWith("Found project memory");
		expect(result.toast).toEqual({ msg: "1 result(s), ~4 tokens", type: "info" });
	});
});
