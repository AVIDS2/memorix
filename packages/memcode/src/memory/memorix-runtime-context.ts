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
	};
	embedding: {
		configuredMode: string;
		enabledInIndex: boolean;
		provider: string | null;
		dimensions: number | null;
		vectorTotal: number;
		vectorMissing: number;
		backfillRunning: boolean;
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

export async function getMemorixRuntimeContext(cwd: string): Promise<MemorixRuntimeContext> {
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
	const indexVectorDimensions = oramaMod.getVectorDimensions?.() ?? null;
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

	const llmMod = await importFromMemorix("llm/provider.js");
	const llmConfig = llmMod.initLLM?.({ scope: "memory" }) ?? llmMod.getLLMConfig?.() ?? null;

	let retention = { active: activeObs.length, stale: 0, archiveCandidates: 0, immune: 0 };
	try {
		const retentionMod = await importFromMemorix("memory/retention.js");
		retention = retentionMod.getRetentionSummary(projectObs.map(toRetentionDocument));
	} catch {
		// Retention status is observability-only; keep the rest of the context intact.
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
			mode: oramaMod.getLastSearchMode?.(project.canonicalId) ?? "fulltext",
		},
		embedding: {
			configuredMode: configuredEmbeddingMode,
			enabledInIndex: Boolean(oramaMod.isEmbeddingEnabled?.()),
			provider: embeddingProvider,
			dimensions: configMod.getEmbeddingDimensions?.() ?? indexVectorDimensions,
			vectorTotal: vectorStatus.total ?? projectObs.length,
			vectorMissing: vectorStatus.missing ?? 0,
			backfillRunning: Boolean(vectorStatus.backfillRunning),
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

function formatDistribution(label: string, values: Record<string, number>): string[] {
	const entries = Object.entries(values).sort((a, b) => b[1] - a[1]);
	if (entries.length === 0) return [`${label}: none`];
	return [`${label}: ${entries.map(([key, count]) => `${key} ${count}`).join(", ")}`];
}

export function formatMemorixRuntimeStatus(context: MemorixRuntimeContext): string {
	const lines: string[] = [];
	const embedded = context.embedding.vectorTotal - context.embedding.vectorMissing;
	const pct = context.embedding.vectorTotal > 0
		? Math.round((embedded / context.embedding.vectorTotal) * 100)
		: 0;

	lines.push("Memorix Runtime Status");
	lines.push("");
	lines.push(`Project: ${context.project.canonicalId}`);
	if (context.project.detectedId !== context.project.canonicalId) {
		lines.push(`Detected as: ${context.project.detectedId}`);
	}
	lines.push(`Shared aliases: ${context.project.aliases.join(", ")}`);
	if (context.project.rootPath) lines.push(`Root: ${context.project.rootPath}`);
	if (context.project.dataDir) lines.push(`Data dir: ${context.project.dataDir}`);
	lines.push("");
	lines.push(`Memory pool: ${context.memory.activeCount} active / ${context.memory.totalCount} shared project memories`);
	lines.push(...formatDistribution("Types", context.memory.byType));
	lines.push(...formatDistribution("Sources", context.memory.bySourceDetail));
	lines.push(...formatDistribution("Value", context.memory.byValueCategory));
	lines.push(
		`Last injection: ${context.memory.lastInjectedRefs.length > 0 ? context.memory.lastInjectedRefs.join(", ") : "none this process"}`,
	);
	lines.push("");
	lines.push(`Search: ${context.search.mode}`);
	lines.push(
		`Embedding: ${
			context.embedding.provider
				? `${context.embedding.provider}${context.embedding.dimensions ? ` (${context.embedding.dimensions}d)` : ""}`
				: context.embedding.explicitlyDisabled
					? "off (BM25 fulltext)"
					: "unavailable (BM25 fallback)"
		}`,
	);
	lines.push(`Vectors: ${embedded}/${context.embedding.vectorTotal} embedded (${pct}%)${context.embedding.backfillRunning ? " · backfill running" : ""}`);
	lines.push(
		`Memory LLM: ${
			context.llm.enabled
				? `${context.llm.provider ?? "custom"}/${context.llm.model ?? "unknown"}`
				: "off (deterministic memory pipeline)"
		}`,
	);
	lines.push(
		`Retention: ${context.retention.active} active · ${context.retention.stale} stale · ${context.retention.archiveCandidates} archive candidates · ${context.retention.immune} immune`,
	);
	lines.push("");
	lines.push(`Native hooks: ${context.hooks.active ? "active" : "inactive"}`);
	const hookCounts = Object.entries(context.hooks.counts)
		.filter(([, count]) => (count ?? 0) > 0)
		.map(([event, count]) => `${event} ${count}`)
		.join(", ");
	lines.push(`Hook events: ${hookCounts || "none"}`);
	if (context.hooks.lastStoredObservation) {
		lines.push(
			`Last stored: [${context.hooks.lastStoredObservation.type}] ${context.hooks.lastStoredObservation.title}`,
		);
	}
	if (context.hooks.lastError) lines.push(`Last hook error: ${context.hooks.lastError}`);

	return lines.join("\n");
}
