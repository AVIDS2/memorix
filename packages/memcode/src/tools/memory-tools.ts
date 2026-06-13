/**
 * Memorix Native Memory Tools
 *
 * Direct in-process tools that call Memorix functions without MCP transport.
 * These tools give memcode agents native access to the memory layer.
 */

import { Type } from "typebox";
import type { ToolDefinition } from "../core/extensions/types.ts";
import { importFromMemorix } from "../core/memorix-resolve.ts";
import { formatMemorixRuntimeStatus, getMemorixRuntimeContext, resolveMemorixProjectContext } from "../memory/memorix-runtime-context.ts";

// Dynamic imports for memorix core — uses file:// URLs for Windows ESM compatibility
async function getCompactSearch() {
	const mod = await importFromMemorix("compact/engine.js");
	return mod.compactSearch;
}
async function getCompactDetail() {
	const mod = await importFromMemorix("compact/engine.js");
	return mod.compactDetail;
}
async function getStoreObservation() {
	const mod = await importFromMemorix("memory/observations.js");
	return mod.storeObservation;
}
/** Resolve projectId from cwd using memorix project detection (git remote → AVIDS2/memorix) */
async function resolveProjectId(cwd: string): Promise<string> {
	try {
		return (await resolveMemorixProjectContext(cwd)).canonicalId;
	} catch {
		return cwd;
	}
}

// ============================================================================
// memorix_search — Compact index search
// ============================================================================

const searchParams = Type.Object({
	query: Type.String({ description: "Search query (natural language or keywords)" }),
	limit: Type.Optional(Type.Number({ description: "Max results (default: 20)" })),
	type: Type.Optional(
		Type.String({
			description:
				"Filter by observation type: gotcha, decision, problem-solution, how-it-works, what-changed, discovery, why-it-exists, trade-off, reasoning, session-request, probe",
		}),
	),
	maxTokens: Type.Optional(Type.Number({ description: "Token budget — trim results to fit (0 = unlimited)" })),
	since: Type.Optional(
		Type.String({ description: "Only return observations created after this date (ISO 8601)" }),
	),
	until: Type.Optional(
		Type.String({ description: "Only return observations created before this date (ISO 8601)" }),
	),
	status: Type.Optional(
		Type.String({
			description: 'Filter by memory status: "active" (default), "resolved", "archived", or "all"',
		}),
	),
});

export const memorixSearchTool: ToolDefinition<typeof searchParams> = {
	name: "memorix_search",
	label: "Search Memory",
	description:
		"Search project memory. Returns a compact index (~50-100 tokens/result). " +
		"Use memorix_detail to fetch full content for specific IDs.",
	promptSnippet: "Search Memorix cross-session memory for project context",
	promptGuidelines: [
		"Use memorix_search when prior project context would help — past decisions, bugs, changes.",
		"After scanning search results, use memorix_detail to fetch full content for relevant IDs.",
	],
	parameters: searchParams,
	async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
		try {
			const compactSearch = await getCompactSearch();
			const projectId = await resolveProjectId(ctx.cwd);
			const result = await compactSearch({
				query: params.query,
				projectId,
				limit: params.limit,
				type: params.type as any,
				maxTokens: params.maxTokens,
				since: params.since,
				until: params.until,
				status: (params.status as any) ?? "active",
			});

			return {
				content: [{ type: "text", text: result.formatted }],
				details: {
					entryCount: result.entries.length,
					totalTokens: result.totalTokens,
				},
			};
		} catch (err) {
			return {
				content: [
					{
						type: "text",
						text: `Search failed: ${err instanceof Error ? err.message : String(err)}`,
					},
				],
				details: { error: true },
			};
		}
	},
};

// ============================================================================
// memorix_store — Store a new observation
// ============================================================================

const storeParams = Type.Object({
	entityName: Type.String({
		description: 'The entity this observation belongs to (e.g., "auth-module", "port-config")',
	}),
	type: Type.String({
		description:
			"Observation type: gotcha, decision, problem-solution, how-it-works, what-changed, discovery, why-it-exists, trade-off, reasoning, session-request",
	}),
	title: Type.String({ description: "Short descriptive title (~5-10 words)" }),
	narrative: Type.String({ description: "Full description of the observation" }),
	facts: Type.Optional(Type.Array(Type.String(), { description: "Structured facts (e.g., 'Default timeout: 60s')" })),
	filesModified: Type.Optional(Type.Array(Type.String(), { description: "Files involved" })),
	concepts: Type.Optional(Type.Array(Type.String(), { description: "Related concepts/keywords" })),
	topicKey: Type.Optional(
		Type.String({
			description:
				"Optional topic identifier for upserts. If an observation with the same topicKey exists, it will be UPDATED instead of creating a new one.",
		}),
	),
});

export const memorixStoreTool: ToolDefinition<typeof storeParams> = {
	name: "memorix_store",
	label: "Store Memory",
	description:
		"Store a new observation/memory. Automatically indexed for search. " +
		"Use type to classify: gotcha (critical pitfall), decision (architecture choice), " +
		"problem-solution (bug fix), how-it-works (explanation), what-changed (change), " +
		"discovery (insight), why-it-exists (rationale), trade-off (compromise).",
	promptSnippet: "Store an observation in Memorix cross-session memory",
	promptGuidelines: [
		"Use memorix_store when you learn something a future session should not have to rediscover.",
		"Use concise titles (~5-10 words). Include filesModified when relevant.",
	],
	parameters: storeParams,
	async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
		try {
			const storeObservation = await getStoreObservation();
			const projectId = await resolveProjectId(ctx.cwd);
			const result = await storeObservation({
				entityName: params.entityName,
				type: params.type as any,
				title: params.title,
				narrative: params.narrative,
				facts: params.facts,
				filesModified: params.filesModified,
				concepts: params.concepts,
				projectId,
				topicKey: params.topicKey,
			});

			const obs = result.observation;
			const action = result.upserted ? "Updated" : "Stored";

			return {
				content: [
					{
						type: "text",
						text: `[OK] ${action} observation #${obs.id}: "${obs.title}" (${obs.type})`,
					},
				],
				details: {
					id: obs.id,
					type: obs.type,
					title: obs.title,
					upserted: result.upserted,
				},
			};
		} catch (err) {
			return {
				content: [
					{
						type: "text",
						text: `Store failed: ${err instanceof Error ? err.message : String(err)}`,
					},
				],
				details: { error: true },
			};
		}
	},
};

// ============================================================================
// memorix_detail — Fetch full observation detail
// ============================================================================

const detailParams = Type.Object({
	ids: Type.Array(Type.Number(), {
		description: "Observation IDs to fetch (from memorix_search results)",
	}),
});

export const memorixDetailTool: ToolDefinition<typeof detailParams> = {
	name: "memorix_detail",
	label: "Memory Details",
	description:
		"Fetch full observation details by ID (~500-1000 tokens each). " +
		"Always use memorix_search first to find relevant IDs, then fetch only what you need.",
	promptSnippet: "Fetch full detail for specific Memorix observation IDs",
	promptGuidelines: [
		"Use memorix_detail after memorix_search to get full content for specific observation IDs.",
		"Only fetch IDs you actually need — each result costs ~500-1000 tokens.",
	],
	parameters: detailParams,
	async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
		try {
			if (params.ids.length === 0) {
				return {
					content: [{ type: "text", text: "No observation IDs provided." }],
					details: { count: 0 },
				};
			}

			// Use compactDetail for rich formatted output with cross-references
			const compactDetail = await getCompactDetail();
			const result = await compactDetail(params.ids);

			return {
				content: [
					{
						type: "text",
						text:
							result.documents.length > 0
								? result.formatted
								: `No memories found for IDs: ${params.ids.join(", ")}`,
					},
				],
				details: {
					count: result.documents.length,
					totalTokens: result.totalTokens,
				},
			};
		} catch (err) {
			return {
				content: [
					{
						type: "text",
						text: `Detail fetch failed: ${err instanceof Error ? err.message : String(err)}`,
					},
				],
				details: { error: true },
			};
		}
	},
};

// ============================================================================
// memorix_status — Native runtime awareness
// ============================================================================

const statusParams = Type.Object({});

export const memorixStatusTool: ToolDefinition<typeof statusParams> = {
	name: "memorix_status",
	label: "Memory Status",
	description:
		"Inspect memcode's native Memorix runtime: canonical project identity, shared aliases, " +
		"memory counts, embedding/vector status, search mode, retention posture, and native hooks.",
	promptSnippet: "Inspect native Memorix runtime status for this project",
	promptGuidelines: [
		"Use memorix_status when the user asks what memory is active, which project memory is shared, or how Memorix is configured.",
		"Use memorix_status before answering questions about embedding, BM25 fallback, rerank, retention, hooks, or memory injection state.",
	],
	parameters: statusParams,
	async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
		try {
			const status = await getMemorixRuntimeContext(ctx.cwd);
			return {
				content: [{ type: "text", text: formatMemorixRuntimeStatus(status) }],
				details: {
					projectId: status.project.canonicalId,
					aliases: status.project.aliases,
					searchMode: status.search.mode,
					embeddingProvider: status.embedding.provider,
				},
			};
		} catch (err) {
			return {
				content: [
					{
						type: "text",
						text: `Status failed: ${err instanceof Error ? err.message : String(err)}`,
					},
				],
				details: { error: true },
			};
		}
	},
};

// ============================================================================
// Exports
// ============================================================================

/** All three Memorix memory tools. */
export const memoryTools = [memorixSearchTool, memorixStoreTool, memorixDetailTool, memorixStatusTool];
