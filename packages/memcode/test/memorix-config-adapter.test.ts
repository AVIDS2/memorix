import { describe, expect, test } from "vitest";
import { applyMemorixAgentDefaults } from "../src/config/memorix-config-adapter.ts";

describe("applyMemorixAgentDefaults", () => {
	test("applies agent lane defaults into memcode environment", () => {
		const env: Record<string, string | undefined> = {};

		applyMemorixAgentDefaults(
			{
				agent: {
					provider: "deepseek",
					model: "deepseek-chat",
					baseUrl: "https://api.deepseek.com/v1",
					apiKey: "configured-in-test",
				},
			},
			env,
		);

		expect(env.MEMORIX_AGENT_PROVIDER).toBe("deepseek");
		expect(env.MEMORIX_AGENT_MODEL).toBe("deepseek-chat");
		expect(env.MEMORIX_AGENT_BASE_URL).toBe("https://api.deepseek.com/v1");
		expect(env.MEMORIX_AGENT_API_KEY).toBe("configured-in-test");
	});

	test("does not overwrite explicit process environment values", () => {
		const env: Record<string, string | undefined> = {
			MEMORIX_AGENT_MODEL: "override-model",
			MEMORIX_AGENT_LLM_API_KEY: "legacy-explicit-key",
		};

		applyMemorixAgentDefaults(
			{
				agent: {
					model: "config-model",
					apiKey: "config-key",
				},
			},
			env,
		);

		expect(env.MEMORIX_AGENT_MODEL).toBe("override-model");
		expect(env.MEMORIX_AGENT_API_KEY).toBeUndefined();
		expect(env.MEMORIX_AGENT_LLM_API_KEY).toBe("legacy-explicit-key");
	});
});
