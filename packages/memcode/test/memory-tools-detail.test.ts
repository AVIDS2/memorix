import { beforeEach, describe, expect, test, vi } from "vitest";

const compactDetail = vi.hoisted(() => vi.fn());
const compactSearch = vi.hoisted(() => vi.fn());
const compactGraphContext = vi.hoisted(() => vi.fn());
const formatGraphContextPrompt = vi.hoisted(() => vi.fn());
const resolveMemorixProjectContext = vi.hoisted(() => vi.fn());
const getMemorixRuntimeContext = vi.hoisted(() => vi.fn());
const formatMemorixRuntimeStatus = vi.hoisted(() => vi.fn());
const initObservations = vi.hoisted(() => vi.fn());
const ensureFreshObservations = vi.hoisted(() => vi.fn());
const prepareSearchIndex = vi.hoisted(() => vi.fn());
const getAllObservations = vi.hoisted(() => vi.fn(() => []));

vi.mock("../src/core/memorix-resolve.ts", () => ({
	importFromMemorix: async (specifier: string) => {
		if (specifier === "compact/engine.js") {
			return {
				compactDetail,
				compactSearch,
				normalizeMemoryBrowseQuery: (query: string) =>
					["我们有哪些记忆", "我们有那些记忆", "有哪些记忆", "有那些记忆", "所有记忆", "全部记忆", "记忆概览"].includes(query)
						? ""
						: query,
			};
		}
		if (specifier === "memory/graph-context.js") {
			return { buildGraphContextPacket: compactGraphContext, formatGraphContextPrompt };
		}
		if (specifier === "memory/observations.js") {
			return { initObservations, ensureFreshObservations, prepareSearchIndex, getAllObservations };
		}
		throw new Error(`Unexpected import: ${specifier}`);
	},
}));

vi.mock("../src/memory/memorix-runtime-context.ts", () => ({
	resolveMemorixProjectContext,
	formatMemorixRuntimeStatus,
	getMemorixRuntimeContext,
}));

const { memorixDetailTool, memorixSearchTool, memorixStatusTool, memorixGraphContextTool } = await import("../src/tools/memory-tools.ts");

beforeEach(() => {
	compactDetail.mockClear();
	compactSearch.mockClear();
	compactGraphContext.mockClear();
	formatGraphContextPrompt.mockClear();
	resolveMemorixProjectContext.mockClear();
	getMemorixRuntimeContext.mockClear();
	formatMemorixRuntimeStatus.mockClear();
	initObservations.mockClear();
	ensureFreshObservations.mockClear();
	prepareSearchIndex.mockClear();
	getAllObservations.mockClear();
	getAllObservations.mockReturnValue([]);
});

describe("memorix_search native tool", () => {
	test("routes broad project-memory browse requests to graph context instead of compact search", async () => {
		resolveMemorixProjectContext.mockResolvedValue({
			canonicalId: "AVIDS2/memorix",
			dataDir: "C:\\Users\\Lenovo\\.memorix\\data",
		});
		getAllObservations.mockReturnValue([{ id: 1, projectId: "AVIDS2/memorix", title: "GraphContext packet" }]);
		compactGraphContext.mockReturnValue({
			projectId: "AVIDS2/memorix",
			query: "搜索一下我们项目的记忆",
			summary: "1 high-signal memories · 1 entity cluster(s) · 0 relation(s) · 0 risk signal(s)",
			entities: [],
			edges: [],
			memories: [{ id: 1, title: "GraphContext packet", type: "decision", entityName: "memcode-runtime", status: "active", reason: "core memory" }],
			risks: [],
			audit: { issues: { hookNoise: [], orphans: [], retentionCandidates: [] } },
		});
		formatGraphContextPrompt.mockReturnValue("## Memory Context Packet\n\n- #1 GraphContext packet");

		const result = await memorixSearchTool.execute(
			"tool-1",
			{ query: "搜索一下我们项目的记忆" },
			undefined,
			undefined,
			{ cwd: "E:\\project\\memorix" } as any,
		);

		expect(compactSearch).not.toHaveBeenCalled();
		expect(compactGraphContext).toHaveBeenCalledWith(expect.arrayContaining([
			expect.objectContaining({ id: 1, projectId: "AVIDS2/memorix" }),
		]), expect.objectContaining({
			projectId: "AVIDS2/memorix",
			query: "搜索一下我们项目的记忆",
		}));
		expect(result.content[0]?.text).toContain("## Memory Context Packet");
		expect(result.content[0]?.text).toContain("GraphContext packet");
	});

	test("initializes the Memorix project store and search index before searching", async () => {
		resolveMemorixProjectContext.mockResolvedValue({
			canonicalId: "AVIDS2/memorix",
			dataDir: "C:\\Users\\Lenovo\\.memorix\\data",
		});
		compactSearch.mockResolvedValue({
			entries: [],
			formatted: "No matches",
			totalTokens: 2,
		});

		await memorixSearchTool.execute(
			"tool-1",
			{ query: "project memory" },
			undefined,
			undefined,
			{ cwd: "E:\\project\\memorix" } as any,
		);

		expect(initObservations).toHaveBeenCalledWith("C:\\Users\\Lenovo\\.memorix\\data");
		expect(ensureFreshObservations).toHaveBeenCalled();
		expect(prepareSearchIndex).toHaveBeenCalled();
		expect(compactSearch).toHaveBeenCalledWith(expect.objectContaining({
			projectId: "AVIDS2/memorix",
			query: "project memory",
			status: "active",
		}));
	});

	test.each(["我们有哪些记忆", "我们有那些记忆", "有哪些记忆", "有那些记忆", "所有记忆", "全部记忆", "记忆概览"])(
		"routes Chinese conversational memory browse request %s to graph context",
		async (query) => {
			resolveMemorixProjectContext.mockResolvedValue({
				canonicalId: "AVIDS2/memorix",
				dataDir: "C:\\Users\\Lenovo\\.memorix\\data",
			});
			getAllObservations.mockReturnValue([{ id: 2, projectId: "AVIDS2/memorix", title: "Memory overview" }]);
			compactGraphContext.mockReturnValue({
				projectId: "AVIDS2/memorix",
				query,
				summary: "1 high-signal memories · 1 entity cluster(s) · 0 relation(s) · 0 risk signal(s)",
				entities: [],
				edges: [],
				memories: [{ id: 2, title: "Memory overview", type: "decision", entityName: "memcode-runtime", status: "active", reason: "core memory" }],
				risks: [],
				audit: { issues: { hookNoise: [], orphans: [], retentionCandidates: [] } },
			});
			formatGraphContextPrompt.mockReturnValue("## Memory Context Packet\n\n- #2 Memory overview");

			const result = await memorixSearchTool.execute(
				"tool-1",
				{ query },
				undefined,
				undefined,
				{ cwd: "E:\\project\\memorix" } as any,
			);

			expect(compactSearch).not.toHaveBeenCalled();
			expect(compactGraphContext).toHaveBeenCalledWith(expect.any(Array), expect.objectContaining({
				projectId: "AVIDS2/memorix",
				query,
			}));
			expect(result.content[0]?.text).toContain("## Memory Context Packet");
		},
	);

	test("routes generic bug/problem history keyword searches to graph context", async () => {
		resolveMemorixProjectContext.mockResolvedValue({
			canonicalId: "AVIDS2/memorix",
			dataDir: "C:\\Users\\Lenovo\\.memorix\\data",
		});
		getAllObservations.mockReturnValue([{ id: 3, projectId: "AVIDS2/memorix", title: "Bug history packet" }]);
		compactGraphContext.mockReturnValue({
			projectId: "AVIDS2/memorix",
			query: "bug 问题 踩坑 problem solution fix",
			summary: "1 high-signal memories · 1 entity cluster(s) · 0 relation(s) · 0 risk signal(s)",
			entities: [],
			edges: [],
			memories: [{ id: 3, title: "Bug history packet", type: "problem-solution", entityName: "memcode-runtime", status: "active", reason: "bug history" }],
			risks: [],
			audit: { issues: { hookNoise: [], orphans: [], retentionCandidates: [] } },
		});
		formatGraphContextPrompt.mockReturnValue("## Memory Context Packet\n\n- #3 Bug history packet");

		const result = await memorixSearchTool.execute(
			"tool-1",
			{ query: "bug 问题 踩坑 problem solution fix" },
			undefined,
			undefined,
			{ cwd: "E:\\project\\memorix" } as any,
		);

		expect(compactSearch).not.toHaveBeenCalled();
		expect(compactGraphContext).toHaveBeenCalledWith(expect.any(Array), expect.objectContaining({
			projectId: "AVIDS2/memorix",
			query: "bug 问题 踩坑 problem solution fix",
		}));
		expect(result.content[0]?.text).toContain("Bug history packet");
	});
});

describe("memorix_detail native tool", () => {
	test("passes project-scoped typed refs from search results through unchanged", async () => {
		resolveMemorixProjectContext.mockResolvedValue({
			canonicalId: "AVIDS2/memorix",
			dataDir: "C:\\Users\\Lenovo\\.memorix\\data",
		});
		compactDetail.mockResolvedValue({
			documents: [{ observationId: 2272, title: "Activity (discovery)" }],
			formatted: "#2272 Activity (discovery)",
			totalTokens: 12,
		});

		const result = await memorixDetailTool.execute(
			"tool-1",
			{ typedRefs: ["obs:2272@AVIDS2/memorix"] },
			undefined,
			undefined,
			{ cwd: "E:\\project\\memorix" } as any,
		);

		expect(compactDetail).toHaveBeenCalledWith(["obs:2272@AVIDS2/memorix"]);
		expect(result.content[0]?.text).toContain("Activity (discovery)");
	});
});

describe("memorix_graph_context native tool", () => {
	test("builds a graph context packet from project memories", async () => {
		resolveMemorixProjectContext.mockResolvedValue({
			canonicalId: "AVIDS2/memorix",
			dataDir: "C:\\Users\\Lenovo\\.memorix\\data",
		});
		getAllObservations.mockReturnValue([{ id: 1, projectId: "AVIDS2/memorix", title: "GraphContext packet" }]);
		compactGraphContext.mockReturnValue({
			projectId: "AVIDS2/memorix",
			query: "memcode memory graph",
			summary: "2 high-signal memories · 1 entity cluster(s) · 1 relation(s) · 0 risk signal(s)",
			entities: [{ name: "memcode-runtime", observationIds: [1], relatedEntityNames: [], coreCount: 1, activeCount: 1 }],
			edges: [{ from: "memcode-runtime", to: "commit:abc1234", type: "cites_commit" }],
			memories: [{ id: 1, title: "GraphContext packet", type: "decision", entityName: "memcode-runtime", status: "active", reason: "core memory" }],
			risks: [],
			audit: { issues: { hookNoise: [], orphans: [], retentionCandidates: [] } },
		});
		formatGraphContextPrompt.mockReturnValue("## Memory Context Packet\n\n- #1 GraphContext packet");

		const result = await memorixGraphContextTool.execute(
			"tool-1",
			{ query: "memcode memory graph", limit: 3 },
			undefined,
			undefined,
			{ cwd: "E:\\project\\memorix" } as any,
		);

		expect(initObservations).toHaveBeenCalledWith("C:\\Users\\Lenovo\\.memorix\\data");
		expect(ensureFreshObservations).toHaveBeenCalled();
		expect(prepareSearchIndex).not.toHaveBeenCalled();
		expect(compactGraphContext).toHaveBeenCalledWith(expect.arrayContaining([
			expect.objectContaining({ id: 1, projectId: "AVIDS2/memorix" }),
		]), expect.objectContaining({
			projectId: "AVIDS2/memorix",
			query: "memcode memory graph",
			limit: 3,
		}));
		expect(formatGraphContextPrompt).toHaveBeenCalled();
		expect(result.content[0]?.text).toContain("## Memory Context Packet");
		expect(result.content[0]?.text).toContain("GraphContext packet");
	});
});
