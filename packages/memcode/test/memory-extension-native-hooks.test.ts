import { describe, expect, test, vi } from "vitest";

const bridge = vi.hoisted(() => ({
	captureUserPrompt: vi.fn(async () => undefined),
	captureToolResult: vi.fn(async () => undefined),
	captureAssistantMessage: vi.fn(async () => undefined),
	captureSessionEnd: vi.fn(async () => undefined),
}));

const createMemorixHookBridge = vi.hoisted(() => vi.fn(() => bridge));

vi.mock("../src/memory/memorix-hook-bridge.ts", () => ({
	createMemorixHookBridge,
}));

vi.mock("../src/memory/memory-injection.ts", () => ({
	createMemoryInjectionHandler: () => async () => undefined,
}));

const { default: memoryExtension } = await import("../src/extensions/memory-extension.ts");
const { memorixGraphContextTool, memorixSearchTool, memorixStatusTool } = await import("../src/tools/memory-tools.ts");

function createExtensionApi() {
	const handlers = new Map<string, Array<(event: any, ctx: any) => unknown>>();
	return {
		handlers,
		api: {
			registerTool: vi.fn(),
			on: vi.fn((event: string, handler: (event: any, ctx: any) => unknown) => {
				const list = handlers.get(event) ?? [];
				list.push(handler);
				handlers.set(event, list);
			}),
		},
	};
}

function createContext() {
	return {
		cwd: "E:\\project\\memorix",
		sessionManager: { getSessionId: () => "sess-test" },
	};
}

describe("memoryExtension native hooks", () => {
	test("keeps memory tool prompt guidance opt-in instead of eager", () => {
		expect(memorixSearchTool.promptGuidelines).toContain(
			"Use memorix_search only when prior project context would materially help the current task.",
		);
		expect(memorixSearchTool.promptGuidelines?.join("\n")).toContain("Skip memory search");
		expect(memorixSearchTool.promptGuidelines?.join("\n")).toContain("Use memorix_graph_context for that");
		expect(memorixSearchTool.promptGuidelines?.join("\n")).toContain("Do not immediately call memorix_search again");
		expect(memorixGraphContextTool.promptGuidelines?.join("\n")).toContain("broad memory overview");
		expect(memorixGraphContextTool.promptGuidelines?.join("\n")).toContain("background context");
		expect(memorixStatusTool.promptGuidelines).toEqual([
			"Use memorix_status only when the user asks about memory runtime, project identity, embedding, search mode, rerank, retention, hooks, or injection state.",
		]);
	});

	test("keeps native memory tools and registers native hook lifecycle handlers", () => {
		const { api, handlers } = createExtensionApi();

		memoryExtension(api as any);

		expect(api.registerTool).toHaveBeenCalledTimes(5);
		expect(api.registerTool.mock.calls.map(([tool]) => tool.name)).toEqual([
			"memorix_search",
			"memorix_store",
			"memorix_detail",
			"memorix_graph_context",
			"memorix_status",
		]);
		expect(createMemorixHookBridge).toHaveBeenCalledTimes(1);
		expect(handlers.has("before_agent_start")).toBe(true);
		expect(handlers.has("tool_result")).toBe(true);
		expect(handlers.has("message_end")).toBe(true);
		expect(handlers.has("agent_end")).toBe(true);
	});

	test("forwards extension lifecycle events to the native hook bridge", async () => {
		const { api, handlers } = createExtensionApi();
		const ctx = createContext();

		memoryExtension(api as any);

		await handlers.get("before_agent_start")![0](
			{
				type: "before_agent_start",
				prompt: "Implement native Memorix hook capture.",
				systemPrompt: "system",
				systemPromptOptions: { cwd: ctx.cwd },
			},
			ctx,
		);
		await handlers.get("tool_result")![0](
			{
				type: "tool_result",
				toolName: "bash",
				toolCallId: "tool-1",
				input: { command: "npm test" },
				content: [{ type: "text", text: "pass" }],
				details: undefined,
				isError: false,
			},
			ctx,
		);
		await handlers.get("message_end")![0](
			{
				type: "message_end",
				message: { role: "assistant", content: [{ type: "text", text: "Native hooks are wired." }] },
			},
			ctx,
		);
		await handlers.get("agent_end")![0](
			{
				type: "agent_end",
				messages: [{ role: "assistant", content: [{ type: "text", text: "Turn complete." }] }],
			},
			ctx,
		);

		expect(bridge.captureUserPrompt).toHaveBeenCalledTimes(1);
		expect(bridge.captureToolResult).toHaveBeenCalledTimes(1);
		expect(bridge.captureAssistantMessage).toHaveBeenCalledTimes(1);
		expect(bridge.captureSessionEnd).toHaveBeenCalledTimes(1);
	});
});
