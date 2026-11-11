import { describe, expect, test } from "vitest";
import { MEMORY_COMMANDS } from "../src/tui/commands/memory-commands.ts";
import { createMemorixHookBridge, resetMemorixHookBridgeStatus } from "../src/memory/memorix-hook-bridge.ts";

describe("/memory hooks command", () => {
	test("renders native hook status from the live bridge", async () => {
		resetMemorixHookBridgeStatus();
		const bridge = createMemorixHookBridge({
			processHook: async () => ({
				observation: {
					entityName: "hooks",
					type: "decision",
					title: "Use native hooks",
					narrative: "Memcode uses Memorix native hooks.",
				},
				output: { continue: true },
			}),
			storeObservation: async () => undefined,
		});

		await bridge.captureUserPrompt(
			{
				type: "before_agent_start",
				prompt: "Native hooks should be visible.",
				systemPrompt: "system",
				systemPromptOptions: { cwd: "E:\\project\\memorix" },
			} as any,
			{
				cwd: "E:\\project\\memorix",
				sessionManager: { getSessionId: () => "sess-test" },
			} as any,
		);

		const result = await MEMORY_COMMANDS.hooks("", {
			cwd: "E:\\project\\memorix",
			toast: () => undefined,
			addMessage: () => undefined,
		});

		expect(result.message).toContain("Memorix Native Hooks");
		expect(result.message).toContain("Active: yes");
		expect(result.message).toContain("user_prompt: 1");
		expect(result.message).toContain("Last stored: [decision] Use native hooks (hooks)");
	});
});
