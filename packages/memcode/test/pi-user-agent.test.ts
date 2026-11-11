import { describe, expect, it } from "vitest";
import { getPiUserAgent } from "../src/utils/pi-user-agent.ts";

describe("getPiUserAgent", () => {
	it("formats the memcode user agent", () => {
		const runtime = process.versions.bun ? `bun/${process.versions.bun}` : `node/${process.version}`;
		const userAgent = getPiUserAgent("1.2.3");

		expect(userAgent).toBe(`memcode/1.2.3 (${process.platform}; ${runtime}; ${process.arch})`);
		expect(userAgent).toMatch(/^memcode\/[^\s()]+ \([^;()]+;\s*[^;()]+;\s*[^()]+\)$/);
	});
});
