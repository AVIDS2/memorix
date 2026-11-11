import { getMemcodeUserAgent } from "./pi-user-agent.ts";

const LATEST_VERSION_URL = "https://registry.npmjs.org/memorix/latest";
const DEFAULT_VERSION_CHECK_TIMEOUT_MS = 10000;

export interface LatestMemcodeRelease {
	version: string;
	packageName?: string;
	note?: string;
}

/** @deprecated Use LatestMemcodeRelease. */
export type LatestPiRelease = LatestMemcodeRelease;

interface ParsedVersion {
	major: number;
	minor: number;
	patch: number;
	prerelease?: string;
}

function parsePackageVersion(version: string): ParsedVersion | undefined {
	const match = version.trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+.*)?$/);
	if (!match) {
		return undefined;
	}
	return {
		major: Number.parseInt(match[1], 10),
		minor: Number.parseInt(match[2], 10),
		patch: Number.parseInt(match[3], 10),
		prerelease: match[4],
	};
}

export function comparePackageVersions(leftVersion: string, rightVersion: string): number | undefined {
	const left = parsePackageVersion(leftVersion);
	const right = parsePackageVersion(rightVersion);
	if (!left || !right) {
		return undefined;
	}

	if (left.major !== right.major) return left.major - right.major;
	if (left.minor !== right.minor) return left.minor - right.minor;
	if (left.patch !== right.patch) return left.patch - right.patch;
	if (left.prerelease === right.prerelease) return 0;
	if (!left.prerelease) return 1;
	if (!right.prerelease) return -1;
	return left.prerelease.localeCompare(right.prerelease);
}

export function isNewerPackageVersion(candidateVersion: string, currentVersion: string): boolean {
	const comparison = comparePackageVersions(candidateVersion, currentVersion);
	if (comparison !== undefined) {
		return comparison > 0;
	}
	return candidateVersion.trim() !== currentVersion.trim();
}

export async function getLatestMemcodeRelease(
	currentVersion: string,
	options: { timeoutMs?: number } = {},
): Promise<LatestMemcodeRelease | undefined> {
	if (process.env.MEMCODE_SKIP_VERSION_CHECK || process.env.PI_SKIP_VERSION_CHECK || process.env.MEMCODE_OFFLINE || process.env.PI_OFFLINE) return undefined;

	const response = await fetch(LATEST_VERSION_URL, {
		headers: {
			"User-Agent": getMemcodeUserAgent(currentVersion),
			accept: "application/json",
		},
		signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_VERSION_CHECK_TIMEOUT_MS),
	});
	if (!response.ok) return undefined;

	const data = (await response.json()) as {
		name?: unknown;
		packageName?: unknown;
		version?: unknown;
		note?: unknown;
	};
	if (typeof data.version !== "string" || !data.version.trim()) {
		return undefined;
	}
	const packageName =
		typeof data.packageName === "string" && data.packageName.trim() ? data.packageName.trim() : undefined;
	const npmPackageName =
		typeof data.name === "string" && data.name.trim() ? data.name.trim() : undefined;
	const note = typeof data.note === "string" && data.note.trim() ? data.note.trim() : undefined;
	return {
		version: data.version.trim(),
		...(packageName || npmPackageName ? { packageName: packageName ?? npmPackageName } : {}),
		...(note ? { note } : {}),
	};
}

export async function getLatestMemcodeVersion(
	currentVersion: string,
	options: { timeoutMs?: number } = {},
): Promise<string | undefined> {
	return (await getLatestMemcodeRelease(currentVersion, options))?.version;
}

export async function checkForNewMemcodeVersion(currentVersion: string): Promise<LatestMemcodeRelease | undefined> {
	try {
		const latestRelease = await getLatestMemcodeRelease(currentVersion);
		if (latestRelease && isNewerPackageVersion(latestRelease.version, currentVersion)) {
			return latestRelease;
		}
		return undefined;
	} catch {
		return undefined;
	}
}

/** @deprecated Use getLatestMemcodeRelease. */
export const getLatestPiRelease = getLatestMemcodeRelease;
/** @deprecated Use getLatestMemcodeVersion. */
export const getLatestPiVersion = getLatestMemcodeVersion;
/** @deprecated Use checkForNewMemcodeVersion. */
export const checkForNewPiVersion = checkForNewMemcodeVersion;
