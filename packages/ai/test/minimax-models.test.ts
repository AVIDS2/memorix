import { describe, expect, it } from "vitest";
import { getModel } from "../src/models.ts";

describe("MiniMax models", () => {
	it("registers MiniMax-M3 with text, image, and video input on the global endpoint", () => {
		const model = getModel("minimax", "MiniMax-M3");

		expect(model).toBeDefined();
		expect(model.api).toBe("anthropic-messages");
		expect(model.provider).toBe("minimax");
		expect(model.baseUrl).toBe("https://api.minimax.io/anthropic");
		expect(model.reasoning).toBe(true);
		expect(model.input).toEqual(["text", "image", "video"]);
		expect(model.contextWindow).toBe(1000000);
		expect(model.maxTokens).toBe(128000);
		expect(model.cost).toEqual({
			input: 0.3,
			output: 1.2,
			cacheRead: 0.06,
			cacheWrite: 0,
		});
	});

	it("registers MiniMax-M3 with text, image, and video input on the China endpoint", () => {
		const model = getModel("minimax-cn", "MiniMax-M3");

		expect(model).toBeDefined();
		expect(model.api).toBe("anthropic-messages");
		expect(model.provider).toBe("minimax-cn");
		expect(model.baseUrl).toBe("https://api.minimaxi.com/anthropic");
		expect(model.reasoning).toBe(true);
		expect(model.input).toEqual(["text", "image", "video"]);
	});

	it("keeps MiniMax-M2.7 as text-only", () => {
		const model = getModel("minimax", "MiniMax-M2.7");

		expect(model).toBeDefined();
		expect(model.input).toEqual(["text"]);
	});
});
