import { afterEach, describe, expect, it, vi } from "vitest";
import { isLegacyMiniMaxTextModel, updateMiniMaxDirectModels } from "../src/minimax-models.ts";
import { getModel, getModels, getSupportedThinkingLevels } from "../src/models.ts";
import { streamAnthropic, streamSimpleAnthropic, type AnthropicEffort } from "../src/providers/anthropic.ts";
import { streamOpenAICompletions } from "../src/providers/openai-completions.ts";
import type { Api, Context, Model, ThinkingLevel } from "../src/types.ts";

const context: Context = { messages: [{ role: "user", content: "hello", timestamp: 0 }] };
const events = [
	{ type: "message_start", message: { id: "msg_test", usage: { input_tokens: 1, output_tokens: 0 } } },
	{ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
	{ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "ok" } },
	{ type: "content_block_stop", index: 0 },
	{ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 1 } },
	{ type: "message_stop" },
];

function capture(openai = false) {
	const requests: { url: string; body: Record<string, any> }[] = [];
	vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		const request = new Request(input, init);
		requests.push({ url: request.url, body: JSON.parse(await request.text()) });
		const body = openai
			? `data: ${JSON.stringify({ id: "chat_test", choices: [{ index: 0, delta: { content: "ok" }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`
			: events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join("");
		return new Response(body, { headers: { "content-type": "text/event-stream" } });
	}));
	return requests;
}

afterEach(() => vi.unstubAllGlobals());

describe.each(["minimax", "minimax-cn"] as const)("%s Flash SDK captures", provider => {
	it.each([undefined, "low", "medium", "high", "xhigh", "max", "none"])("normalizes effort %s after payload overrides", async effort => {
		const requests = capture();
		const model = getModel(provider, "MiniMax-M3.1-Flash");
		const response = await streamAnthropic(model, context, {
			apiKey: "test", effort: effort as AnthropicEffort, thinkingEnabled: false,
			onPayload: payload => ({ ...payload as object, thinking: { type: "disabled" }, service_tier: "priority", reasoning_split: false }),
		}).result();
		expect(response.stopReason, response.errorMessage).toBe("stop");
		expect(requests).toHaveLength(1);
		expect(requests[0].url).toBe(`${model.baseUrl}/v1/messages`);
		expect(requests[0].body.thinking).toEqual({ type: "adaptive" });
		expect(requests[0].body.output_config.effort).toBe(!effort || effort === "none" ? "max" : effort);
		expect(requests[0].body.service_tier).toBeUndefined();
		expect(requests[0].body.reasoning_split).toBeUndefined();
	});

	it.each([undefined, "low", "medium", "high", "xhigh"])("maps simple reasoning %s", async reasoning => {
		const requests = capture();
		const result = await streamSimpleAnthropic(getModel(provider, "MiniMax-M3.1-Flash"), context, {
			apiKey: "test", reasoning: reasoning as ThinkingLevel,
		}).result();
		expect(result.stopReason, result.errorMessage).toBe("stop");
		expect(requests[0].body.thinking).toEqual({ type: "adaptive" });
		expect(requests[0].body.output_config.effort).toBe(reasoning ?? "max");
	});

	it.each([undefined, false, true])("retains M3 thinking choice %s", async thinkingEnabled => {
		const requests = capture();
		const result = await streamAnthropic(getModel(provider, "MiniMax-M3"), context, { apiKey: "test", thinkingEnabled }).result();
		expect(result.stopReason, result.errorMessage).toBe("stop");
		expect(requests[0].body.thinking).toEqual(thinkingEnabled === undefined ? undefined : { type: thinkingEnabled ? "adaptive" : "disabled" });
	});
});

it.each([undefined, "low", "medium", "high", "xhigh", "max", "none"])("captures the verified OpenRouter route with effort %s", async effort => {
	const requests = capture(true);
	const model = getModel("openrouter", "minimax/minimax-m3.1-flash:free");
	const result = await streamOpenAICompletions(model, context, { apiKey: "test", onPayload: payload => ({
		...payload as object, reasoning: { enabled: false, effort }, service_tier: "priority", reasoning_split: false,
	}) }).result();
	expect(result.stopReason, result.errorMessage).toBe("stop");
	expect(requests[0].url).toBe("https://openrouter.ai/api/v1/chat/completions");
	expect(requests[0].body.reasoning).toEqual({ enabled: true, effort: !effort || effort === "none" ? "max" : effort });
	expect(requests[0].body.service_tier).toBeUndefined();
});

it("preserves legacy and custom Anthropic request options", async () => {
	for (const id of ["MiniMax-M2.7", "saved-private-model"]) {
		const requests = capture();
		const model = { ...getModel("minimax", "MiniMax-M2.7"), id };
		const result = await streamAnthropic(model, context, { apiKey: "test", thinkingEnabled: true, thinkingBudgetTokens: 2048 }).result();
		expect(result.stopReason, result.errorMessage).toBe("stop");
		expect(requests[0].body.model).toBe(id);
		expect(requests[0].body.thinking).toMatchObject({ type: "enabled", budget_tokens: 2048 });
	}
});

it("matches generator metadata and keeps current pickers separate from legacy lookup", () => {
	const generated: Model<Api>[] = [];
	updateMiniMaxDirectModels(generated);
	updateMiniMaxDirectModels(generated);
	expect(generated).toHaveLength(4);
	for (const provider of ["minimax", "minimax-cn"] as const) {
		expect(getModels(provider).map(model => model.id)).toEqual(["MiniMax-M3.1-Flash", "MiniMax-M3"]);
		for (const model of getModels(provider)) expect(model).toEqual(generated.find(item => item.provider === provider && item.id === model.id));
		expect(getModels(provider, { includeLegacy: true }).some(model => model.id === "MiniMax-M2.7")).toBe(true);
		expect(getModel(provider, "MiniMax-M2.7").input).toEqual(["text"]);
		expect(getSupportedThinkingLevels(getModel(provider, "MiniMax-M3.1-Flash"))).toEqual(["low", "medium", "high", "xhigh"]);
	}
	for (const provider of ["openrouter", "opencode", "opencode-go"] as const) {
		expect(getModels(provider).some(model => isLegacyMiniMaxTextModel(model))).toBe(false);
	}
	expect(getModels("openrouter").some(model => model.id === "minimax/minimax-m3.1-flash:free")).toBe(true);
});

it("preserves custom hosts and nontext model IDs", () => {
	const old = getModel("minimax", "MiniMax-M2.7");
	expect(isLegacyMiniMaxTextModel({ ...old, baseUrl: "https://private.example/v1" })).toBe(false);
	for (const id of ["speech-02-hd", "image-01", "video-01", "private-model"]) {
		expect(isLegacyMiniMaxTextModel({ ...old, id })).toBe(false);
	}
});
