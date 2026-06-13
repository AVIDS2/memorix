import { describe, expect, test, vi } from "vitest";
import {
	createMemorixHookBridge,
	getMemorixHookBridgeStatus,
	resetMemorixHookBridgeStatus,
} from "../src/memory/memorix-hook-bridge.ts";

function createContext(overrides: Partial<any> = {}) {
	return {
		cwd: "E:\\project\\memorix",
		sessionManager: {
			getSessionId: () => "sess-test",
		},
		...overrides,
	};
}

describe("memorix native hook bridge", () => {
	test("tracks session start and user bash lifecycle events in status", async () => {
		resetMemorixHookBridgeStatus();
		const bridge = createMemorixHookBridge();

		await bridge.captureSessionStart(
			{ type: "session_start", reason: "startup" } as any,
			createContext(),
		);
		await bridge.captureUserBash(
			{
				type: "user_bash",
				command: "npm test",
				excludeFromContext: false,
				cwd: "E:\\project\\memorix",
			} as any,
			createContext(),
		);

		const status = getMemorixHookBridgeStatus();
		expect(status.active).toBe(true);
		expect(status.counts.session_start).toBe(1);
		expect(status.counts.post_command).toBe(1);
		expect(status.recentEvents[0]?.event).toBe("post_command");
		expect(status.recentEvents[1]?.event).toBe("session_start");
	});

	test("captures user prompts as Memorix user_prompt hook events", async () => {
		resetMemorixHookBridgeStatus();
		const processHook = vi.fn(async () => ({ observation: null, output: { continue: true } }));
		const bridge = createMemorixHookBridge({ processHook });

		await bridge.captureUserPrompt(
			{
				type: "before_agent_start",
				prompt: "Implement native hooks so memcode captures durable decisions.",
				systemPrompt: "system",
				systemPromptOptions: { cwd: "E:\\project\\memorix" },
			} as any,
			createContext(),
		);

		expect(processHook).toHaveBeenCalledWith(
			expect.objectContaining({
				event: "user_prompt",
				agent: "codex",
				sessionId: "sess-test",
				cwd: "E:\\project\\memorix",
				userPrompt: "Implement native hooks so memcode captures durable decisions.",
			}),
		);
	});

	test("captures tool results with tool input and text output", async () => {
		resetMemorixHookBridgeStatus();
		const processHook = vi.fn(async () => ({ observation: null, output: { continue: true } }));
		const bridge = createMemorixHookBridge({ processHook });

		await bridge.captureToolResult(
			{
				type: "tool_result",
				toolName: "bash",
				toolCallId: "tool-1",
				input: { command: "npm --prefix packages/memcode test -- native-hooks" },
				content: [{ type: "text", text: "Test Files 1 passed" }],
				details: { exitCode: 0 },
				isError: false,
			} as any,
			createContext(),
		);

		expect(processHook).toHaveBeenCalledWith(
			expect.objectContaining({
				event: "post_tool",
				toolName: "bash",
				command: "npm --prefix packages/memcode test -- native-hooks",
				toolInput: { command: "npm --prefix packages/memcode test -- native-hooks" },
				toolResult: "Test Files 1 passed",
			}),
		);
	});

	test("stores observations returned by the hook processor", async () => {
		resetMemorixHookBridgeStatus();
		const observation = {
			entityName: "native-hooks",
			type: "decision",
			title: "Use native hooks",
			narrative: "memcode uses the in-process Memorix hook pipeline.",
			facts: ["Agent: codex"],
		};
		const processHook = vi.fn(async () => ({ observation, output: { continue: true } }));
		const storeObservation = vi.fn(async () => undefined);
		const bridge = createMemorixHookBridge({ processHook, storeObservation });

		await bridge.captureUserPrompt(
			{
				type: "before_agent_start",
				prompt: "We decided native hooks are first-party.",
				systemPrompt: "system",
				systemPromptOptions: { cwd: "E:\\project\\memorix" },
			} as any,
			createContext(),
		);

		expect(storeObservation).toHaveBeenCalledWith(
			observation,
			expect.objectContaining({
				cwd: "E:\\project\\memorix",
				sessionId: "sess-test",
			}),
		);
	});

	test("does not capture empty assistant messages", async () => {
		resetMemorixHookBridgeStatus();
		const processHook = vi.fn(async () => ({ observation: null, output: { continue: true } }));
		const bridge = createMemorixHookBridge({ processHook });

		await bridge.captureAssistantMessage(
			{
				type: "message_end",
				message: { role: "assistant", content: [{ type: "text", text: "   " }] },
			} as any,
			createContext(),
		);

		expect(processHook).not.toHaveBeenCalled();
	});

	test("skips Memorix internal tool results to avoid memory self-pollution", async () => {
		resetMemorixHookBridgeStatus();
		const processHook = vi.fn(async () => ({ observation: null, output: { continue: true } }));
		const bridge = createMemorixHookBridge({ processHook });

		await bridge.captureToolResult(
			{
				type: "tool_result",
				toolName: "memorix_search",
				toolCallId: "tool-memory",
				input: { query: "native hooks" },
				content: [{ type: "text", text: "Found 3 observation(s)" }],
				details: undefined,
				isError: false,
			} as any,
			createContext(),
		);

		expect(processHook).not.toHaveBeenCalled();
	});

	test("swallows hook processor failures so agent turns are not blocked", async () => {
		resetMemorixHookBridgeStatus();
		const processHook = vi.fn(async () => {
			throw new Error("hook backend unavailable");
		});
		const logger = { error: vi.fn() };
		const bridge = createMemorixHookBridge({ processHook, logger });

		await expect(
			bridge.captureUserPrompt(
				{
					type: "before_agent_start",
					prompt: "Capture this without blocking the agent.",
					systemPrompt: "system",
					systemPromptOptions: { cwd: "E:\\project\\memorix" },
				} as any,
				createContext(),
			),
		).resolves.toBeUndefined();
		expect(logger.error).toHaveBeenCalledWith(
			expect.stringContaining("[memcode] native hook failed:"),
			expect.any(String),
		);
	});
});
