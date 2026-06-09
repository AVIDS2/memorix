/**
 * LLM Provider
 *
 * Abstraction layer for LLM-enhanced memory management.
 * Supports OpenAI-compatible APIs (OpenAI, Anthropic via proxy, local models).
 *
 * This is the optional "premium" path — Memorix works without it,
 * but with an LLM configured, memory quality approaches Mem0/Cipher level.
 */
export interface LLMConfig {
    provider: 'openai' | 'anthropic' | 'openrouter' | 'custom';
    apiKey: string;
    model?: string;
    baseUrl?: string;
}
/**
 * Parse and validate MEMORIX_LLM_TIMEOUT_MS environment variable.
 * - Must be a valid integer in the range 1000–300000ms.
 * - Non-integer or out-of-range values log a warning and fall back to the default.
 * Default: 30000ms (30s) — allows for proxy routing and cold starts.
 */
export declare function parseLLMTimeoutMs(raw: string | undefined): number;
export interface LLMResponse {
    content: string;
    usage?: {
        promptTokens: number;
        completionTokens: number;
    };
}
/** A single tool call requested by the LLM */
export interface ToolCall {
    id: string;
    name: string;
    arguments: string;
}
/** Response from callLLMWithTools — may contain text, tool calls, or both */
export interface LLMToolResponse {
    content: string;
    toolCalls: ToolCall[];
    stopReason: 'end_turn' | 'tool_use' | 'stop' | 'unknown';
    usage?: {
        promptTokens: number;
        completionTokens: number;
    };
}
/** Streaming event from callLLMWithToolsStream */
export type LLMStreamEvent = {
    type: 'text';
    content: string;
} | {
    type: 'tool_call';
    toolCall: ToolCall;
} | {
    type: 'done';
    response: LLMToolResponse;
};
/**
 * Call the LLM with tools in streaming mode.
 * Yields text chunks as they arrive, then a final 'done' event with the complete response.
 * Tool calls are accumulated and yielded at the end.
 */
export declare function callLLMWithToolsStream(messages: ChatMessage[], tools: ToolDefinition[]): AsyncGenerator<LLMStreamEvent, void, undefined>;
/** Tool definition for LLM function calling */
export interface ToolDefinition {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
}
/** Chat message for multi-turn tool-use conversations */
export interface ChatMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string;
    toolCallId?: string;
    toolCalls?: ToolCall[];
    name?: string;
}
export type LLMConfigScope = 'memory' | 'agent';
export interface InitLLMOptions {
    scope?: LLMConfigScope;
}
/**
 * Initialize the LLM provider from environment variables.
 * Returns null if no API key is configured — Memorix gracefully degrades.
 */
export declare function initLLM(options?: InitLLMOptions): LLMConfig | null;
/**
 * Check if LLM is available.
 */
export declare function isLLMEnabled(): boolean;
/**
 * Get current LLM config (for display/debug).
 */
export declare function getLLMConfig(): LLMConfig | null;
/**
 * Set LLM config directly (for testing or programmatic use).
 */
export declare function setLLMConfig(config: LLMConfig | null): void;
/**
 * Call the LLM with a prompt.
 * Uses OpenAI-compatible chat completions API (works with OpenRouter, Ollama, etc.)
 *
 * For Anthropic, we use their Messages API directly.
 */
export declare function callLLM(systemPrompt: string, userMessage: string): Promise<LLMResponse>;
/**
 * Call the LLM with tool definitions (agentic harness pattern).
 *
 * The LLM can decide to call tools or respond directly.
 * Returns structured response with tool_calls for the agentic loop.
 */
export declare function callLLMWithTools(messages: ChatMessage[], tools: ToolDefinition[], signal?: AbortSignal): Promise<LLMToolResponse>;
//# sourceMappingURL=provider.d.ts.map