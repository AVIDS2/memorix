import { afterEach, describe, expect, test } from "vitest";
import {
	resolveMemorixModuleRoot,
	importFromMemorix,
	resetMemorixModuleRootForTests,
} from "../src/core/memorix-resolve.ts";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

describe("importFromMemorix", () => {
	let tempRoot: string | undefined;

	afterEach(() => {
		delete process.env.MEMORIX_PACKAGE_ROOT;
		resetMemorixModuleRootForTests();
		if (tempRoot) {
			rmSync(tempRoot, { recursive: true, force: true });
			tempRoot = undefined;
		}
	});

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

	test("uses MEMORIX_PACKAGE_ROOT src files for npm-installed root package layouts", () => {
		tempRoot = mkdtempSync(join(tmpdir(), "memorix-installed-root-"));
		mkdirSync(join(tempRoot, "src", "memory"), { recursive: true });
		writeFileSync(join(tempRoot, "src", "memory", "observations.ts"), "export const marker = 'src';");

		process.env.MEMORIX_PACKAGE_ROOT = tempRoot;
		resetMemorixModuleRootForTests();

		const root = resolveMemorixModuleRoot();

		expect(root).toEqual({ kind: "src", root: join(tempRoot, "src") });
	});

});
