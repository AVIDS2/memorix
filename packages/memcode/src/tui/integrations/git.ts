/**
 * Git integration for the memcode TUI.
 *
 * Provides:
 *   - getGitInfo(cwd)    — branch, dirty flag, ahead/behind counts
 *   - getGitDiff(cwd)    — staged + unstaged diff summary
 *   - hasDirtyFiles(cwd) — quick boolean check
 *   - getGitDiffContext   — compact diff context for LLM auto-injection
 *   - GIT_COMMANDS       — /git slash-command handlers
 *
 * Uses simple-git (already installed as a dependency).
 */

import { simpleGit, type SimpleGit, type StatusResult } from "simple-git";

// ============================================================================
// Types
// ============================================================================

/** Core git state for the header display and context injection. */
export interface GitInfo {
	branch: string;
	dirty: boolean;
	dirtyCount: number;
	ahead: number;
	behind: number;
}

/** Structured diff summary for /git diff display. */
export interface GitDiffSummary {
	staged: DiffEntry[];
	unstaged: DiffEntry[];
	totalInsertions: number;
	totalDeletions: number;
}

/** A single file diff entry. */
export interface DiffEntry {
	file: string;
	insertions: number;
	deletions: number;
	status: string;
}

/** Handler map for /git subcommands. */
export interface GitCommandHandlers {
	"git status": () => Promise<string>;
	"git diff": (file?: string) => Promise<string>;
	"git commit": (message?: string) => Promise<string>;
}

/** Slash command definition (matches the Command interface from slash-commands.tsx). */
interface GitSlashCommand {
	name: string;
	description: string;
	mode: "no-arg" | "selector" | "text-input";
}

// ============================================================================
// Helpers
// ============================================================================

/** Create a simple-git instance scoped to cwd, with error boundary. */
function git(cwd: string): SimpleGit {
	return simpleGit(cwd);
}

/** Translate StatusResult file groups into a DiffEntry-style count. */
function countDirtyFiles(status: StatusResult): number {
	return (
		status.modified.length +
		status.not_added.length +
		status.deleted.length +
		status.renamed.length +
		status.conflicted.length +
		status.staged.length
	);
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Fetch branch name, dirty state, and ahead/behind tracking info.
 *
 * Returns a safe default ({ branch: "n/a", dirty: false }) when cwd is not
 * inside a git repository.
 */
export async function getGitInfo(cwd: string): Promise<GitInfo> {
	try {
		const g = git(cwd);
		const branch = (await g.revparse(["--abbrev-ref", "HEAD"])).trim();
		const status = await g.status();

		let ahead = 0;
		let behind = 0;
		if (status.tracking) {
			ahead = status.ahead;
			behind = status.behind;
		}

		const dirtyCount = countDirtyFiles(status);
		return { branch, dirty: dirtyCount > 0, dirtyCount, ahead, behind };
	} catch {
		return { branch: "n/a", dirty: false, dirtyCount: 0, ahead: 0, behind: 0 };
	}
}

/**
 * Get a structured diff summary of staged and unstaged changes.
 *
 * Returns { staged, unstaged, totalInsertions, totalDeletions }.
 * Each entry includes file path, +/- counts, and a short status code.
 */
export async function getGitDiff(cwd: string): Promise<GitDiffSummary> {
	try {
		const g = git(cwd);
		const diffSummary = await g.diffSummary();
		const status = await g.status();

		const stagedSet = new Set(status.staged);
		const staged: DiffEntry[] = [];
		const unstaged: DiffEntry[] = [];

		for (const file of diffSummary.files) {
			const entry: DiffEntry = {
				file: file.file,
				insertions: "insertions" in file ? (file as any).insertions : 0,
				deletions: "deletions" in file ? (file as any).deletions : 0,
				status: fileTypeLabel(file),
			};
			if (stagedSet.has(file.file)) {
				staged.push(entry);
			} else {
				unstaged.push(entry);
			}
		}

		return {
			staged,
			unstaged,
			totalInsertions: diffSummary.insertions,
			totalDeletions: diffSummary.deletions,
		};
	} catch {
		return { staged: [], unstaged: [], totalInsertions: 0, totalDeletions: 0 };
	}
}

/**
 * Quick boolean check for dirty working tree.
 * Returns false when cwd is not a git repo.
 */
export async function hasDirtyFiles(cwd: string): Promise<boolean> {
	try {
		const status = await git(cwd).status();
		return countDirtyFiles(status) > 0;
	} catch {
		return false;
	}
}

/**
 * Build a compact git-diff context string for LLM auto-injection.
 *
 * When the working tree is dirty, returns a short block listing changed files
 * and a truncated unified diff (max ~2000 chars) to attach to the user prompt.
 * Returns "" when clean.
 */
export async function getGitDiffContext(cwd: string): Promise<string> {
	try {
		const g = git(cwd);
		const status = await g.status();
		const dirtyCount = countDirtyFiles(status);
		if (dirtyCount === 0) return "";

		const branch = (await g.revparse(["--abbrev-ref", "HEAD"])).trim();

		// Collect changed file names
		const changedFiles = [
			...status.modified,
			...status.not_added,
			...status.deleted,
			...status.staged,
			...status.renamed.map((r) => r.to),
		];
		const uniqueFiles = [...new Set(changedFiles)];

		// Get truncated diff (limit to avoid context bloat)
		let diffText = "";
		try {
			const fullDiff = await g.diff();
			diffText = fullDiff.length > 2000
				? fullDiff.slice(0, 2000) + "\n... (truncated)"
				: fullDiff;
		} catch {
			// diff may fail in edge cases; proceed with file list only
		}

		const lines = [
			`<git-context branch="${branch}" dirty-files="${dirtyCount}">`,
			"Changed files:",
			...uniqueFiles.map((f) => `  ${f}`),
		];
		if (diffText) {
			lines.push("", "Diff (truncated):", "```diff", diffText, "```");
		}
		lines.push("</git-context>");
		return lines.join("\n");
	} catch {
		return "";
	}
}

// ============================================================================
// /git command handlers
// ============================================================================

/**
 * Create handlers for /git slash commands.
 *
 * @param cwd - working directory for git operations (should match runtime.cwd)
 * @param addMessage - callback to inject a system/assistant message into the TUI
 * @param sendMessage - callback to send a user message to the LLM (for /git commit)
 */
export function createGitCommandHandlers(
	cwd: string,
	addMessage: (role: "assistant", content: string) => void,
	sendMessage: (text: string) => Promise<void>,
): GitCommandHandlers {
	return {
		async "git status"(): Promise<string> {
			try {
				const g = git(cwd);
				const status = await g.status();
				const branch = status.current ?? "detached";

				const lines: string[] = [];
				lines.push(`**Git Status** (\`${branch}\`)`);
				lines.push("");

				if (status.ahead > 0 || status.behind > 0) {
					const tracking = [];
					if (status.ahead > 0) tracking.push(`${status.ahead} ahead`);
					if (status.behind > 0) tracking.push(`${status.behind} behind`);
					lines.push(`Tracking: ${tracking.join(", ")}`);
					lines.push("");
				}

				if (status.staged.length > 0) {
					lines.push(`**Staged (${status.staged.length}):**`);
					for (const f of status.staged) lines.push(`  A ${f}`);
					lines.push("");
				}
				if (status.modified.length > 0) {
					lines.push(`**Modified (${status.modified.length}):**`);
					for (const f of status.modified) lines.push(`  M ${f}`);
					lines.push("");
				}
				if (status.not_added.length > 0) {
					lines.push(`**Untracked (${status.not_added.length}):**`);
					for (const f of status.not_added) lines.push(`  ? ${f}`);
					lines.push("");
				}
				if (status.deleted.length > 0) {
					lines.push(`**Deleted (${status.deleted.length}):**`);
					for (const f of status.deleted) lines.push(`  D ${f}`);
					lines.push("");
				}
				if (status.conflicted.length > 0) {
					lines.push(`**Conflicted (${status.conflicted.length}):**`);
					for (const f of status.conflicted) lines.push(`  ! ${f}`);
					lines.push("");
				}

				const total = countDirtyFiles(status);
				if (total === 0) {
					lines.push("Working tree is clean.");
				}

				return lines.join("\n");
			} catch (err) {
				return `Error reading git status: ${err instanceof Error ? err.message : String(err)}`;
			}
		},

		async "git diff"(file?: string): Promise<string> {
			try {
				const g = git(cwd);
				const diffArgs = file ? [file] : [];
				const diff = await g.diff(diffArgs);

				if (!diff.trim()) {
					// Check staged diff if unstaged is empty
					const stagedDiff = await g.diff(["--cached", ...diffArgs]);
					if (!stagedDiff.trim()) {
						return "No changes to display.";
					}
					const truncated = stagedDiff.length > 4000
						? stagedDiff.slice(0, 4000) + "\n... (truncated)"
						: stagedDiff;
					return `**Staged Diff:**\n\`\`\`diff\n${truncated}\n\`\`\``;
				}

				const truncated = diff.length > 4000
					? diff.slice(0, 4000) + "\n... (truncated)"
					: diff;
				return `**Diff:**\n\`\`\`diff\n${truncated}\n\`\`\``;
			} catch (err) {
				return `Error reading git diff: ${err instanceof Error ? err.message : String(err)}`;
			}
		},

		async "git commit"(message?: string): Promise<string> {
			try {
				const g = git(cwd);
				const status = await g.status();

				if (countDirtyFiles(status) === 0) {
					return "Nothing to commit — working tree is clean.";
				}

				// Stage all changes
				await g.add("-A");

				if (message) {
					// Direct commit with provided message
					const result = await g.commit(message);
					return `Committed ${result.summary.changes} file(s): "${message}"\n(${result.commit})`;
				}

				// No message provided — generate one via LLM
				const diff = await g.diff(["--cached"]);
				const diffPreview = diff.length > 3000
					? diff.slice(0, 3000) + "\n... (truncated)"
					: diff;

				const prompt = [
					"Generate a conventional commit message for these staged changes.",
					"Use the format: type(scope): description",
					"Keep the first line under 72 characters. Add a blank line and 1-2 sentence body if needed.",
					"",
					"Staged diff:",
					"```diff",
					diffPreview,
					"```",
				].join("\n");

				// Send the commit-message generation request to the LLM
				await sendMessage(prompt);
				return "Generating commit message...";
			} catch (err) {
				return `Error during commit: ${err instanceof Error ? err.message : String(err)}`;
			}
		},
	};
}

// ============================================================================
// GIT_COMMANDS — slash command definitions
// ============================================================================

/**
 * Git-specific slash commands for the TUI command registry.
 *
 * Merge into the main COMMANDS array or use directly with
 * createGitCommandHandlers() for dispatch.
 */
export const GIT_COMMANDS: readonly GitSlashCommand[] = [
	{ name: "/git status", description: "Show git working-tree status",   mode: "no-arg" },
	{ name: "/git diff",   description: "Show staged + unstaged diff",   mode: "text-input" },
	{ name: "/git commit", description: "Stage all + generate commit msg", mode: "text-input" },
];

// ============================================================================
// Internal helpers
// ============================================================================

/** Map simple-git's diff file entry to a short status label. */
function fileTypeLabel(file: { binary: boolean }): string {
	if (file.binary) return "binary";
	return "text";
}
