export function getMemcodeUserAgent(version: string): string {
	const runtime = process.versions.bun ? `bun/${process.versions.bun}` : `node/${process.version}`;
	return `memcode/${version} (${process.platform}; ${runtime}; ${process.arch})`;
}

/** @deprecated Use getMemcodeUserAgent. Retained for Pi-compatible extensions. */
export const getPiUserAgent = getMemcodeUserAgent;
