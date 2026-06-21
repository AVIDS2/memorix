/**
 * Header - single-line metadata bar.
 *
 * Layout: memorix · main · 1530 memories · session:a3f9k
 * All muted, no background, one line.
 */

import { useEffect, useState } from "react";
import { getGitInfo, type GitInfo } from "../integrations/git.ts";
import { theme } from "../theme.ts";

interface HeaderProps {
	cwd: string;
	memoryCount: number;
	sessionId: string;
}

const SEP = " · ";
const INIT_GIT: GitInfo = { branch: "...", dirty: false, dirtyCount: 0, ahead: 0, behind: 0 };

function Header({ cwd, memoryCount, sessionId }: HeaderProps) {
	const [git, setGit] = useState<GitInfo>(INIT_GIT);

	useEffect(() => {
		let cancelled = false;
		getGitInfo(cwd).then((info) => {
			if (!cancelled) setGit(info);
		});
		return () => {
			cancelled = true;
		};
	}, [cwd]);

	const shortId = sessionId.length > 6 ? sessionId.slice(-6) : sessionId;

	return (
		<box height={1} paddingLeft={1} paddingRight={1}>
			<text>
				<span fg={theme.textMuted}>memorix</span>
				<span fg={theme.textMuted}>{SEP}</span>
				<span fg={theme.gitBranch}>{git.branch}</span>
				{memoryCount > 0 && (
					<>
						<span fg={theme.textMuted}>{SEP}</span>
						<span fg={theme.textMuted}>{memoryCount} memories</span>
					</>
				)}
				<span fg={theme.textMuted}>{SEP}</span>
				<span fg={theme.textMuted}>session:{shortId}</span>
			</text>
		</box>
	);
}

export { Header };
export type { HeaderProps };
