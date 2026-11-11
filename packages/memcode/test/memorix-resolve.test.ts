import { afterEach, describe, expect, test } from "vitest";
import {
	resolveMemorixModuleRoot,
	importFromMemorix,
	resetMemorixModuleRootForTests,
} from "../src/core/memorix-resolve.ts";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

	test("prefers configured TypeScript sources over stale sibling js files", async () => {
		tempRoot = mkdtempSync(join(tmpdir(), "memorix-source-precedence-"));
		mkdirSync(join(tempRoot, "src", "memory"), { recursive: true });
		writeFileSync(join(tempRoot, "src", "memory", "observations.ts"), "export const marker = 'fresh-source';");
		writeFileSync(join(tempRoot, "src", "memory", "observations.js"), "export const marker = 'stale-sidecar';");

		process.env.MEMORIX_PACKAGE_ROOT = tempRoot;
		resetMemorixModuleRootForTests();

		const mod = await importFromMemorix("memory/observations.js");

		expect(mod.marker).toBe("fresh-source");
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
