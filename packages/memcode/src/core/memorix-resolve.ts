/**
 * Memorix Source Directory Resolver
 *
 * Locates the memorix src/ directory at runtime by walking up from __dirname
 * until it finds src/memory/observations.ts. This replaces fragile relative
 * imports like "../../../../src/compact/engine.js" that cross package boundaries.
 */

import { dirname, resolve, join } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

let _memorixSrcDir: string | null = null;
let _jiti: any = null;

function getCurrentDir(): string {
	return typeof __dirname === "string" ? __dirname : dirname(fileURLToPath(import.meta.url));
}

export function getMemorixSrcDir(): string {
	if (_memorixSrcDir) return _memorixSrcDir;

	// Walk up from __dirname to find src/memory/observations.ts
	let dir = getCurrentDir();
	for (let i = 0; i < 10; i++) {
		const candidate = join(dir, "src", "memory", "observations.ts");
		if (existsSync(candidate)) {
			_memorixSrcDir = join(dir, "src");
			return _memorixSrcDir;
		}
		const parent = resolve(dir, "..");
		if (parent === dir) break;
		dir = parent;
	}
	throw new Error("Cannot find memorix src/ directory");
}

function resolveMemorixModulePath(srcDir: string, subpath: string): string {
	if (subpath.endsWith(".js")) {
		const tsPath = join(srcDir, `${subpath.slice(0, -3)}.ts`);
		if (existsSync(tsPath)) return tsPath;
	}

	const fullPath = join(srcDir, subpath);
	if (existsSync(fullPath)) return fullPath;

	return fullPath;
}

/**
 * Dynamic import from memorix src/ directory.
 * Converts Windows paths to file:// URLs for ESM compatibility.
 */
export async function importFromMemorix(subpath: string): Promise<any> {
	const srcDir = getMemorixSrcDir();
	const fullPath = resolveMemorixModulePath(srcDir, subpath);
	if (fullPath.endsWith(".ts")) {
		if (!_jiti) {
			const { createJiti } = await import("jiti");
			_jiti = createJiti(import.meta.url);
		}
		return _jiti.import(pathToFileURL(fullPath).href);
	}
	// On Windows, ESM requires file:// URLs for absolute paths
	const url = pathToFileURL(fullPath).href;
	return import(url);
}
