/**
 * Header - single-line meta info bar.
 *
 * Shows: brand, project name, git branch + dirty count + ahead/behind,
 * retrieval mode, memory count, session id, and optional background task
 * indicator.
 *
 * Uses the shared git integration for branch and working-tree status.
 */

import { useEffect, useState } from "react";
import { createTextAttributes } from "@opentui/core";
import { getGitInfo, type GitInfo } from "../integrations/git.ts";
import { theme } from "../theme.ts";

const BOLD = createTextAttributes({ bold: true });

interface HeaderProps {
	cwd: string;
	memoryCount: number;
	sessionId: string;
	backgroundTasks?: boolean;
	retrievalMode?: string;
}

const INIT_GIT: GitInfo = { branch: "...", dirty: false, dirtyCount: 0, ahead: 0, behind: 0 };

function Header({ cwd, memoryCount, sessionId, backgroundTasks, retrievalMode }: HeaderProps) {
	const [git, setGit] = useState<GitInfo>(INIT_GIT);
	const projectName = cwd.replace(/\\/g, "/").split("/").pop() ?? cwd;

	useEffect(() => {
		let cancelled = false;
		getGitInfo(cwd).then((info) => {
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
				{git.ahead > 0 && (
					<span fg={theme.info}>{" ↑"}{git.ahead}</span>
				)}
				{git.behind > 0 && (
					<span fg={theme.warning}>{" ↓"}{git.behind}</span>
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
