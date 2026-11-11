import type { Api, Model } from "./types.ts";

/** Keep historical records requestable while retiring their ordinary picker entries. */
export function isLegacyMiniMaxTextModel(model: Pick<Model<Api>, "provider" | "id" | "baseUrl">): boolean {
	let host: string;
	try {
		host = new URL(model.baseUrl).hostname;
	} catch {
		return false;
	}
	const direct = (model.provider === "minimax" || model.provider === "minimax-cn") &&
		(host === "api.minimax.io" || host === "api.minimaxi.com");
	const gateway = (model.provider === "openrouter" && host === "openrouter.ai") ||
		((model.provider === "opencode" || model.provider === "opencode-go") && host === "opencode.ai");
	return (direct || gateway) && /^(?:minimax\/)?(?:minimax-(?:01|m[12](?:[.\-][^/:]*)?)|m2-her)(?::[^/]*)?$/i.test(model.id);
}

/** Official direct API metadata; never infer a third-party route from these IDs. */
export function updateMiniMaxDirectModels(models: Model<Api>[]): void {
	for (const [provider, baseUrl] of [
		["minimax", "https://api.minimax.io/anthropic"],
		["minimax-cn", "https://api.minimaxi.com/anthropic"],
	] as const) {
		for (const id of ["MiniMax-M3.1-Flash", "MiniMax-M3"]) {
			const flash = id === "MiniMax-M3.1-Flash";
			const current: Model<"anthropic-messages"> = {
				id, name: id, api: "anthropic-messages", provider, baseUrl,
				reasoning: true, input: ["text", "image", "video"],
				contextWindow: 1000000, maxTokens: 524288,
				// cacheWrite=0 is the existing schema's unpriced sentinel, not a free-write claim.
				// M3's flat card represents Standard <=512k; long-input/Priority rates vary.
				cost: flash
					? { input: 0.15, output: 0.6, cacheRead: 0.015, cacheWrite: 0 }
					: { input: 0.3, output: 1.2, cacheRead: 0.06, cacheWrite: 0 },
				compat: { forceAdaptiveThinking: true },
				...(flash ? { thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh" } } : {}),
			};
			const index = models.findIndex(model => model.provider === provider && model.id === id);
			if (index === -1) models.push(current);
			else models[index] = current;
		}
	}
}
