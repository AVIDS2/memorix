/**
 * Memorix Memory Extension
 *
 * Registers:
 * - Native memory tools (search, store, detail, graph context, status)
 * - before_agent_start hook: injects relevant memories into system prompt
 * - agent_end hook: stores turn summary as observation
 *
 * All memory operations are in-process (no MCP transport).
 */

import type { ExtensionAPI } from "../core/extensions/types.ts";
import {
	memorixDetailTool,
	memorixGraphContextTool,
	memorixSearchTool,
	memorixStatusTool,
	memorixStoreTool,
} from "../tools/memory-tools.ts";
import { createMemoryInjectionHandler } from "../memory/memory-injection.ts";
import { createMemorixHookBridge } from "../memory/memorix-hook-bridge.ts";
import { resolveMemorixProjectContext } from "../memory/memorix-runtime-context.ts";

export default function memoryExtension(pi: ExtensionAPI): void {
	const nativeHooks = createMemorixHookBridge();

	// Register memory tools
	pi.registerTool(memorixSearchTool);
	pi.registerTool(memorixStoreTool);
	pi.registerTool(memorixDetailTool);
	pi.registerTool(memorixGraphContextTool);
	pi.registerTool(memorixStatusTool);

	// Resolve projectId from cwd using memorix project detection
	async function getProjectId(cwd: string): Promise<string> {
		try {
			return (await resolveMemorixProjectContext(cwd)).canonicalId;
		} catch {
			return cwd;
		}
	}

	// Inject relevant memories before each LLM turn
	pi.on("session_start", (event: any, ctx: any) => {
		void nativeHooks.captureSessionStart(event, ctx);
	});

	pi.on("before_agent_start", async (event: any, ctx: any) => {
		void nativeHooks.captureUserPrompt(event, ctx);
		try {
			const projectId = await getProjectId(ctx.cwd);
			const handler = createMemoryInjectionHandler(projectId);
			return await handler(event, ctx);
		} catch (err) {
			console.error("[memcode] memory injection failed:", err);
			return undefined;
		}
	});

	pi.on("session_before_compact", (event: any, ctx: any) => {
		void nativeHooks.captureSessionBeforeCompact(event, ctx);
	});

	pi.on("session_compact", (event: any, ctx: any) => {
		void nativeHooks.captureSessionCompact(event, ctx);
	});

	pi.on("session_shutdown", (event: any, ctx: any) => {
		void nativeHooks.captureSessionShutdown(event, ctx);
	});

	// Feed memcode's own lifecycle into Memorix's native hook pipeline.
	pi.on("tool_result", (event: any, ctx: any) => {
		void nativeHooks.captureToolResult(event, ctx);
	});

	pi.on("message_end", (event: any, ctx: any) => {
		void nativeHooks.captureAssistantMessage(event, ctx);
	});

	pi.on("user_bash", (event: any, ctx: any) => {
		void nativeHooks.captureUserBash(event, ctx);
	});

	pi.on("agent_end", (event: any, ctx: any) => {
		void nativeHooks.captureSessionEnd(event, ctx);
	});
}
