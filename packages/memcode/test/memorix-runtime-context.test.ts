import { describe, expect, test, vi } from "vitest";

const importFromMemorix = vi.hoisted(() => vi.fn());
const hookStatus = vi.hoisted(() =>
	vi.fn(() => ({
		active: true,
		createdAt: "2026-06-12T00:00:00.000Z",
		counts: { user_prompt: 2, agent_end: 1 },
		recentEvents: [],
		lastStoredObservation: {
			entityName: "memcode-native-hooks",
			type: "decision",
			title: "Native hooks captured",
		},
		lastError: undefined,
	})),
);

vi.mock("../src/core/memorix-resolve.ts", () => ({ importFromMemorix }));
vi.mock("../src/memory/memorix-hook-bridge.ts", () => ({ getMemorixHookBridgeStatus: hookStatus }));

const { getMemorixRuntimeContext, formatMemorixRuntimeStatus } = await import(
	"../src/memory/memorix-runtime-context.ts"
);

describe("Memorix runtime context", () => {
	test("resolves canonical project identity and shared memory status", async () => {
		importFromMemorix.mockImplementation(async (subpath: string) => {
			if (subpath === "project/detector.js") {
				return {
					detectProject: () => ({
						id: "local/memorix",
						rootPath: "E:\\my_idea_cc\\my_copilot\\memorix",
						gitRemote: "git@github.com:AVIDS2/memorix.git",
					}),
				};
			}
			if (subpath === "store/persistence.js") {
				return { getProjectDataDir: async () => "E:\\memorix-data" };
			}
			if (subpath === "project/aliases.js") {
				return {
					initAliasRegistry: vi.fn(),
					registerAlias: async () => "AVIDS2/memorix",
					resolveAliases: async () => ["AVIDS2/memorix", "local/memorix"],
				};
			}
			if (subpath === "memory/observations.js") {
				return {
					ensureFreshObservations: async () => false,
					initObservations: async () => undefined,
					getAllObservations: () => [
						{ id: 1, projectId: "AVIDS2/memorix", status: "active", type: "decision", sourceDetail: "explicit", valueCategory: "core" },
						{ id: 2, projectId: "local/memorix", status: "active", type: "gotcha", sourceDetail: "hook", valueCategory: "contextual" },
						{ id: 3, projectId: "other/project", status: "active", type: "decision" },
					],
					getVectorStatus: () => ({ total: 3, missing: 1, missingIds: [2], backfillRunning: true }),
				};
			}
			if (subpath === "store/orama-store.js") {
				return { getLastSearchMode: () => "hybrid + LLM rerank", isEmbeddingEnabled: () => true, getVectorDimensions: () => 1024 };
			}
			if (subpath === "embedding/provider.js") {
				return {
					getEmbeddingProvider: async () => ({ name: "api-text-embedding-v4", dimensions: 1024 }),
					isEmbeddingExplicitlyDisabled: () => false,
				};
			}
			if (subpath === "config.js") {
				return {
					getEmbeddingMode: () => "api",
					getEmbeddingModel: () => "text-embedding-v4",
					getEmbeddingDimensions: () => 1024,
					getEmbeddingApiKey: () => "secret",
				};
			}
			if (subpath === "llm/provider.js") {
				return {
					initLLM: () => ({ provider: "openai", model: "deepseek-chat", baseUrl: "https://api.example.test/v1", apiKey: "secret" }),
				};
			}
			if (subpath === "memory/retention.js") {
				return {
					getRetentionSummary: () => ({ active: 1, stale: 1, archiveCandidates: 0, immune: 1 }),
				};
			}
			throw new Error(`unexpected import ${subpath}`);
		});

		const context = await getMemorixRuntimeContext("E:\\my_idea_cc\\my_copilot\\memorix");

		expect(context.project.canonicalId).toBe("AVIDS2/memorix");
		expect(context.project.aliases).toEqual(["AVIDS2/memorix", "local/memorix"]);
		expect(context.memory.activeCount).toBe(2);
		expect(context.memory.bySourceDetail).toEqual({ explicit: 1, hook: 1 });
		expect(context.search.mode).toBe("hybrid + LLM rerank");
		expect(context.embedding.provider).toBe("api-text-embedding-v4");
		expect(context.llm.enabled).toBe(true);
		expect(context.hooks.active).toBe(true);

		const formatted = formatMemorixRuntimeStatus(context);
		expect(formatted).toContain("Project: AVIDS2/memorix");
		expect(formatted).toContain("Shared aliases: AVIDS2/memorix, local/memorix");
		expect(formatted).toContain("Search: hybrid + LLM rerank");
		expect(formatted).toContain("Embedding: api-text-embedding-v4 (1024d)");
		expect(formatted).toContain("Memory LLM: openai/deepseek-chat");
		expect(formatted).toContain("Native hooks: active");
	});
});
