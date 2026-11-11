import { describe, expect, test, vi } from "vitest";

const getCachedOrFetch = vi.hoisted(() => vi.fn());
const recordMemorixInjectedRefs = vi.hoisted(() => vi.fn());

vi.mock("../src/memory/memory-prefetch.ts", () => ({
	getPrefetcher: () => ({ getCachedOrFetch }),
}));

vi.mock("../src/memory/memorix-runtime-context.ts", () => ({
	recordMemorixInjectedRefs,
}));

const { injectMemories } = await import("../src/memory/memory-injection.ts");

describe("memory injection intent gate", () => {
	test("does not search memories for greetings or casual chat", async () => {
		const prompt = "你好";
		const systemPrompt = "base system prompt";

		const result = await injectMemories(systemPrompt, prompt, "AVIDS2/memorix");

		expect(result).toBe(systemPrompt);
		expect(getCachedOrFetch).not.toHaveBeenCalled();
		expect(recordMemorixInjectedRefs).not.toHaveBeenCalled();
	});

	test("injects memories for concrete development work", async () => {
		getCachedOrFetch.mockResolvedValueOnce({
			entries: [{ id: 42, projectId: "AVIDS2/memorix", type: "gotcha", title: "TUI scroll fix" }],
			formatted: "",
			ts: Date.now(),
		});

		const result = await injectMemories("base", "修复 TUI 输出过程中滚动串台 bug", "AVIDS2/memorix");

		expect(getCachedOrFetch).toHaveBeenCalledWith("修复 TUI 输出过程中滚动串台 bug");
		expect(result).toContain("## Relevant Memories");
		expect(result).toContain("[gotcha] TUI scroll fix");
		expect(recordMemorixInjectedRefs).toHaveBeenCalledWith([{ id: 42, projectId: "AVIDS2/memorix" }]);
	});
});
