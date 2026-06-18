import { importFromMemorix } from "../core/memorix-resolve.ts";
import { getMemorixHookBridgeStatus, type MemorixHookBridgeStatus } from "./memorix-hook-bridge.ts";

export interface MemorixRuntimeContext {
	project: {
		cwd: string;
		detectedId: string;
		canonicalId: string;
		aliases: string[];
		rootPath?: string;
		gitRemote?: string;
		dataDir?: string;
	};
	memory: {
		totalCount: number;
		activeCount: number;
		sharedAliasCount: number;
		byType: Record<string, number>;
		bySourceDetail: Record<string, number>;
		byValueCategory: Record<string, number>;
		lastInjectedRefs: string[];
	};
	search: {
		mode: string;
		probed: boolean;
		indexPrepared: boolean;
	};
	embedding: {
		configuredMode: string;
		enabledInIndex: boolean;
		provider: string | null;
		dimensions: number | null;
		vectorTotal: number;
		vectorMissing: number;
		backfillRunning: boolean;
		lastBackfill?: {
			attempted: number;
			succeeded: number;
			failed: number;
			lastError?: string;
			finishedAt?: string;
		} | null;
		explicitlyDisabled: boolean;
	};
	llm: {
		enabled: boolean;
		provider?: string;
		model?: string;
		baseUrl?: string;
	};
	retention: {
		active: number;
		stale: number;
		archiveCandidates: number;
		immune: number;
	};
	hooks: MemorixHookBridgeStatus;
}

export type MemorixRuntimeContextMode = "full" | "footer";

export interface MemorixRuntimeContextOptions {
	/**
	 * full: explicit diagnostics for /memory status, may prepare/probe indexes.
	 * footer: fast observability snapshot for TUI startup, never triggers heavy work.
	 */
	mode?: MemorixRuntimeContextMode;
}

let lastInjectedRefs: string[] = [];

type ObservationLike = {
	id: number;
	projectId?: string;
	status?: string;
	type?: string;
	sourceDetail?: string;
	valueCategory?: string;
	entityName?: string;
	title?: string;
	narrative?: string;
	facts?: string[];
	filesModified?: string[];
	concepts?: string[];
	tokens?: number;
	createdAt?: string;
	source?: string;
	accessCount?: number;
	lastAccessedAt?: string;
};

export function recordMemorixInjectedRefs(entries: Array<{ id: number; projectId?: string }>): void {
	lastInjectedRefs = entries.slice(0, 8).map((entry) =>
		entry.projectId ? `obs:${entry.id}@${entry.projectId}` : `obs:${entry.id}`,
	);
}

export function getLastMemorixInjectedRefs(): string[] {
	return [...lastInjectedRefs];
}

function increment(map: Record<string, number>, key: string | undefined): void {
	const resolved = key && key.trim() ? key : "unknown";
	map[resolved] = (map[resolved] ?? 0) + 1;
}

function toRetentionDocument(obs: ObservationLike) {
	return {
		id: `obs-${obs.projectId ?? ""}-${obs.id}`,
		observationId: obs.id,
		entityName: obs.entityName ?? "",
		type: obs.type ?? "discovery",
		title: obs.title ?? "",
		narrative: obs.narrative ?? "",
		facts: (obs.facts ?? []).join("\n"),
		filesModified: (obs.filesModified ?? []).join("\n"),
		concepts: (obs.concepts ?? []).join(", "),
		tokens: obs.tokens ?? 0,
		createdAt: obs.createdAt ?? new Date().toISOString(),
		projectId: obs.projectId ?? "",
		accessCount: obs.accessCount ?? 0,
		lastAccessedAt: obs.lastAccessedAt ?? "",
		status: obs.status ?? "active",
		source: obs.source ?? "agent",
		sourceDetail: obs.sourceDetail ?? "",
		valueCategory: obs.valueCategory ?? "",
	};
}

export async function resolveMemorixProjectContext(cwd: string): Promise<MemorixRuntimeContext["project"]> {
	const { detectProject } = await importFromMemorix("project/detector.js");
	const { getProjectDataDir } = await importFromMemorix("store/persistence.js");
	const { initAliasRegistry, registerAlias, resolveAliases } = await importFromMemorix("project/aliases.js");

	const detected = detectProject(cwd);
	const detectedId = detected?.id ?? cwd;
	const dataDir = await getProjectDataDir(detectedId);
	initAliasRegistry(dataDir);

	let canonicalId = detectedId;
	if (detected) {
		canonicalId = await registerAlias(detected, dataDir);
	}
	const aliases = await resolveAliases(canonicalId, dataDir);

	return {
		cwd,
		detectedId,
		canonicalId,
		aliases,
		rootPath: detected?.rootPath,
		gitRemote: detected?.gitRemote,
		dataDir,
	};
}

export async function getMemorixRuntimeContext(
	cwd: string,
	options: MemorixRuntimeContextOptions = {},
): Promise<MemorixRuntimeContext> {
	const mode = options.mode ?? "full";
	const project = await resolveMemorixProjectContext(cwd);

	const observationsMod = await importFromMemorix("memory/observations.js");
	await observationsMod.initObservations?.(project.dataDir);
	await observationsMod.ensureFreshObservations?.();
	const allObs = (observationsMod.getAllObservations?.() ?? []) as ObservationLike[];
	const aliasSet = new Set(project.aliases);
	const projectObs = allObs.filter((obs) => obs.projectId && aliasSet.has(obs.projectId));
	const activeObs = projectObs.filter((obs) => (obs.status ?? "active") === "active");

	const byType: Record<string, number> = {};
	const bySourceDetail: Record<string, number> = {};
	const byValueCategory: Record<string, number> = {};
	for (const obs of activeObs) {
		increment(byType, obs.type);
		increment(bySourceDetail, obs.sourceDetail);
		increment(byValueCategory, obs.valueCategory);
	}

	const oramaMod = await importFromMemorix("store/orama-store.js");
	const configMod = await importFromMemorix("config.js");
	const configuredEmbeddingMode = configMod.getEmbeddingMode?.() ?? process.env.MEMORIX_EMBEDDING ?? "off";
	const configuredEmbeddingModel = configMod.getEmbeddingModel?.() ?? process.env.MEMORIX_EMBEDDING_MODEL;
	const configuredEmbeddingApiKey = configMod.getEmbeddingApiKey?.();
	let searchIndexPrepared = false;
	if (mode === "full" && activeObs.length > 0 && typeof observationsMod.prepareSearchIndex === "function") {
		try {
			await observationsMod.prepareSearchIndex();
			searchIndexPrepared = true;
		} catch {
			searchIndexPrepared = false;
		}
	}
	let searchIndexStatus = observationsMod.getSearchIndexStatus?.(project.canonicalId) ?? {
		embeddingEnabled: Boolean(oramaMod.isEmbeddingEnabled?.()),
		vectorDimensions: oramaMod.getVectorDimensions?.() ?? null,
		lastSearchMode: oramaMod.getLastSearchMode?.(project.canonicalId) ?? "fulltext",
		prepared: searchIndexPrepared,
	};
	const indexVectorDimensions = searchIndexStatus.vectorDimensions ?? null;
	const embeddingProvider =
		configuredEmbeddingMode === "off"
			? null
			: configuredEmbeddingMode === "api" || (configuredEmbeddingMode === "auto" && configuredEmbeddingApiKey)
				? `api-${configuredEmbeddingModel ?? "embedding"}`
				: configuredEmbeddingMode;
	const vectorStatus = observationsMod.getVectorStatus?.() ?? {
		total: projectObs.length,
		missing: 0,
		backfillRunning: false,
	};
	let backfillTriggered = false;
	if (
		mode === "full" &&
		configuredEmbeddingMode !== "off" &&
		(vectorStatus.missing ?? 0) > 0 &&
		typeof observationsMod.backfillVectorEmbeddings === "function"
	) {
		backfillTriggered = true;
		observationsMod.backfillVectorEmbeddings().catch(() => {});
	}
	const refreshedVectorStatus = observationsMod.getVectorStatus?.() ?? vectorStatus;
	let searchMode = searchIndexStatus.lastSearchMode ?? "fulltext";
	let searchProbed = false;
	const vectorsReady = (refreshedVectorStatus.total ?? projectObs.length) > 0 && (refreshedVectorStatus.missing ?? 0) === 0;
	const shouldProbeSearch =
		mode === "full" &&
		searchMode === "fulltext" &&
		activeObs.length > 0 &&
		configuredEmbeddingMode !== "off" &&
		Boolean(searchIndexStatus.embeddingEnabled) &&
		vectorsReady;
	if (shouldProbeSearch && (typeof observationsMod.probeSearchIndex === "function" || typeof oramaMod.searchObservations === "function")) {
		try {
			if (typeof observationsMod.probeSearchIndex === "function") {
				searchMode = await observationsMod.probeSearchIndex(project.canonicalId);
			} else {
				await oramaMod.searchObservations({
					query: "semantic memory retrieval status",
					projectId: project.canonicalId,
					limit: 1,
					status: "all",
					trackAccess: false,
				});
				searchMode = oramaMod.getLastSearchMode?.(project.canonicalId) ?? searchMode;
			}
			searchProbed = true;
		} catch {
			searchIndexStatus = observationsMod.getSearchIndexStatus?.(project.canonicalId) ?? searchIndexStatus;
			searchMode = searchIndexStatus.lastSearchMode ?? "fulltext (semantic probe failed)";
			searchProbed = true;
		}
	}
	searchIndexStatus = observationsMod.getSearchIndexStatus?.(project.canonicalId) ?? searchIndexStatus;

	const llmMod = await importFromMemorix("llm/provider.js");
	const llmConfig = llmMod.initLLM?.({ scope: "memory" }) ?? llmMod.getLLMConfig?.() ?? null;

	let retention = { active: activeObs.length, stale: 0, archiveCandidates: 0, immune: 0 };
	if (mode === "full") {
		try {
			const retentionMod = await importFromMemorix("memory/retention.js");
			retention = retentionMod.getRetentionSummary(projectObs.map(toRetentionDocument));
		} catch {
			// Retention status is observability-only; keep the rest of the context intact.
		}
	}

	return {
		project,
		memory: {
			totalCount: projectObs.length,
			activeCount: activeObs.length,
			sharedAliasCount: project.aliases.length,
			byType,
			bySourceDetail,
			byValueCategory,
			lastInjectedRefs: getLastMemorixInjectedRefs(),
		},
		search: {
			mode: searchMode,
			probed: searchProbed,
			indexPrepared: searchIndexPrepared,
		},
		embedding: {
			configuredMode: configuredEmbeddingMode,
			enabledInIndex: Boolean(searchIndexStatus.embeddingEnabled),
			provider: embeddingProvider,
			dimensions: configMod.getEmbeddingDimensions?.() ?? indexVectorDimensions,
			vectorTotal: refreshedVectorStatus.total ?? projectObs.length,
			vectorMissing: refreshedVectorStatus.missing ?? 0,
			backfillRunning: Boolean(refreshedVectorStatus.backfillRunning || backfillTriggered),
			lastBackfill: refreshedVectorStatus.lastBackfill ?? null,
			explicitlyDisabled: configuredEmbeddingMode === "off",
		},
		llm: llmConfig
			? {
					enabled: true,
					provider: llmConfig.provider,
					model: llmConfig.model,
					baseUrl: llmConfig.baseUrl,
				}
			: { enabled: false },
		retention,
		hooks: getMemorixHookBridgeStatus(),
	};
}

function formatMemoryNextHint(context: MemorixRuntimeContext): string {
	if (!context.embedding.explicitlyDisabled && context.embedding.enabledInIndex && context.embedding.vectorMissing > 0) {
		return "embeddings are warming; semantic search will enable after backfill";
	}

	if (!context.embedding.provider && !context.embedding.explicitlyDisabled) {
		return "semantic search is unavailable; configure embedding to unlock vector recall";
	}

	if (!context.hooks.active) {
		return "native hooks are inactive; restart memcode or check the hook bridge";
	}

	return "memory runtime looks ready";
}

export function formatMemorixRuntimeStatus(context: MemorixRuntimeContext): string {
	const embedded = context.embedding.vectorTotal - context.embedding.vectorMissing;

	const searchModeLabel =
		context.embedding.provider &&
		context.embedding.enabledInIndex &&
		context.embedding.vectorTotal > 0 &&
		context.embedding.vectorMissing > 0
			? "semantic warming (BM25/fulltext until vectors finish)"
			: `${context.search.mode}${context.search.probed ? " (verified now)" : ""}`;
	const hookCounts = Object.entries(context.hooks.counts)
		.filter(([, count]) => (count ?? 0) > 0)
		.map(([event, count]) => `${event} ${count}`)
		.join(", ");
	const lines: string[] = [
		"## Memorix Status",
		`- Project: ${context.project.canonicalId}`,
		`- Memory: ${context.memory.activeCount} active / ${context.memory.totalCount} shared`,
		`- Search: ${searchModeLabel}`,
		`- Embedding: ${
			context.embedding.provider
				? `${context.embedding.provider} · ${embedded}/${context.embedding.vectorTotal} vectors${context.embedding.dimensions ? ` · ${context.embedding.dimensions}d` : ""}${context.embedding.backfillRunning ? " · backfill running" : ""}`
				: context.embedding.explicitlyDisabled
					? "off · BM25 fulltext"
					: "unavailable · BM25 fallback"
		}`,
		`- Memory LLM: ${
			context.llm.enabled
				? `${context.llm.provider ?? "custom"}/${context.llm.model ?? "unknown"}`
				: "off"
		}`,
		`- Retention: ${context.retention.active} active · ${context.retention.stale} stale · ${context.retention.archiveCandidates} archive candidates · ${context.retention.immune} immune`,
		`- Hooks: ${context.hooks.active ? "active" : "inactive"}${hookCounts ? ` · ${hookCounts}` : ""}`,
		`- Injection: ${context.memory.lastInjectedRefs.length > 0 ? context.memory.lastInjectedRefs.join(", ") : "none this process"}`,
		`- Next: ${formatMemoryNextHint(context)}`,
	];

	if (context.search.probed || context.embedding.vectorMissing > 0 || context.hooks.lastError || context.embedding.lastBackfill) {
		lines.splice(8, 0, `- Status: ${context.search.probed ? "verified" : "observed"}`);
	}

	return lines.join("\n");
}

export function formatMemcodeFooterMemoryStatus(context: MemorixRuntimeContext): string {
	const embedded = context.embedding.vectorTotal - context.embedding.vectorMissing;
	const semanticSearchActive = Boolean(context.embedding.provider) && context.embedding.enabledInIndex;
	const searchMode = semanticSearchActive
		? context.embedding.vectorMissing === 0 && context.embedding.vectorTotal > 0
			? "semantic ready"
			: "semantic warming"
		: context.search.probed
			? `${context.search.mode}✓`
			: context.search.mode;
	const embeddingStatus = context.embedding.provider
		? `Embedding: ${embedded}/${context.embedding.vectorTotal}`
		: context.embedding.explicitlyDisabled
			? "Embedding: off"
			: "Embedding: fallback";

	return [
		`Memory: ${context.memory.activeCount} active / ${context.memory.totalCount} shared`,
		`Search: ${searchMode}`,
		embeddingStatus,
	].join(" · ");
}
