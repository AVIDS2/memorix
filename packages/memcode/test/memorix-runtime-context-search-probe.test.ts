import { beforeEach, describe, expect, test, vi } from "vitest";

const modules = vi.hoisted(() => {
	const observations = [
		{
			id: 1,
			projectId: "AVIDS2/memorix",
			status: "active",
			type: "decision",
			sourceDetail: "explicit",
			valueCategory: "core",
			title: "Semantic memory search",
			narrative: "Embedding-backed search should be visible in runtime status.",
			facts: ["Hybrid search uses embeddings when available."],
			filesModified: [],
			concepts: ["semantic-search"],
			tokens: 20,
			createdAt: "2026-06-15T00:00:00.000Z",
			source: "agent",
		},
	];
	const orama = {
		mode: "fulltext",
		getLastSearchMode: vi.fn(() => orama.mode),
		isEmbeddingEnabled: vi.fn(() => true),
		getVectorDimensions: vi.fn(() => 1536),
		searchObservations: vi.fn(async () => {
			orama.mode = "hybrid";
			return [];
		}),
	};
	return {
		observations,
		orama,
		prepareSearchIndex: vi.fn(async () => 1),
		backfillVectorEmbeddings: vi.fn(async () => ({ attempted: 1, succeeded: 1, failed: 0 })),
		vectorStatus: { total: 1, missing: 0, missingIds: [], backfillRunning: false },
	};
});

vi.mock("../src/core/memorix-resolve.ts", () => ({
	importFromMemorix: async (specifier: string) => {
		if (specifier === "project/detector.js") {
			return { detectProject: () => ({ id: "AVIDS2/memorix", rootPath: "E:\\project\\memorix" }) };
		}
		if (specifier === "store/persistence.js") {
			return { getProjectDataDir: async () => "E:\\project\\memorix\\.memorix" };
		}
		if (specifier === "project/aliases.js") {
			return {
				initAliasRegistry: () => undefined,
				registerAlias: async () => "AVIDS2/memorix",
				resolveAliases: async () => ["AVIDS2/memorix"],
			};
		}
		if (specifier === "memory/observations.js") {
			return {
				initObservations: async () => undefined,
				ensureFreshObservations: async () => undefined,
				getAllObservations: () => modules.observations,
				prepareSearchIndex: modules.prepareSearchIndex,
				backfillVectorEmbeddings: modules.backfillVectorEmbeddings,
				getVectorStatus: () => modules.vectorStatus,
				getSearchIndexStatus: () => ({
					embeddingEnabled: modules.orama.isEmbeddingEnabled(),
					vectorDimensions: modules.orama.getVectorDimensions(),
					lastSearchMode: modules.orama.getLastSearchMode(),
				}),
				probeSearchIndex: async (projectId: string) => {
					await modules.orama.searchObservations({
						query: "semantic memory retrieval status",
						projectId,
						limit: 1,
						status: "all",
						trackAccess: false,
					});
					return modules.orama.getLastSearchMode();
				},
			};
		}
		if (specifier === "store/orama-store.js") {
			return modules.orama;
		}
		if (specifier === "config.js") {
			return {
				getEmbeddingMode: () => "api",
				getEmbeddingModel: () => "text-embedding-v4",
				getEmbeddingApiKey: () => "configured",
				getEmbeddingDimensions: () => 1536,
			};
		}
		if (specifier === "llm/provider.js") {
			return { initLLM: () => ({ provider: "openai", model: "qwen3.5-flash", baseUrl: "https://example.test/v1" }) };
		}
		if (specifier === "memory/retention.js") {
			return { getRetentionSummary: () => ({ active: 1, stale: 0, archiveCandidates: 0, immune: 0 }) };
		}
		throw new Error(`Unexpected import: ${specifier}`);
	},
}));

const { getMemorixRuntimeContext, formatMemorixRuntimeStatus } = await import("../src/memory/memorix-runtime-context.ts");

describe("Memorix runtime context search probe", () => {
	beforeEach(() => {
		modules.observations.splice(1);
		modules.orama.mode = "fulltext";
		modules.orama.getLastSearchMode.mockClear();
		modules.orama.searchObservations.mockClear();
		modules.prepareSearchIndex.mockClear();
		modules.backfillVectorEmbeddings.mockClear();
		modules.vectorStatus = { total: 1, missing: 0, missingIds: [], backfillRunning: false };
	});

	test("refreshes stale fulltext search mode when semantic vectors are ready", async () => {
		const context = await getMemorixRuntimeContext("E:\\project\\memorix");

		expect(modules.orama.searchObservations).toHaveBeenCalledWith({
			query: "semantic memory retrieval status",
			projectId: "AVIDS2/memorix",
			limit: 1,
			status: "all",
			trackAccess: false,
		});
		expect(modules.prepareSearchIndex).toHaveBeenCalledTimes(1);
		expect(modules.backfillVectorEmbeddings).not.toHaveBeenCalled();
		expect(context.search.mode).toBe("hybrid");
		expect(context.search.probed).toBe(true);
		expect(context.search.indexPrepared).toBe(true);
		expect(formatMemorixRuntimeStatus(context)).toContain("Search: hybrid (verified now)");
	});

	test("starts vector backfill in the background when the index has missing vectors", async () => {
		modules.observations.push({
			...modules.observations[0],
			id: 2,
			title: "Backfill pending",
		});
		modules.vectorStatus = { total: 2, missing: 2, missingIds: [1, 2], backfillRunning: false };

		const context = await getMemorixRuntimeContext("E:\\project\\memorix");

		expect(modules.prepareSearchIndex).toHaveBeenCalledTimes(1);
		expect(modules.backfillVectorEmbeddings).toHaveBeenCalledTimes(1);
		expect(context.embedding.backfillRunning).toBe(true);
	});

	test("explains fulltext mode while semantic vectors are warming", async () => {
		modules.vectorStatus = { total: 1, missing: 1, missingIds: [1], backfillRunning: true };

		const context = await getMemorixRuntimeContext("E:\\project\\memorix");
		const formatted = formatMemorixRuntimeStatus(context);

		expect(context.search.mode).toBe("fulltext");
		expect(formatted).toContain("Search: semantic warming (BM25/fulltext until vectors finish)");
		expect(formatted).toContain("Embedding: api-text-embedding-v4 · 0/1 vectors · 1536d · backfill running");
	});

	test("footer mode skips heavy index preparation, probing, and backfill", async () => {
		modules.vectorStatus = { total: 1, missing: 1, missingIds: [1], backfillRunning: false };

		const context = await getMemorixRuntimeContext("E:\\project\\memorix", { mode: "footer" });

		expect(modules.prepareSearchIndex).not.toHaveBeenCalled();
		expect(modules.backfillVectorEmbeddings).not.toHaveBeenCalled();
		expect(modules.orama.searchObservations).not.toHaveBeenCalled();
		expect(context.search.probed).toBe(false);
		expect(context.search.indexPrepared).toBe(false);
	});
});
