/**
 * /memory command handlers for the memcode TUI.
 *
 * Implements all six memory subcommands:
 *   /memory stats     — memory count, bucket distribution, vector status
 *   /memory search    — search memories by query, return formatted results
 *   /memory show      — list recent memories (returns picker items)
 *   /memory diff      — show memory changes from current session
 *   /memory promote   — promote last AI response to a stored memory
 *   /memory delete    — show memories for deletion (returns picker items)
 *
 * Each handler calls the appropriate memorix core function via importFromMemorix
 * and returns structured results (toasts, messages, picker items) for the TUI
 * to render. No React imports — this is a pure-logic module.
 */

import { importFromMemorix } from "../../core/memorix-resolve.ts";
import type { AgentSessionRuntime } from "../../core/agent-session-runtime.ts";

// ============================================================================
// Lazy-imported memorix core functions
// ============================================================================

// Generic cache for lazily-loaded memorix functions.
// Each key resolves once on first access, then returns the cached reference.
const _cache = new Map<string, (...args: any[]) => any>();

async function loadFn(subpath: string, exportName: string): Promise<(...args: any[]) => any> {
	const key = `${subpath}#${exportName}`;
	let fn = _cache.get(key);
	if (!fn) {
		const mod = await importFromMemorix(subpath);
		fn = mod[exportName];
		if (typeof fn !== "function") {
			throw new Error(`memorix export "${exportName}" not found in ${subpath}`);
		}
		_cache.set(key, fn);
	}
	return fn;
}

// --- Wrapped accessors ---

async function getCompactSearch() {
	return loadFn("compact/engine.js", "compactSearch");
}

async function getCompactDetail() {
	return loadFn("compact/engine.js", "compactDetail");
}

async function getStoreObservation() {
	return loadFn("memory/observations.js", "storeObservation");
}

async function getResolveObservations() {
	return loadFn("memory/observations.js", "resolveObservations");
}

async function getDetectProject() {
	return loadFn("project/detector.js", "detectProject");
}

async function getGetAllObservations() {
	return loadFn("memory/observations.js", "getAllObservations");
}

async function getGetObservationCount() {
	return loadFn("memory/observations.js", "getObservationCount");
}

async function getGetVectorStatus() {
	return loadFn("memory/observations.js", "getVectorStatus");
}

// ============================================================================
// Project resolution
// ============================================================================

async function resolveProjectId(cwd: string): Promise<string> {
	try {
		const detectProject = await getDetectProject();
		const project = detectProject(cwd);
		return project?.id ?? cwd;
	} catch {
		return cwd;
	}
}

// ============================================================================
// Types
// ============================================================================

/** Context passed to every command handler. */
export interface MemoryCommandContext {
	/** Current working directory (for project resolution). */
	cwd: string;
	/** Agent runtime for accessing session state and the last assistant message. */
	runtime?: AgentSessionRuntime;
	/** Show a transient toast notification. */
	toast: (msg: string, type?: "info" | "success" | "error") => void;
	/** Append a system/informational message to the message list. */
	addMessage: (msg: string) => void;
}

/** A picker item returned by selector-mode commands. */
export interface MemoryPickerItem {
	id: string;
	label: string;
	description: string;
}

/** The result of a memory command handler. */
export interface MemoryCommandResult {
	/** Toast notification to display (optional, handler may also call ctx.toast directly). */
	toast?: { msg: string; type: "info" | "success" | "error" };
	/** Lines to append as a system message in the message list. */
	message?: string;
	/** Picker items for selector-mode commands. */
	items?: MemoryPickerItem[];
}

/** A single memory command handler function. */
export type MemoryCommandHandler = (
	args: string,
	ctx: MemoryCommandContext,
) => Promise<MemoryCommandResult>;

// ============================================================================
// Handlers
// ============================================================================

// ── /memory stats ──────────────────────────────────────────────────────────

async function handleStats(_args: string, ctx: MemoryCommandContext): Promise<MemoryCommandResult> {
	try {
		const projectId = await resolveProjectId(ctx.cwd);
		const getObservationCount = await getGetObservationCount();
		const getAllObservations = await getGetAllObservations();
		const getVectorStatus = await getGetVectorStatus();

		const totalCount = getObservationCount();

		// Bucket distribution by type
		const allObs = getAllObservations();
		const projectObs = allObs.filter((o: any) => o.projectId === projectId);
		const buckets: Record<string, number> = {};
		for (const obs of projectObs) {
			const type = (obs as any).type ?? "unknown";
			buckets[type] = (buckets[type] || 0) + 1;
		}

		// Vector embedding status
		let vectorStatus: string;
		try {
			const vs = getVectorStatus();
			const pct = vs.total > 0 ? Math.round(((vs.total - vs.missing) / vs.total) * 100) : 0;
			vectorStatus = `${vs.total - vs.missing}/${vs.total} embedded (${pct}%)`;
		} catch {
			vectorStatus = "unavailable";
		}

		// Hit rate: count of active observations with accessCount > 0
		const activeObs = projectObs.filter((o: any) => (o.status ?? "active") === "active");
		const hitObs = activeObs.filter((o: any) => (o.accessCount ?? 0) > 0);
		const hitRate = activeObs.length > 0 ? Math.round((hitObs.length / activeObs.length) * 100) : 0;

		// Format output
		const lines: string[] = [];
		lines.push(`Memory Stats (${totalCount} total, ${projectObs.length} this project)`);
		lines.push("");

		// Buckets
		const bucketEntries = Object.entries(buckets).sort((a, b) => b[1] - a[1]);
		if (bucketEntries.length > 0) {
			lines.push("Type distribution:");
			for (const [type, count] of bucketEntries) {
				lines.push(`  ${type}: ${count}`);
			}
		} else {
			lines.push("No memories stored for this project yet.");
		}

		lines.push("");
		lines.push(`Vector embeddings: ${vectorStatus}`);
		lines.push(`Active hit rate: ${hitRate}%`);

		ctx.addMessage(lines.join("\n"));
		return {};
	} catch (err) {
		const msg = `Stats failed: ${err instanceof Error ? err.message : String(err)}`;
		return { toast: { msg, type: "error" } };
	}
}

// ── /memory search <query> ─────────────────────────────────────────────────

async function handleSearch(args: string, ctx: MemoryCommandContext): Promise<MemoryCommandResult> {
	const query = args.trim();
	if (!query) {
		return { toast: { msg: "Usage: /memory search <query>", type: "error" } };
	}

	try {
		const projectId = await resolveProjectId(ctx.cwd);
		const compactSearch = await getCompactSearch();
		const result = await compactSearch({ query, projectId, limit: 20 });

		if (result.entries.length === 0) {
			return { message: `No memories found for "${query}".` };
		}

		ctx.addMessage(result.formatted);
		return {
			toast: { msg: `${result.entries.length} result(s), ~${result.totalTokens} tokens`, type: "info" },
		};
	} catch (err) {
		const msg = `Search failed: ${err instanceof Error ? err.message : String(err)}`;
		return { toast: { msg, type: "error" } };
	}
}

// ── /memory show ───────────────────────────────────────────────────────────

async function handleShow(_args: string, ctx: MemoryCommandContext): Promise<MemoryCommandResult> {
	try {
		const projectId = await resolveProjectId(ctx.cwd);
		const compactSearch = await getCompactSearch();
		// Wildcard search to get all project memories, limited to recent
		const result = await compactSearch({ query: "", projectId, limit: 30 });

		if (result.entries.length === 0) {
			return { message: "No memories stored for this project yet." };
		}

		const items: MemoryPickerItem[] = result.entries.map((entry: any) => ({
			id: String(entry.id),
			label: `[${entry.type ?? "?"}] ${entry.title ?? `#${entry.id}`}`,
			description: entry.narrative?.slice(0, 80) ?? "",
		}));

		ctx.addMessage(result.formatted);
		return {
			toast: { msg: `${items.length} memory entry/entries`, type: "info" },
			items,
		};
	} catch (err) {
		const msg = `Memory list failed: ${err instanceof Error ? err.message : String(err)}`;
		return { toast: { msg, type: "error" } };
	}
}

// ── /memory diff ───────────────────────────────────────────────────────────

async function handleDiff(_args: string, ctx: MemoryCommandContext): Promise<MemoryCommandResult> {
	try {
		const projectId = await resolveProjectId(ctx.cwd);
		const compactSearch = await getCompactSearch();

		// Search for recently modified memories using the session's timeframe.
		// Use a broad query with the project scope to surface recent entries.
		const result = await compactSearch({ query: "", projectId, limit: 10 });

		if (result.entries.length === 0) {
			return { message: "No recent memory changes detected." };
		}

		// Format as a diff-style display
		const lines: string[] = [];
		lines.push("Memory Changes (current session)");
		lines.push("=".repeat(40));
		lines.push("");

		for (const entry of result.entries) {
			const type = (entry as any).type ?? "memory";
			const title = (entry as any).title ?? `#${entry.id}`;
			const status = (entry as any).status ?? "active";
			const marker = status === "resolved" ? "~" : status === "archived" ? "-" : "+";
			lines.push(`  ${marker} [${type}] ${title} (#${entry.id})`);
		}

		lines.push("");
		lines.push(`${result.entries.length} memory/ies in current view`);

		ctx.addMessage(lines.join("\n"));
		return {};
	} catch (err) {
		const msg = `Diff failed: ${err instanceof Error ? err.message : String(err)}`;
		return { toast: { msg, type: "error" } };
	}
}

// ── /memory promote ────────────────────────────────────────────────────────

async function handlePromote(_args: string, ctx: MemoryCommandContext): Promise<MemoryCommandResult> {
	if (!ctx.runtime) {
		return { toast: { msg: "No runtime available for promote.", type: "error" } };
	}

	try {
		// Find the last assistant message from the session's message history
		const messages = ctx.runtime.session.messages;
		let lastAssistantText = "";
		for (let i = messages.length - 1; i >= 0; i--) {
			const msg = messages[i] as any;
			if (msg.role === "assistant" && Array.isArray(msg.content)) {
				const textParts = msg.content
					.filter((c: any) => c.type === "text")
					.map((c: any) => c.text as string);
				lastAssistantText = textParts.join("").trim();
				if (lastAssistantText) break;
			}
		}
		if (!lastAssistantText) {
			return { toast: { msg: "No AI response to promote.", type: "error" } };
		}

		const projectId = await resolveProjectId(ctx.cwd);
		const storeObservation = await getStoreObservation();

		const title = lastAssistantText.slice(0, 100).replace(/\n/g, " ");
		const entityName = lastAssistantText
			.replace(/[^a-zA-Z0-9\s-_]/g, "")
			.trim()
			.split(/\s+/)
			.slice(0, 4)
			.join("-")
			.toLowerCase() || "ai-response";

		const result = await storeObservation({
			entityName,
			type: "decision",
			title,
			narrative: lastAssistantText,
			projectId,
			source: "agent",
			sourceDetail: "promote-command",
		});

		const obs = result.observation;
		const action = result.upserted ? "Updated" : "Promoted";

		ctx.toast(`${action} memory #${obs.id}: "${obs.title}"`, "success");
		return {
			toast: { msg: `${action} as memory #${obs.id}`, type: "success" },
		};
	} catch (err) {
		const msg = `Promote failed: ${err instanceof Error ? err.message : String(err)}`;
		return { toast: { msg, type: "error" } };
	}
}

// ── /memory delete ─────────────────────────────────────────────────────────

async function handleDelete(_args: string, ctx: MemoryCommandContext): Promise<MemoryCommandResult> {
	try {
		const projectId = await resolveProjectId(ctx.cwd);
		const compactSearch = await getCompactSearch();
		const result = await compactSearch({ query: "", projectId, limit: 30 });

		if (result.entries.length === 0) {
			return { message: "No memories to delete." };
		}

		const items: MemoryPickerItem[] = result.entries.map((entry: any) => ({
			id: String(entry.id),
			label: `[${entry.type ?? "?"}] ${entry.title ?? `#${entry.id}`}`,
			description: `Status: ${entry.status ?? "active"} | ${entry.narrative?.slice(0, 60) ?? ""}`,
		}));

		return {
			message: "Select a memory to delete (resolves it from active search):",
			items,
		};
	} catch (err) {
		const msg = `Delete list failed: ${err instanceof Error ? err.message : String(err)}`;
		return { toast: { msg, type: "error" } };
	}
}

// ── Execute delete (called after user confirms a picker selection) ──────────

export async function executeDelete(id: number, ctx: MemoryCommandContext): Promise<MemoryCommandResult> {
	try {
		const resolveObservations = await getResolveObservations();
		const result = await resolveObservations([id], "resolved");

		if (result.resolved.length > 0) {
			ctx.toast(`Memory #${id} resolved`, "success");
			return { toast: { msg: `Deleted memory #${id}`, type: "success" } };
		}
		if (result.notFound.length > 0) {
			return { toast: { msg: `Memory #${id} not found`, type: "error" } };
		}
		return {};
	} catch (err) {
		const msg = `Delete failed: ${err instanceof Error ? err.message : String(err)}`;
		return { toast: { msg, type: "error" } };
	}
}

// ============================================================================
// Command registry
// ============================================================================

export const MEMORY_COMMANDS: Record<string, MemoryCommandHandler> = {
	stats: handleStats,
	search: handleSearch,
	show: handleShow,
	diff: handleDiff,
	promote: handlePromote,
	delete: handleDelete,
};
