import { describe, expect, test } from "vitest";

import {
	formatMemorixRuntimeStatus,
	type MemorixRuntimeContext,
} from "../src/memory/memorix-runtime-context.ts";

function runtimeContext(overrides: Partial<MemorixRuntimeContext> = {}): MemorixRuntimeContext {
	const base: MemorixRuntimeContext = {
		project: {
			cwd: "E:\\project\\memorix",
			detectedId: "AVIDS2/memorix",
			canonicalId: "AVIDS2/memorix",
			aliases: ["AVIDS2/memorix", "local/memorix"],
			rootPath: "E:\\project\\memorix",
			dataDir: "C:\\Users\\Lenovo\\.memorix\\data",
		},
		memory: {
			totalCount: 850,
			activeCount: 376,
			sharedAliasCount: 2,
			byType: {
				discovery: 95,
				"what-changed": 88,
				decision: 79,
				gotcha: 29,
			},
			bySourceDetail: {
				hook: 226,
				explicit: 106,
				"git-ingest": 42,
			},
			byValueCategory: {
				core: 24,
				contextual: 220,
				unknown: 132,
			},
			lastInjectedRefs: ["obs:2245@AVIDS2/memorix"],
		},
		search: {
			mode: "hybrid",
			probed: true,
			indexPrepared: true,
		},
		embedding: {
			configuredMode: "api",
			enabledInIndex: true,
			provider: "api-text-embedding-v4",
			dimensions: 1024,
			vectorTotal: 1345,
			vectorMissing: 0,
			backfillRunning: false,
			lastBackfill: null,
			explicitlyDisabled: false,
		},
		llm: {
			enabled: true,
			provider: "openai",
			model: "qwen3.5-flash",
			baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
		},
		retention: {
			active: 202,
			stale: 73,
			archiveCandidates: 470,
			immune: 24,
		},
		hooks: {
			active: true,
			counts: {
				session_start: 1,
				user_prompt: 3,
				post_response: 2,
			},
			lastStoredObservation: {
				id: 2245,
				type: "discovery",
				title: "GraphContext prompt formatter added",
			},
		},
	};

	return {
		...base,
		...overrides,
		project: { ...base.project, ...overrides.project },
		memory: { ...base.memory, ...overrides.memory },
		search: { ...base.search, ...overrides.search },
		embedding: { ...base.embedding, ...overrides.embedding },
		llm: { ...base.llm, ...overrides.llm },
		retention: { ...base.retention, ...overrides.retention },
		hooks: { ...base.hooks, ...overrides.hooks },
	};
}

describe("formatMemorixRuntimeStatus", () => {
	test("renders a compact product status card with a clear next action", () => {
		const output = formatMemorixRuntimeStatus(runtimeContext());

		expect(output).toContain("## Memorix Status");
		expect(output).toContain("- Project: AVIDS2/memorix");
		expect(output).toContain("- Memory: 376 active / 850 shared");
		expect(output).toContain("- Search: hybrid (verified now)");
		expect(output).toContain("- Embedding: api-text-embedding-v4 · 1345/1345 vectors · 1024d");
		expect(output).toContain("- Memory LLM: openai/qwen3.5-flash");
		expect(output).toContain("- Hooks: active");
		expect(output).toContain("- Next: memory runtime looks ready");
		expect(output).not.toContain("Data dir:");
		expect(output).not.toContain("Last backfill:");
		expect(output.split("\n").length).toBeLessThanOrEqual(18);
	});

	test("surfaces semantic warming without pretending vector search is ready", () => {
		const output = formatMemorixRuntimeStatus(runtimeContext({
			search: { mode: "fulltext", probed: false, indexPrepared: true },
			embedding: {
				vectorTotal: 1345,
				vectorMissing: 241,
				backfillRunning: true,
			},
		}));

		expect(output).toContain("- Search: semantic warming (BM25/fulltext until vectors finish)");
		expect(output).toContain("- Embedding: api-text-embedding-v4 · 1104/1345 vectors · 1024d · backfill running");
		expect(output).toContain("- Next: embeddings are warming; semantic search will enable after backfill");
	});
});
