import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

describe("memorix module resolver bundling", () => {
	test("uses the static jiti entry so bundled native hooks do not look for ../dist/babel.cjs", () => {
		const testDir = dirname(fileURLToPath(import.meta.url));
		const source = readFileSync(join(testDir, "../src/core/memorix-resolve.ts"), "utf8");

		expect(source).toContain('import("jiti/static")');
		expect(source).not.toContain('import("jiti")');
	});
});
