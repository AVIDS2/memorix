/**
 * Memory Storage Hook
 *
 * Stores observations from agent turns into Memorix's long-term memory.
 * Designed to be wired into the Extension system's `agent_end` event.
 *
 * Hook point: ExtensionRunner emits `agent_end` with all turn messages.
 * Register via:
 *   pi.on("agent_end", async (event) => {
 *     await storeMemoryFromTurn(event.messages, projectId, sessionId, config);
 *   });
 *
 * The `agent_end` event fires once per agent loop (after all turns complete),
 * carrying the full message array. This is the correct post-turn storage point
 * because:
 *   1. All tool results are finalized (no partial state)
 *   2. The assistant's final response is complete
 *   3. The session manager has already persisted entries
 */

import type { AgentMessage } from "@memorix/agent-core";
import type { AssistantMessage, TextContent } from "@memorix/ai";

// ─── Configuration ──────────────────────────────────────────────────

export interface MemoryStorageConfig {
	/** Whether automatic turn storage is enabled. Default: true */
	enabled: boolean;
	/** Minimum number of messages in a turn to consider storing. Default: 2 */
	minMessagesForStorage: number;
}

const DEFAULT_CONFIG: MemoryStorageConfig = {
	enabled: true,
	minMessagesForStorage: 2,
};

// ─── Text Extraction ────────────────────────────────────────────────

/**
 * Extract plain text from an assistant message's content blocks.
 * Filters out thinking blocks and tool calls, keeping only text content.
 */
function extractAssistantText(message: AgentMessage): string {
	if ((message as AssistantMessage).role !== "assistant") return "";

	const assistant = message as AssistantMessage;
	const textParts: string[] = [];

	for (const block of assistant.content) {
		if (block.type === "text") {
			textParts.push((block as TextContent).text);
		}
	}

	return textParts.join("\n").trim();
}

/**
 * Extract text from all assistant messages in a turn.
 * Returns the concatenated text of all assistant responses.
 */
function extractTurnSummary(messages: AgentMessage[]): string {
	const parts: string[] = [];

	for (const msg of messages) {
		if ((msg as AssistantMessage).role === "assistant") {
			const text = extractAssistantText(msg);
			if (text) parts.push(text);
		}
	}

	return parts.join("\n\n").trim();
}

// ─── Trivial Turn Detection ─────────────────────────────────────────

/** Minimum content length to consider a turn non-trivial */
const MIN_CONTENT_LENGTH = 50;

/**
 * Check if a turn is too trivial to store as a memory.
 * Returns true if the turn should be skipped.
 */
function isTrivialTurn(messages: AgentMessage[], content: string): boolean {
	// Too few messages — likely just a greeting or acknowledgment
	if (messages.length < 2) return true;

	// Content too short — no substantive information
	if (content.length < MIN_CONTENT_LENGTH) return true;

	// Check if the assistant only made tool calls with no text response
	const hasTextResponse = messages.some(
		(m) => (m as AssistantMessage).role === "assistant" && extractAssistantText(m).length > 0,
	);
	if (!hasTextResponse) return true;

	return false;
}

// ─── Entity Name Derivation ─────────────────────────────────────────

/**
 * Derive a short entity name from the turn content.
 * Used as the observation's entityName field.
 */
function deriveEntityName(content: string): string {
	// Use first meaningful words from the content
	const words = content
		.replace(/[^a-zA-Z0-9\s-_]/g, "")
		.trim()
		.split(/\s+/)
		.slice(0, 4)
		.join("-")
		.toLowerCase();

	return words || "agent-turn";
}

// ─── Main Export ────────────────────────────────────────────────────

/**
 * Store a memory observation from an agent turn.
 *
 * Extracts a summary from assistant messages and persists it via
 * Memorix's storeObservation API. Skips trivial turns (few messages
 * or very short content).
 *
 * @param messages - All messages from the completed agent turn
 * @param projectId - Memorix project identifier
 * @param sessionId - Current session identifier
 * @param config - Storage configuration (optional, uses defaults)
 */
export async function storeMemoryFromTurn(
	messages: AgentMessage[],
	projectId: string,
	sessionId: string,
	config?: Partial<MemoryStorageConfig>,
): Promise<{ stored: boolean; reason?: string }> {
	const cfg = { ...DEFAULT_CONFIG, ...config };

	// Gate: disabled
	if (!cfg.enabled) {
		return { stored: false, reason: "disabled" };
	}

	// Extract summary from assistant messages
	const fullText = extractTurnSummary(messages);

	// Gate: trivial turn
	if (isTrivialTurn(messages, fullText)) {
		return { stored: false, reason: "trivial" };
	}

	// Build observation fields
	const title = fullText.slice(0, 200);
	const narrative = fullText;
	const entityName = deriveEntityName(fullText);

	try {
		// Import storeObservation from memorix core.
		// Path: packages/memcode/src/memory/ -> ../../../../src/memory/observations.js
		// This crosses package boundaries within the monorepo — intentional for
		// the memcode agent to persist into the shared Memorix store.
		const { storeObservation } = await import("../../../../src/memory/observations.js");

		await storeObservation({
			entityName,
			type: "how-it-works",
			title,
			narrative,
			projectId,
			sessionId,
			source: "agent",
			sourceDetail: "hook",
		});

		return { stored: true };
	} catch (err) {
		// Never break the agent turn on memory storage failure
		const message = err instanceof Error ? err.message : String(err);
		console.error(`[memorix] memory-storage hook failed: ${message}`);
		return { stored: false, reason: `error: ${message}` };
	}
}
