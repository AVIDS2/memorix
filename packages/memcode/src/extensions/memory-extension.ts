/**
 * Memorix Memory Extension
 *
 * Registers:
 * - 3 native memory tools (memorix_search, memorix_store, memorix_detail)
 * - before_agent_start hook: injects relevant memories into system prompt
 * - agent_end hook: stores turn summary as observation
 *
 * All memory operations are in-process (no MCP transport).
 */

import type { ExtensionAPI } from "../core/extensions/types.ts";
import { memorixSearchTool, memorixStoreTool, memorixDetailTool } from "../tools/memory-tools.ts";
import { createMemoryInjectionHandler } from "../memory/memory-injection.ts";
import { storeMemoryFromTurn } from "../memory/memory-storage.ts";

export default function memoryExtension(pi: ExtensionAPI): void {
	// Register memory tools
	pi.registerTool(memorixSearchTool);
	pi.registerTool(memorixStoreTool);
	pi.registerTool(memorixDetailTool);

	// Resolve projectId from cwd using memorix project detection
	async function getProjectId(cwd: string): Promise<string> {
		try {
			const { detectProject } = await import("../../../../src/project/detector.js");
			return detectProject(cwd)?.id ?? cwd;
		} catch {
			return cwd;
		}
	}

	// Inject relevant memories before each LLM turn
	pi.on("before_agent_start", async (event: any, ctx: any) => {
		try {
			const projectId = await getProjectId(ctx.cwd);
			const handler = createMemoryInjectionHandler(projectId);
			return await handler(event, ctx);
		} catch (err) {
			console.error("[memcode] memory injection failed:", err);
			return undefined;
		}
	});

	// Store turn summary after each agent turn
	pi.on("agent_end", async (event: any, ctx: any) => {
		try {
			const projectId = await getProjectId(ctx.cwd);
			await storeMemoryFromTurn(
				event.messages,
				projectId,
				"session",
				{ enabled: true, minMessagesForStorage: 2 },
			);
		} catch (err) {
			console.error("[memcode] memory storage failed:", err);
		}
	});
}
