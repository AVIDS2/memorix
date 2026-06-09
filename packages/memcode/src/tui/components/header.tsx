/**
 * Header - single-line meta info bar.
 *
 * Shows: brand, project name, git branch + dirty count, retrieval mode,
 * memory count, session id, and optional background task indicator.
 *
 * Uses simple-git to read branch and working-tree status from cwd.
 */

import { useEffect, useState } from "react";
import { createTextAttributes } from "@opentui/core";
import { simpleGit } from "simple-git";
import { theme } from "../theme.ts";

const BOLD = createTextAttributes({ bold: true });

interface HeaderProps {
	cwd: string;
	memoryCount: number;
	sessionId: string;
	backgroundTasks?: boolean;
	retrievalMode?: string;
}

interface GitInfo {
	branch: string;
	dirtyCount: number;
}

async function fetchGitInfo(cwd: string): Promise<GitInfo> {
	try {
		const git = simpleGit(cwd);
		const branch = await git.revparse(["--abbrev-ref", "HEAD"]);
		const status = await git.status();
		const dirtyCount =
			status.modified.length +
			status.not_added.length +
			status.deleted.length +
			status.renamed.length +
			status.conflicted.length;
		return { branch: branch.trim(), dirtyCount };
	} catch {
		return { branch: "n/a", dirtyCount: 0 };
	}
}

function Header({ cwd, memoryCount, sessionId, backgroundTasks, retrievalMode }: HeaderProps) {
	const [git, setGit] = useState<GitInfo>({ branch: "...", dirtyCount: 0 });
	const projectName = cwd.replace(/\\/g, "/").split("/").pop() ?? cwd;

	useEffect(() => {
		let cancelled = false;
		fetchGitInfo(cwd).then((info) => {
			if (!cancelled) setGit(info);
		});
		return () => {
			cancelled = true;
		};
	}, [cwd]);

	const hasMemories = memoryCount > 0;

	return (
		<box height={1} paddingLeft={1} paddingRight={1}>
			<text>
				<span fg={theme.brand} attributes={BOLD}>◆ memcode</span>
				<span fg={theme.textPrimary}>{"  "}{projectName}</span>
				<span fg={theme.gitBranch}>{"  "}{git.branch}</span>
				{git.dirtyCount > 0 && (
					<span fg={theme.gitModified}>±{git.dirtyCount}</span>
				)}
				<span fg={theme.textMuted}>{"  "}{retrievalMode ?? "BM25"}</span>
				<span fg={hasMemories ? theme.success : theme.textMuted}>
					{"  "}{memoryCount}mem
				</span>
				<span fg={theme.textMuted}>{"  "}sess:{sessionId}</span>
				{backgroundTasks && (
					<span fg={theme.warning}>{"  "}[bg]</span>
				)}
			</text>
		</box>
	);
}

export { Header };
export type { HeaderProps };
