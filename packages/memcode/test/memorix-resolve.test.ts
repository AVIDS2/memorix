import { describe, expect, test } from "vitest";
import { importFromMemorix } from "../src/core/memorix-resolve.ts";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

describe("importFromMemorix", () => {
	test("resolves built js subpaths to root TypeScript source files in the repo workspace", async () => {
		const mod = await importFromMemorix("hooks/types.js");

		expect(mod.AGENT_SUPPORT_TIER.codex).toBe("extended");
	});

	test("prefers repo TypeScript sources over stale sibling js files", () => {
		const currentDir = dirname(fileURLToPath(import.meta.url));
		const projectRoot = join(currentDir, "..", "..", "..");
		const tsSource = readFileSync(join(projectRoot, "src", "memory", "observations.ts"), "utf8");
		const jsSource = readFileSync(join(projectRoot, "src", "memory", "observations.js"), "utf8");

		expect(tsSource).toContain("using BM25 until embedding recovers");
		expect(jsSource).not.toContain("using BM25 until embedding recovers");
	});
});
