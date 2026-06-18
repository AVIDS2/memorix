import { describe, expect, test, vi } from "vitest";

const getMemorixRuntimeContext = vi.hoisted(() => vi.fn());
const formatMemorixRuntimeStatus = vi.hoisted(() => vi.fn());

vi.mock("../src/memory/memorix-runtime-context.ts", () => ({
	getMemorixRuntimeContext,
	formatMemorixRuntimeStatus,
}));

const { MEMORY_COMMANDS } = await import("../src/tui/commands/memory-commands.ts");

describe("/memory status command", () => {
	test("renders shared Memorix runtime status", async () => {
		getMemorixRuntimeContext.mockResolvedValue({ project: { canonicalId: "AVIDS2/memorix" } });
		formatMemorixRuntimeStatus.mockReturnValue(
			[
				"Memorix Runtime Status",
				"Project: AVIDS2/memorix",
				"Shared aliases: AVIDS2/memorix, local/memorix",
				"Search: hybrid",
				"Embedding: api-text-embedding-v4 (1024d)",
				"Native hooks: active",
			].join("\n"),
		);

		const result = await MEMORY_COMMANDS.status("", {
			cwd: "E:\\project\\memorix",
			toast: () => undefined,
			addMessage: () => undefined,
		});

		expect(getMemorixRuntimeContext).toHaveBeenCalledWith("E:\\project\\memorix", { mode: "full" });
		expect(result.message).toContain("Memorix Runtime Status");
		expect(result.message).toContain("Shared aliases: AVIDS2/memorix, local/memorix");
		expect(result.toast).toEqual({ msg: "Memorix runtime status ready", type: "info" });
	});
});
