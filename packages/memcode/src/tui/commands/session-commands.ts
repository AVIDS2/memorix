/**
 * /session command handlers for the memcode TUI.
 *
 * Implements ten session subcommands:
 *   /session           — show current session info (ID, messages, tokens, file path)
 *   /session new       — create a new session
 *   /session load      — show session picker, load selected
 *   /session delete    — show picker, confirm delete
 *   /session export    — export to markdown file
 *   /resume            — alias for /session load
 *   /tree              — show session tree, navigate branches
 *   /fork              — fork from current node to new session
 *   /clone             — clone current branch to new session
 *   /label <name>      — bookmark current position
 *
 * Each handler uses the SessionManager API and AgentSessionRuntime
 * to read or mutate session state, returning structured results
 * (toasts, messages, picker items) for the TUI to render.
 * No React imports — this is a pure-logic module.
 */

import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { AgentSessionRuntime } from "../../core/agent-session-runtime.ts";
import {
	SessionManager,
	type SessionEntry,
	type SessionInfo,
	type SessionTreeNode,
} from "../../core/session-manager.ts";

// ============================================================================
// Types
// ============================================================================

/** Context passed to every session command handler. */
export interface SessionCommandContext {
	/** Current working directory. */
	cwd: string;
	/** Agent runtime for accessing the session manager and session lifecycle. */
	runtime: AgentSessionRuntime;
	/** Show a transient toast notification. */
	toast: (msg: string, type?: "info" | "success" | "error") => void;
	/** Append a system/informational message to the message list. */
	addMessage: (msg: string) => void;
}

/** A picker item returned by selector-mode commands. */
export interface SessionPickerItem {
	id: string;
	label: string;
	description: string;
}

/** The result of a session command handler. */
export interface SessionCommandResult {
	/** Toast notification to display. */
	toast?: { msg: string; type: "info" | "success" | "error" };
	/** Lines to append as a system message in the message list. */
	message?: string;
	/** Picker items for selector-mode commands. */
	items?: SessionPickerItem[];
}

/** A single session command handler function. */
export type SessionCommandHandler = (
	args: string,
	ctx: SessionCommandContext,
) => Promise<SessionCommandResult>;

// ============================================================================
// Helpers
// ============================================================================

/** Get the active SessionManager from the runtime. */
function getSM(ctx: SessionCommandContext) {
	return ctx.runtime.session.sessionManager;
}

/** Estimate token count from message entries (~4 chars per token). */
function estimateTokensFromEntries(entries: SessionEntry[]): number {
	let totalChars = 0;
	for (const entry of entries) {
		if (entry.type === "message") {
			const msg = entry.message as any;
			if (typeof msg.content === "string") {
				totalChars += msg.content.length;
			} else if (Array.isArray(msg.content)) {
				for (const block of msg.content) {
					if (block.type === "text" && typeof block.text === "string") {
						totalChars += block.text.length;
					}
				}
			}
		} else if (entry.type === "compaction") {
			totalChars += entry.summary?.length ?? 0;
		} else if (entry.type === "branch_summary") {
			totalChars += entry.summary?.length ?? 0;
		} else if (entry.type === "custom_message") {
			if (typeof entry.content === "string") {
				totalChars += entry.content.length;
			}
		}
	}
	return Math.ceil(totalChars / 4);
}

/** Count messages by role in the current branch. */
function countMessagesByRole(entries: SessionEntry[]): Record<string, number> {
	const counts: Record<string, number> = {};
	for (const entry of entries) {
		if (entry.type === "message") {
			const role = (entry.message as any).role ?? "unknown";
			counts[role] = (counts[role] || 0) + 1;
		}
	}
	return counts;
}

/** Format a relative time string. */
function formatRelativeTime(date: Date): string {
	const now = Date.now();
	const diff = now - date.getTime();
	const seconds = Math.floor(diff / 1000);
	if (seconds < 60) return "just now";
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.floor(hours / 24);
	if (days < 30) return `${days}d ago`;
	return date.toLocaleDateString();
}

/** Render a tree node as indented text lines. */
function renderTree(
	node: SessionTreeNode,
	depth: number,
	leafId: string | null,
	lines: string[],
): void {
	const indent = "  ".repeat(depth);
	const isLeaf = node.entry.id === leafId;
	const marker = isLeaf ? " <-- current" : "";
	const label = node.label ? ` [${node.label}]` : "";

	// Shorten entry id for display
	const shortId = node.entry.id.slice(0, 6);

	if (node.entry.type === "message") {
		const role = (node.entry.message as any).role ?? "?";
		let preview = "";
		const content = (node.entry.message as any).content;
		if (typeof content === "string") {
			preview = content.slice(0, 40).replace(/\n/g, " ");
		} else if (Array.isArray(content)) {
			const textBlock = content.find((b: any) => b.type === "text");
			if (textBlock?.text) {
				preview = textBlock.text.slice(0, 40).replace(/\n/g, " ");
			}
		}
		if (preview.length === 40) preview += "...";
		lines.push(`${indent}[${shortId}] ${role}: ${preview}${label}${marker}`);
	} else if (node.entry.type === "compaction") {
		lines.push(`${indent}[${shortId}] --- compacted ---${marker}`);
	} else if (node.entry.type === "branch_summary") {
		const summaryPreview = (node.entry.summary ?? "").slice(0, 40).replace(/\n/g, " ");
		lines.push(`${indent}[${shortId}] branch: ${summaryPreview}${label}${marker}`);
	} else if (node.entry.type === "label") {
		lines.push(`${indent}[${shortId}] label: "${node.entry.label ?? "(cleared)"}"${marker}`);
	} else if (node.entry.type === "thinking_level_change") {
		lines.push(`${indent}[${shortId}] thinking: ${node.entry.thinkingLevel}${marker}`);
	} else if (node.entry.type === "model_change") {
		lines.push(`${indent}[${shortId}] model: ${node.entry.provider}/${node.entry.modelId}${marker}`);
	} else if (node.entry.type === "session_info") {
		lines.push(`${indent}[${shortId}] name: "${node.entry.name ?? ""}"${marker}`);
	} else {
		lines.push(`${indent}[${shortId}] ${node.entry.type}${marker}`);
	}

	for (const child of node.children) {
		renderTree(child, depth + 1, leafId, lines);
	}
}

/** Collect all tree nodes as flat picker items for fork/clone/tree navigation. */
function collectTreeItems(
	nodes: SessionTreeNode[],
	leafId: string | null,
	items: SessionPickerItem[],
	depth: number,
): void {
	for (const node of nodes) {
		const shortId = node.entry.id.slice(0, 6);
		const isLeaf = node.entry.id === leafId;
		const labelTag = node.label ? ` [${node.label}]` : "";
		const currentTag = isLeaf ? " (current)" : "";
		const indent = "  ".repeat(depth);

		let label: string;
		let description: string;

		if (node.entry.type === "message") {
			const role = (node.entry.message as any).role ?? "?";
			let preview = "";
			const content = (node.entry.message as any).content;
			if (typeof content === "string") {
				preview = content.slice(0, 60).replace(/\n/g, " ");
			} else if (Array.isArray(content)) {
				const textBlock = content.find((b: any) => b.type === "text");
				if (textBlock?.text) {
					preview = textBlock.text.slice(0, 60).replace(/\n/g, " ");
				}
			}
			label = `${indent}[${shortId}] ${role}: ${preview}`;
			description = `${node.entry.type}${labelTag}${currentTag}`;
		} else {
			label = `${indent}[${shortId}] ${node.entry.type}`;
			description = `${new Date(node.entry.timestamp).toLocaleString()}${labelTag}${currentTag}`;
		}

		items.push({
			id: node.entry.id,
			label,
			description,
		});

		if (node.children.length > 0) {
			collectTreeItems(node.children, leafId, items, depth + 1);
		}
	}
}

// ============================================================================
// Handlers
// ============================================================================

// -- /session (show current info) --------------------------------------------

async function handleInfo(_args: string, ctx: SessionCommandContext): Promise<SessionCommandResult> {
	try {
		const sm = getSM(ctx);
		const header = sm.getHeader();
		const entries = sm.getEntries();
		const branch = sm.getBranch();
		const sessionId = sm.getSessionId();
		const sessionFile = sm.getSessionFile();
		const sessionName = sm.getSessionName();
		const leafId = sm.getLeafId();
		const tokenEst = estimateTokensFromEntries(entries);
		const roleCounts = countMessagesByRole(branch);

		const lines: string[] = [];
		lines.push("Session Info");
		lines.push("=".repeat(40));

		if (sessionName) {
			lines.push(`  Name:        ${sessionName}`);
		}
		lines.push(`  ID:          ${sessionId}`);

		if (sessionFile) {
			lines.push(`  File:        ${basename(sessionFile)}`);
			lines.push(`  Path:        ${sessionFile}`);
		}

		if (header) {
			const created = new Date(header.timestamp);
			lines.push(`  Created:     ${formatRelativeTime(created)} (${created.toLocaleString()})`);
			if (header.parentSession) {
				lines.push(`  Parent:      ${basename(header.parentSession)}`);
			}
		}

		lines.push(`  Entries:     ${entries.length} total, ${branch.length} on current branch`);
		lines.push(`  Tokens:      ~${tokenEst} (estimated)`);

		if (Object.keys(roleCounts).length > 0) {
			const roleStr = Object.entries(roleCounts)
				.map(([role, count]) => `${role}: ${count}`)
				.join(", ");
			lines.push(`  Messages:    ${roleStr}`);
		}

		if (leafId) {
			const label = sm.getLabel(leafId);
			lines.push(`  Position:    ${leafId.slice(0, 8)}${label ? ` [${label}]` : ""}`);
		}

		lines.push(`  Persisted:   ${sm.isPersisted() ? "yes" : "no"}`);

		ctx.addMessage(lines.join("\n"));
		return {};
	} catch (err) {
		const msg = `Session info failed: ${err instanceof Error ? err.message : String(err)}`;
		return { toast: { msg, type: "error" } };
	}
}

// -- /session new ------------------------------------------------------------

async function handleNew(_args: string, ctx: SessionCommandContext): Promise<SessionCommandResult> {
	try {
		const previousId = ctx.runtime.session.sessionId;
		await ctx.runtime.newSession({
			parentSession: ctx.runtime.session.sessionFile,
		});
		const newId = ctx.runtime.session.sessionId;
		ctx.toast(`New session created: ${newId.slice(0, 8)}`, "success");
		return {
			toast: { msg: `New session (${newId.slice(0, 8)}), previous: ${previousId.slice(0, 8)}`, type: "success" },
		};
	} catch (err) {
		const msg = `New session failed: ${err instanceof Error ? err.message : String(err)}`;
		return { toast: { msg, type: "error" } };
	}
}

// -- /session load (/resume) -------------------------------------------------

async function handleLoad(_args: string, ctx: SessionCommandContext): Promise<SessionCommandResult> {
	try {
		const sessions = await SessionManager.list(ctx.cwd, getSM(ctx).getSessionDir());

		if (sessions.length === 0) {
			return { message: "No saved sessions found." };
		}

		const currentFile = ctx.runtime.session.sessionFile;
		const items: SessionPickerItem[] = sessions.map((s: SessionInfo) => {
			const isCurrent = s.path === currentFile;
			const nameTag = s.name ? ` "${s.name}"` : "";
			const timeStr = formatRelativeTime(s.modified);
			return {
				id: s.path,
				label: `${s.id.slice(0, 8)}${nameTag} (${s.messageCount} msgs, ${timeStr})`,
				description: `${isCurrent ? "(active) " : ""}${s.firstMessage.slice(0, 60)}`,
			};
		});

		return {
			message: `Select a session to load (${sessions.length} found):`,
			items,
		};
	} catch (err) {
		const msg = `Session list failed: ${err instanceof Error ? err.message : String(err)}`;
		return { toast: { msg, type: "error" } };
	}
}

/** Execute session load after user picks from the picker. */
export async function executeLoad(sessionPath: string, ctx: SessionCommandContext): Promise<SessionCommandResult> {
	try {
		if (!existsSync(sessionPath)) {
			return { toast: { msg: `Session file not found: ${sessionPath}`, type: "error" } };
		}

		const currentFile = ctx.runtime.session.sessionFile;
		if (sessionPath === currentFile) {
			return { toast: { msg: "Already on this session", type: "info" } };
		}

		await ctx.runtime.switchSession(sessionPath);
		const newId = ctx.runtime.session.sessionId;
		ctx.toast(`Loaded session: ${newId.slice(0, 8)}`, "success");
		return {
			toast: { msg: `Switched to session ${newId.slice(0, 8)}`, type: "success" },
		};
	} catch (err) {
		const msg = `Load session failed: ${err instanceof Error ? err.message : String(err)}`;
		return { toast: { msg, type: "error" } };
	}
}

// -- /session delete ---------------------------------------------------------

async function handleDelete(_args: string, ctx: SessionCommandContext): Promise<SessionCommandResult> {
	try {
		const sessions = await SessionManager.list(ctx.cwd, getSM(ctx).getSessionDir());

		if (sessions.length === 0) {
			return { message: "No saved sessions to delete." };
		}

		const currentFile = ctx.runtime.session.sessionFile;
		const items: SessionPickerItem[] = sessions.map((s: SessionInfo) => {
			const isCurrent = s.path === currentFile;
			const nameTag = s.name ? ` "${s.name}"` : "";
			return {
				id: s.path,
				label: `${s.id.slice(0, 8)}${nameTag} (${s.messageCount} msgs)`,
				description: `${isCurrent ? "(active) " : ""}${s.firstMessage.slice(0, 60)}`,
			};
		});

		return {
			message: "Select a session to delete:",
			items,
		};
	} catch (err) {
		const msg = `Session delete list failed: ${err instanceof Error ? err.message : String(err)}`;
		return { toast: { msg, type: "error" } };
	}
}

/** Execute session delete after user picks from the picker. */
export async function executeDelete(sessionPath: string, ctx: SessionCommandContext): Promise<SessionCommandResult> {
	try {
		if (!existsSync(sessionPath)) {
			return { toast: { msg: `Session file not found: ${sessionPath}`, type: "error" } };
		}

		const currentFile = ctx.runtime.session.sessionFile;
		if (sessionPath === currentFile) {
			return { toast: { msg: "Cannot delete the active session. Switch first.", type: "error" } };
		}

		unlinkSync(sessionPath);
		const name = basename(sessionPath);
		ctx.toast(`Deleted session: ${name}`, "success");
		return {
			toast: { msg: `Deleted ${name}`, type: "success" },
		};
	} catch (err) {
		const msg = `Delete session failed: ${err instanceof Error ? err.message : String(err)}`;
		return { toast: { msg, type: "error" } };
	}
}

// -- /session export ---------------------------------------------------------

async function handleExport(_args: string, ctx: SessionCommandContext): Promise<SessionCommandResult> {
	try {
		const sm = getSM(ctx);
		const branch = sm.getBranch();
		const sessionId = sm.getSessionId();
		const sessionName = sm.getSessionName();
		const header = sm.getHeader();

		const lines: string[] = [];
		lines.push(`# Session: ${sessionName ?? sessionId}`);
		lines.push("");
		if (header) {
			lines.push(`- **ID**: ${sessionId}`);
			lines.push(`- **Created**: ${new Date(header.timestamp).toLocaleString()}`);
			if (header.parentSession) {
				lines.push(`- **Parent**: ${basename(header.parentSession)}`);
			}
		}
		lines.push(`- **Exported**: ${new Date().toLocaleString()}`);
		lines.push("");
		lines.push("---");
		lines.push("");

		for (const entry of branch) {
			if (entry.type === "message") {
				const role = (entry.message as any).role ?? "unknown";
				let text = "";
				const content = (entry.message as any).content;
				if (typeof content === "string") {
					text = content;
				} else if (Array.isArray(content)) {
					text = content
						.filter((b: any) => b.type === "text")
						.map((b: any) => b.text)
						.join("\n");
				}
				if (role === "user") {
					lines.push(`## User`);
				} else if (role === "assistant") {
					lines.push(`## Assistant`);
				} else if (role === "toolResult") {
					lines.push(`### Tool Result`);
				} else {
					lines.push(`### ${role}`);
				}
				lines.push("");
				lines.push(text || "*(no text content)*");
				lines.push("");
			} else if (entry.type === "compaction") {
				lines.push("---");
				lines.push(`*Context compacted: ${entry.summary.slice(0, 200)}*`);
				lines.push("---");
				lines.push("");
			} else if (entry.type === "branch_summary") {
				lines.push(`> **Branch summary**: ${entry.summary}`);
				lines.push("");
			}
		}

		// Write to temp file in the session directory
		const sessionDir = sm.getSessionDir();
		const safeName = (sessionName ?? sessionId).replace(/[^a-zA-Z0-9_-]/g, "_");
		const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
		const exportDir = join(sessionDir, "exports");
		if (!existsSync(exportDir)) {
			mkdirSync(exportDir, { recursive: true });
		}
		const exportPath = join(exportDir, `${safeName}_${timestamp}.md`);
		writeFileSync(exportPath, lines.join("\n"), "utf-8");

		ctx.toast(`Exported to ${basename(exportPath)}`, "success");
		return {
			toast: { msg: `Exported to ${exportPath}`, type: "success" },
		};
	} catch (err) {
		const msg = `Export failed: ${err instanceof Error ? err.message : String(err)}`;
		return { toast: { msg, type: "error" } };
	}
}

// -- /tree -------------------------------------------------------------------

async function handleTree(_args: string, ctx: SessionCommandContext): Promise<SessionCommandResult> {
	try {
		const sm = getSM(ctx);
		const tree = sm.getTree();
		const leafId = sm.getLeafId();

		if (tree.length === 0) {
			return { message: "Session tree is empty (no entries)." };
		}

		// Render tree as text for addMessage
		const lines: string[] = [];
		lines.push("Session Tree");
		lines.push("=".repeat(40));
		for (const root of tree) {
			renderTree(root, 0, leafId, lines);
		}

		ctx.addMessage(lines.join("\n"));

		// Also return picker items for navigation
		const items: SessionPickerItem[] = [];
		collectTreeItems(tree, leafId, items, 0);

		return {
			items,
			toast: { msg: `${items.length} node(s) in tree`, type: "info" },
		};
	} catch (err) {
		const msg = `Tree display failed: ${err instanceof Error ? err.message : String(err)}`;
		return { toast: { msg, type: "error" } };
	}
}

/** Execute tree navigation after user selects a node from the picker. */
export async function executeTreeNavigate(entryId: string, ctx: SessionCommandContext): Promise<SessionCommandResult> {
	try {
		const sm = getSM(ctx);
		const entry = sm.getEntry(entryId);
		if (!entry) {
			return { toast: { msg: `Entry ${entryId.slice(0, 6)} not found`, type: "error" } };
		}

		sm.branch(entryId);
		const label = sm.getLabel(entryId);
		const labelTag = label ? ` [${label}]` : "";
		ctx.toast(`Navigated to ${entryId.slice(0, 6)}${labelTag}`, "success");
		return {
			toast: { msg: `Branched to ${entry.type} entry ${entryId.slice(0, 6)}${labelTag}`, type: "success" },
		};
	} catch (err) {
		const msg = `Tree navigation failed: ${err instanceof Error ? err.message : String(err)}`;
		return { toast: { msg, type: "error" } };
	}
}

// -- /fork -------------------------------------------------------------------

async function handleFork(_args: string, ctx: SessionCommandContext): Promise<SessionCommandResult> {
	try {
		const sm = getSM(ctx);
		const tree = sm.getTree();
		const leafId = sm.getLeafId();

		if (tree.length === 0) {
			return { message: "Session tree is empty — nothing to fork from." };
		}

		// Show tree picker — user selects a fork point
		const items: SessionPickerItem[] = [];
		collectTreeItems(tree, leafId, items, 0);

		return {
			message: "Select a node to fork from (creates a new branch in the current session):",
			items,
		};
	} catch (err) {
		const msg = `Fork failed: ${err instanceof Error ? err.message : String(err)}`;
		return { toast: { msg, type: "error" } };
	}
}

/** Execute fork after user selects a fork point from the picker. */
export async function executeFork(entryId: string, ctx: SessionCommandContext): Promise<SessionCommandResult> {
	try {
		await ctx.runtime.fork(entryId, { position: "at" });
		const newId = ctx.runtime.session.sessionId;
		ctx.toast(`Forked session: ${newId.slice(0, 8)}`, "success");
		return {
			toast: { msg: `Forked at ${entryId.slice(0, 6)} -> new session ${newId.slice(0, 8)}`, type: "success" },
		};
	} catch (err) {
		const msg = `Fork failed: ${err instanceof Error ? err.message : String(err)}`;
		return { toast: { msg, type: "error" } };
	}
}

// -- /clone ------------------------------------------------------------------

async function handleClone(_args: string, ctx: SessionCommandContext): Promise<SessionCommandResult> {
	try {
		const sm = getSM(ctx);
		const leafId = sm.getLeafId();

		if (!leafId) {
			return { message: "Session has no entries — nothing to clone." };
		}

		const sessionFile = sm.getSessionFile();
		if (!sessionFile) {
			return { toast: { msg: "Session is not persisted — cannot clone.", type: "error" } };
		}

		// Open a fresh SessionManager on the same file, then create a branched
		// session from the current leaf. This produces a standalone copy.
		const cloned = SessionManager.open(sessionFile, sm.getSessionDir());
		const newPath = cloned.createBranchedSession(leafId);
		if (!newPath) {
			return { toast: { msg: "Failed to create cloned session.", type: "error" } };
		}

		const newId = cloned.getSessionId();
		ctx.toast(`Cloned to ${newId.slice(0, 8)}`, "success");
		return {
			toast: { msg: `Cloned branch to new session ${basename(newPath)}`, type: "success" },
		};
	} catch (err) {
		const msg = `Clone failed: ${err instanceof Error ? err.message : String(err)}`;
		return { toast: { msg, type: "error" } };
	}
}

// -- /label <name> -----------------------------------------------------------

async function handleLabel(args: string, ctx: SessionCommandContext): Promise<SessionCommandResult> {
	const label = args.trim();
	if (!label) {
		return { toast: { msg: "Usage: /label <name>", type: "error" } };
	}

	try {
		const sm = getSM(ctx);
		const leafId = sm.getLeafId();

		if (!leafId) {
			return { toast: { msg: "No current position to label.", type: "error" } };
		}

		sm.appendLabelChange(leafId, label);
		ctx.toast(`Labeled position as "${label}"`, "success");
		return {
			toast: { msg: `Labeled ${leafId.slice(0, 6)} as "${label}"`, type: "success" },
		};
	} catch (err) {
		const msg = `Label failed: ${err instanceof Error ? err.message : String(err)}`;
		return { toast: { msg, type: "error" } };
	}
}

// ============================================================================
// Command registry
// ============================================================================

export const SESSION_COMMANDS: Record<string, SessionCommandHandler> = {
	"": handleInfo,         // /session (no subcommand)
	new: handleNew,         // /session new
	load: handleLoad,       // /session load
	delete: handleDelete,   // /session delete
	export: handleExport,   // /session export
	resume: handleLoad,     // /resume (alias for /session load)
	tree: handleTree,       // /tree
	fork: handleFork,       // /fork
	clone: handleClone,     // /clone
	label: handleLabel,     // /label <name>
};
