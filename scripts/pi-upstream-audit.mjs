#!/usr/bin/env node

/*
 * Read-only Pi upstream audit for the memcode overlay.
 *
 * This deliberately reports differences only. Core runtime updates remain a
 * reviewed Memorix change: apply them in an isolated branch, keep native
 * memory integration intact, and run the normal package verification gates.
 */

import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(root, "packages", "memcode", "pi-upstream.json");
const GITHUB_COMPARE_FILE_LIMIT = 300;
const REQUEST_TIMEOUT_MS = 15_000;
const REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const execFileAsync = promisify(execFile);

function assertRef(value, optionName) {
	if (!REF_PATTERN.test(value)) {
		throw new Error(`${optionName} must be a Git ref made of letters, numbers, dot, underscore, slash, or dash.`);
	}
	return value;
}

function assertRepository(value) {
	if (!REPOSITORY_PATTERN.test(value)) {
		throw new Error("Pi upstream manifest has an invalid repository value.");
	}
	return value;
}

function readOption(args, index, option) {
	const value = args[index + 1];
	if (!value || value.startsWith("--")) {
		throw new Error(`${option} requires a value.`);
	}
	return value;
}

export function parsePiUpstreamAuditArgs(args) {
	const options = { base: undefined, head: undefined, json: false, help: false };
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === "--base") {
			options.base = assertRef(readOption(args, index, arg), arg);
			index += 1;
			continue;
		}
		if (arg === "--head") {
			options.head = assertRef(readOption(args, index, arg), arg);
			index += 1;
			continue;
		}
		if (arg === "--json") {
			options.json = true;
			continue;
		}
		if (arg === "--help" || arg === "-h") {
			options.help = true;
			continue;
		}
		throw new Error(`Unknown option: ${arg}`);
	}
	return options;
}

export function buildPiUpstreamAuditReport(compare, manifest, refs, options = {}) {
	const files = Array.isArray(compare?.files)
		? compare.files.filter((file) => typeof file?.filename === "string" && file.filename.length > 0)
		: [];
	const fileListMayBeTruncated = options.fileListMayBeTruncated ?? files.length >= GITHUB_COMPARE_FILE_LIMIT;
	const packages = (manifest.packages ?? []).map((pkg) => ({
		name: pkg.name,
		upstreamPrefix: pkg.upstreamPrefix,
		changedFiles: 0,
		overlayFiles: [],
	}));
	const unmappedFiles = [];

	for (const file of files) {
		const bucket = packages.find((pkg) => file.filename.startsWith(pkg.upstreamPrefix));
		if (!bucket) {
			unmappedFiles.push(file.filename);
			continue;
		}

		bucket.changedFiles += 1;
		const areas = (manifest.overlayWatchPaths ?? [])
			.filter((area) => area.upstreamPaths?.includes(file.filename))
			.map((area) => area.name);
		if (areas.length > 0) {
			bucket.overlayFiles.push({ filename: file.filename, areas });
		}
	}

	const warnings = [];
	if (fileListMayBeTruncated) {
		warnings.push("GitHub compare returns at most 300 changed files; inspect the full upstream range before merging.");
	}

	return {
		upstream: {
			repository: manifest.upstream.repository,
			base: refs.base,
			head: refs.head,
		},
		compare: {
			aheadBy: typeof compare?.ahead_by === "number" ? compare.ahead_by : undefined,
			totalCommits: typeof compare?.total_commits === "number" ? compare.total_commits : undefined,
			filesSeen: files.length,
			fileListMayBeTruncated,
			fileSource: options.fileSource ?? "compare",
		},
		packages: packages.map(({ name, changedFiles, overlayFiles }) => ({ name, changedFiles, overlayFiles })),
		unmappedFiles,
		warnings,
	};
}

export function diffPiGitTrees(baseTree, headTree) {
	const indexTree = (entries) => {
		const index = new Map();
		for (const entry of entries ?? []) {
			if (entry?.type !== "blob" || typeof entry.path !== "string" || typeof entry.sha !== "string") continue;
			index.set(entry.path, { mode: entry.mode, sha: entry.sha });
		}
		return index;
	};
	const baseEntries = indexTree(baseTree);
	const headEntries = indexTree(headTree);
	const paths = new Set([...baseEntries.keys(), ...headEntries.keys()]);
	const changes = [];

	for (const filename of [...paths].sort((left, right) => left.localeCompare(right))) {
		const before = baseEntries.get(filename);
		const after = headEntries.get(filename);
		if (!before && after) {
			changes.push({ filename, status: "added" });
			continue;
		}
		if (before && !after) {
			changes.push({ filename, status: "removed" });
			continue;
		}
		if (before?.sha !== after?.sha || before?.mode !== after?.mode) {
			changes.push({ filename, status: "modified" });
		}
	}
	return changes;
}

export function formatPiUpstreamAuditReport(report) {
	const lines = [
		"Pi upstream audit (read-only)",
		`${report.upstream.repository}: ${report.upstream.base} -> ${report.upstream.head}`,
		`${report.compare.aheadBy ?? "?"} commits ahead; ${report.compare.filesSeen} changed file entries seen.`,
		"",
		"Package impact:",
	];

	for (const pkg of report.packages) {
		lines.push(`- ${pkg.name}: ${pkg.changedFiles} changed file(s)`);
		for (const file of pkg.overlayFiles) {
			lines.push(`  - review native overlay: ${file.filename} (${file.areas.join(", ")})`);
		}
	}

	if (report.unmappedFiles.length > 0) {
		lines.push("", `Unmapped upstream files: ${report.unmappedFiles.length}`);
	}
	for (const warning of report.warnings) {
		lines.push("", `WARNING: ${warning}`);
	}

	lines.push(
		"",
		"This report never applies upstream code. Review the range, port selected changes in a branch, then run package tests and smoke checks.",
	);
	return lines.join("\n");
}

async function readManifest() {
	const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
	assertRepository(manifest?.upstream?.repository);
	assertRef(manifest?.upstream?.baseline, "manifest upstream.baseline");
	if (!Array.isArray(manifest.packages) || manifest.packages.length === 0) {
		throw new Error("Pi upstream manifest must define at least one package mapping.");
	}
	return manifest;
}

async function fetchGitHubJson(endpoint) {
	const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
	const headers = {
		Accept: "application/vnd.github+json",
		"User-Agent": "memorix-pi-upstream-audit",
		...(token ? { Authorization: `Bearer ${token}` } : {}),
	};
	let response;
	try {
		response = await fetch(`https://api.github.com${endpoint}`, {
			headers,
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
		});
	} catch (error) {
		if (token) throw error;
		return fetchGitHubJsonWithGh(endpoint, error);
	}
	if (response.ok) {
		return response.json();
	}

	const body = await response.text();
	const error = new Error(`GitHub API ${response.status}: ${body.slice(0, 300) || response.statusText}`);
	if (token || (response.status !== 403 && response.status !== 429)) {
		throw error;
	}
	return fetchGitHubJsonWithGh(endpoint, error);
}

async function fetchGitHubJsonWithGh(endpoint, fetchError) {
	try {
		const { stdout } = await execFileAsync(
			"gh",
			["api", endpoint.replace(/^\//, ""), "--header", "Accept: application/vnd.github+json"],
			{ windowsHide: true, maxBuffer: 10 * 1024 * 1024 },
		);
		return JSON.parse(stdout);
	} catch (ghError) {
		const fetchMessage = fetchError instanceof Error ? fetchError.message : String(fetchError);
		const ghMessage = ghError instanceof Error ? ghError.message : String(ghError);
		throw new Error(`${fetchMessage}\nAuthenticated gh fallback failed: ${ghMessage}`);
	}
}

async function resolveHeadRef(repository, requestedHead) {
	if (requestedHead) return requestedHead;
	const release = await fetchGitHubJson(`/repos/${repository}/releases/latest`);
	if (!release || typeof release.tag_name !== "string") {
		throw new Error("GitHub latest-release response did not include a tag_name.");
	}
	return assertRef(release.tag_name, "latest release tag");
}

async function fetchGitTree(repository, ref) {
	const commit = await fetchGitHubJson(`/repos/${repository}/commits/${encodeURIComponent(ref)}`);
	const treeSha = commit?.commit?.tree?.sha;
	if (typeof treeSha !== "string" || !treeSha) {
		throw new Error(`GitHub commit response for ${ref} did not include a tree SHA.`);
	}
	const tree = await fetchGitHubJson(`/repos/${repository}/git/trees/${treeSha}?recursive=1`);
	if (!Array.isArray(tree?.tree)) {
		throw new Error(`GitHub tree response for ${ref} did not include entries.`);
	}
	return tree;
}

export async function runPiUpstreamAudit(options = {}) {
	const manifest = await readManifest();
	const repository = manifest.upstream.repository;
	const base = options.base ?? manifest.upstream.baseline;
	const head = await resolveHeadRef(repository, options.head);
	let compare = await fetchGitHubJson(
		`/repos/${repository}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`,
	);
	const compareFiles = Array.isArray(compare.files) ? compare.files : [];
	if (compareFiles.length < GITHUB_COMPARE_FILE_LIMIT) {
		return buildPiUpstreamAuditReport(compare, manifest, { base, head });
	}

	const [baseTree, headTree] = await Promise.all([fetchGitTree(repository, base), fetchGitTree(repository, head)]);
	if (baseTree.truncated || headTree.truncated) {
		return buildPiUpstreamAuditReport(compare, manifest, { base, head }, { fileListMayBeTruncated: true });
	}

	compare = { ...compare, files: diffPiGitTrees(baseTree.tree, headTree.tree) };
	return buildPiUpstreamAuditReport(compare, manifest, { base, head }, {
		fileSource: "git-tree",
		fileListMayBeTruncated: false,
	});
}

function printUsage() {
	console.log(`Usage: npm run audit:pi-upstream -- [--base <ref>] [--head <ref>] [--json]

Compare the pinned Pi baseline to an upstream release. With no --head, the
official latest release is used. The command is read-only and does not merge or
replace any source files.`);
}

async function main() {
	const options = parsePiUpstreamAuditArgs(process.argv.slice(2));
	if (options.help) {
		printUsage();
		return;
	}
	const report = await runPiUpstreamAudit(options);
	console.log(options.json ? JSON.stringify(report, null, 2) : formatPiUpstreamAuditReport(report));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	});
}
