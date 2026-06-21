#!/usr/bin/env node
/**
 * CLI entry point for the refactored coding agent.
 * Uses main.ts with AgentSession and new mode modules.
 *
 * Test with: npx tsx src/cli-new.ts [args...]
 */
import { fileURLToPath } from "node:url";
import { APP_NAME } from "./config.ts";
import { configureHttpDispatcher } from "./core/http-dispatcher.ts";
import { importFromMemorix } from "./core/memorix-resolve.ts";
import { applyMemorixAgentDefaults } from "./config/memorix-config-adapter.ts";
import { main } from "./main.ts";

export async function runCli(args: string[] = process.argv.slice(2)): Promise<void> {
	process.title = APP_NAME;
	process.env.MEMCODE_CODING_AGENT = "true";
	// Default embedding to "auto" so memcode uses local embeddings (fastembed/transformers)
	// when available, falling back to BM25. Users can still override via MEMORIX_EMBEDDING env var.
	process.env.MEMORIX_EMBEDDING = process.env.MEMORIX_EMBEDDING || "auto";
	process.emitWarning = (() => {}) as typeof process.emitWarning;
	await applyResolvedMemorixConfig();

	// Configure undici's global dispatcher before provider SDKs issue requests.
	// Runtime settings are applied once SettingsManager has loaded global/project settings.
	configureHttpDispatcher();

	await main(args);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
	void runCli();
}

async function applyResolvedMemorixConfig(): Promise<void> {
	try {
		const { getResolvedConfigForCwd } = await importFromMemorix("config/resolved-config.js");
		applyMemorixAgentDefaults(getResolvedConfigForCwd(process.cwd()));
	} catch {
		// memcode can still run standalone; native memory config is a default layer, not a hard dependency.
	}
}
