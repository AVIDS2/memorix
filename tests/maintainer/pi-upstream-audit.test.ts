import { describe, expect, test } from "vitest";
import { buildPiUpstreamAuditReport, diffPiGitTrees } from "../../scripts/pi-upstream-audit.mjs";

const manifest = {
	upstream: {
		repository: "earendil-works/pi",
		baseline: "v0.79.0",
	},
	packages: [
		{ name: "ai", upstreamPrefix: "packages/ai/" },
		{ name: "agent-core", upstreamPrefix: "packages/agent/" },
		{ name: "tui", upstreamPrefix: "packages/tui/" },
		{ name: "memcode", upstreamPrefix: "packages/coding-agent/" },
	],
	overlayWatchPaths: [
		{
			name: "Memorix command and memory integration",
			upstreamPaths: [
				"packages/coding-agent/src/core/slash-commands.ts",
				"packages/coding-agent/src/modes/interactive/interactive-mode.ts",
			],
		},
	],
};

describe("Pi upstream audit report", () => {
	test("groups upstream changes by the forked package and flags native overlay touchpoints", () => {
		const report = buildPiUpstreamAuditReport(
			{
				ahead_by: 4,
				total_commits: 4,
				files: [
					{ filename: "packages/ai/src/models.ts", status: "modified" },
					{ filename: "packages/coding-agent/src/core/slash-commands.ts", status: "modified" },
					{ filename: "packages/coding-agent/src/core/tools/bash.ts", status: "added" },
					{ filename: "docs/README.md", status: "modified" },
				],
			},
			manifest,
			{ base: "v0.79.0", head: "v0.82.1" },
		);

		expect(report.compare).toMatchObject({ aheadBy: 4, totalCommits: 4, filesSeen: 4, fileListMayBeTruncated: false });
		expect(report.packages).toEqual([
			{ name: "ai", changedFiles: 1, overlayFiles: [] },
			{
				name: "agent-core",
				changedFiles: 0,
				overlayFiles: [],
			},
			{ name: "tui", changedFiles: 0, overlayFiles: [] },
			{
				name: "memcode",
				changedFiles: 2,
				overlayFiles: [
					{
						filename: "packages/coding-agent/src/core/slash-commands.ts",
						areas: ["Memorix command and memory integration"],
					},
				],
			},
		]);
		expect(report.unmappedFiles).toEqual(["docs/README.md"]);
	});

	test("warns when GitHub's compare file list reaches its documented cap", () => {
		const report = buildPiUpstreamAuditReport(
			{
				ahead_by: 301,
				total_commits: 301,
				files: Array.from({ length: 300 }, (_, index) => ({
					filename: `packages/coding-agent/src/file-${index}.ts`,
					status: "modified",
				})),
			},
			manifest,
			{ base: "v0.79.0", head: "v0.82.1" },
		);

		expect(report.compare.fileListMayBeTruncated).toBe(true);
		expect(report.warnings).toContain("GitHub compare returns at most 300 changed files; inspect the full upstream range before merging.");
	});

	test("reconstructs a complete changed-path list from two Git trees when compare is capped", () => {
		const changes = diffPiGitTrees(
			[
				{ path: "packages/ai/src/removed.ts", mode: "100644", type: "blob", sha: "old" },
				{ path: "packages/coding-agent/src/core/tools/bash.ts", mode: "100644", type: "blob", sha: "before" },
			],
			[
				{ path: "packages/ai/src/added.ts", mode: "100644", type: "blob", sha: "new" },
				{ path: "packages/coding-agent/src/core/tools/bash.ts", mode: "100644", type: "blob", sha: "after" },
			],
		);

		expect(changes).toEqual([
			{ filename: "packages/ai/src/added.ts", status: "added" },
			{ filename: "packages/ai/src/removed.ts", status: "removed" },
			{ filename: "packages/coding-agent/src/core/tools/bash.ts", status: "modified" },
		]);
	});

	test("does not retain the compare truncation warning after a complete tree fallback", () => {
		const report = buildPiUpstreamAuditReport(
			{
				files: Array.from({ length: 301 }, (_, index) => ({
					filename: `packages/ai/src/file-${index}.ts`,
					status: "modified",
				})),
			},
			manifest,
			{ base: "v0.79.0", head: "v0.82.1" },
			{ fileSource: "git-tree", fileListMayBeTruncated: false },
		);

		expect(report.compare).toMatchObject({ fileSource: "git-tree", fileListMayBeTruncated: false });
		expect(report.warnings).toEqual([]);
	});
});
