import { describe, expect, it } from "vitest";
import { loadExistingGeneratedModelsForProvider } from "../scripts/generate-models.ts";

describe("generate-models fallback", () => {
	it("can load the existing OpenRouter snapshot from models.generated.ts", async () => {
		const models = await loadExistingGeneratedModelsForProvider("openrouter");

		expect(models.length).toBeGreaterThan(1);
		expect(models.some((model) => model.id === "anthropic/claude-sonnet-4")).toBe(true);
	});
});
