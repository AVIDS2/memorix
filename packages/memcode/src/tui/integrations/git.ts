/**
 * Minimal Git metadata for the memcode TUI header.
 *
 * InteractiveMode owns the executable command surface. Keep this module free
 * of slash-command declarations so autocomplete and dispatch cannot drift.
 */

import { simpleGit, type SimpleGit, type StatusResult } from "simple-git";

/** Core git state for the header display. */
export interface GitInfo {
	branch: string;
	dirty: boolean;
	dirtyCount: number;
	ahead: number;
	behind: number;
}

function git(cwd: string): SimpleGit {
	return simpleGit(cwd);
}

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

/**
 * Fetch branch and working-tree state for the header.
 * Returns a safe neutral value when cwd is not inside a Git repository.
 */
export async function getGitInfo(cwd: string): Promise<GitInfo> {
	try {
		const instance = git(cwd);
		const branch = (await instance.revparse(["--abbrev-ref", "HEAD"])).trim();
		const status = await instance.status();
		return {
			branch,
			dirty: countDirtyFiles(status) > 0,
			dirtyCount: countDirtyFiles(status),
			ahead: status.tracking ? status.ahead : 0,
			behind: status.tracking ? status.behind : 0,
		};
	} catch {
		return { branch: "n/a", dirty: false, dirtyCount: 0, ahead: 0, behind: 0 };
	}
}
