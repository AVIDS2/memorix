import type { AgentMessage } from "@memorix/agent-core";
import type { ImageContent, TextContent } from "@memorix/ai";
import type {
	BeforeAgentStartEvent,
	ExtensionContext,
	MessageEndEvent,
	SessionBeforeCompactEvent,
	SessionCompactEvent,
	SessionShutdownEvent,
	SessionStartEvent,
	UserBashEvent,
	ToolResultEvent,
} from "../core/extensions/types.ts";
import { importFromMemorix } from "../core/memorix-resolve.ts";

type NativeHookEvent =
	| "session_start"
	| "session_before_compact"
	| "session_compact"
	| "session_shutdown"
	| "user_prompt"
	| "post_edit"
	| "post_command"
	| "post_tool"
	| "pre_compact"
	| "post_compact"
	| "session_end"
	| "post_response";

interface NativeHookInput {
	event: NativeHookEvent;
	agent: "codex";
	timestamp: string;
	sessionId: string;
	cwd: string;
	userPrompt?: string;
	aiResponse?: string;
	command?: string;
	commandOutput?: string;
	toolName?: string;
	toolInput?: Record<string, unknown>;
	toolResult?: string;
	raw: Record<string, unknown>;
}

interface HookObservation {
	entityName: string;
	type: string;
	title: string;
	narrative: string;
	facts?: string[];
	concepts?: string[];
	filesModified?: string[];
}

interface HookOutput {
	continue: boolean;
	systemMessage?: string;
}

type ProcessHook = (input: NativeHookInput) => Promise<{ observation: HookObservation | null; output: HookOutput }>;
type StoreHookObservation = (
	observation: HookObservation,
	metadata: { cwd: string; sessionId: string },
) => Promise<void>;

interface LoggerLike {
	error(message?: unknown, ...optionalParams: unknown[]): void;
}

export interface MemorixHookBridgeOptions {
	processHook?: ProcessHook;
	storeObservation?: StoreHookObservation;
	logger?: LoggerLike;
}

export interface MemorixHookBridgeStatus {
	active: boolean;
	createdAt: string;
	lastEventAt?: string;
	sessionId?: string;
	cwd?: string;
	lastError?: string;
	lastStoredObservation?: {
		title: string;
		type: string;
		entityName: string;
		at: string;
	};
	counts: Partial<Record<NativeHookEvent | "user_bash", number>>;
	recentEvents: Array<{
		event: NativeHookEvent | "user_bash";
		at: string;
		detail: string;
		stored?: boolean;
		skipped?: string;
	}>;
}

export interface MemorixHookBridge {
	captureSessionStart(event: SessionStartEvent, ctx: ExtensionContext): Promise<void>;
	captureSessionBeforeCompact(event: SessionBeforeCompactEvent, ctx: ExtensionContext): Promise<void>;
	captureSessionCompact(event: SessionCompactEvent, ctx: ExtensionContext): Promise<void>;
	captureSessionShutdown(event: SessionShutdownEvent, ctx: ExtensionContext): Promise<void>;
	captureUserBash(event: UserBashEvent, ctx: ExtensionContext): Promise<void>;
	captureUserPrompt(event: BeforeAgentStartEvent, ctx: ExtensionContext): Promise<void>;
	captureToolResult(event: ToolResultEvent, ctx: ExtensionContext): Promise<void>;
	captureAssistantMessage(event: MessageEndEvent, ctx: ExtensionContext): Promise<void>;
	captureSessionEnd(event: { type: "agent_end"; messages: AgentMessage[] }, ctx: ExtensionContext): Promise<void>;
	getStatus(): MemorixHookBridgeStatus;
}

let currentStatus: MemorixHookBridgeStatus = {
	active: false,
	createdAt: new Date().toISOString(),
	counts: {},
	recentEvents: [],
};

function getSessionId(ctx: ExtensionContext): string {
	try {
		return ctx.sessionManager.getSessionId();
	} catch {
		return "memcode-session";
	}
}

function createBaseInput(event: NativeHookEvent, ctx: ExtensionContext, raw: Record<string, unknown>): NativeHookInput {
	return {
		event,
		agent: "codex",
		timestamp: new Date().toISOString(),
		sessionId: getSessionId(ctx),
		cwd: ctx.cwd,
		raw,
	};
}

function pushRecentEvent(
	event: NativeHookEvent | "user_bash",
	detail: string,
	opts?: { stored?: boolean; skipped?: string },
): void {
	currentStatus.lastEventAt = new Date().toISOString();
	currentStatus.recentEvents.unshift({
		event,
		at: currentStatus.lastEventAt,
		detail,
		...opts,
	});
	currentStatus.recentEvents = currentStatus.recentEvents.slice(0, 8);
	currentStatus.counts[event] = (currentStatus.counts[event] ?? 0) + 1;
}

function markContextFrom(cwd: string, sessionId: string): void {
	currentStatus.active = true;
	currentStatus.cwd = cwd;
	currentStatus.sessionId = sessionId;
}

function markContext(ctx: ExtensionContext): void {
	markContextFrom(ctx.cwd, getSessionId(ctx));
}

function extractTextContent(content: unknown): string {
	if (typeof content === "string") return content.trim();
	if (!Array.isArray(content)) return "";

	const parts: string[] = [];
	for (const block of content) {
		if (
			block &&
			typeof block === "object" &&
			(block as { type?: unknown }).type === "text" &&
			typeof (block as { text?: unknown }).text === "string"
		) {
			parts.push((block as { text: string }).text);
		}
	}
	return parts.join("\n").trim();
}

function extractAssistantText(message: AgentMessage): string {
	if (message.role !== "assistant") return "";
	return extractTextContent(message.content);
}

function stringifyToolResult(content: (TextContent | ImageContent)[]): string {
	return extractTextContent(content);
}

function extractCommand(toolName: string, input: Record<string, unknown>): string | undefined {
	if (toolName !== "bash") return undefined;
	const command = input.command;
	return typeof command === "string" ? command : undefined;
}

function shouldSkipTool(toolName: string): boolean {
	return toolName.toLowerCase().startsWith("memorix_");
}

export function getMemorixHookBridgeStatus(): MemorixHookBridgeStatus {
	return {
		...currentStatus,
		counts: { ...currentStatus.counts },
		recentEvents: currentStatus.recentEvents.map((event) => ({ ...event })),
	};
}

export function resetMemorixHookBridgeStatus(): void {
	currentStatus = {
		active: false,
		createdAt: new Date().toISOString(),
		counts: {},
		recentEvents: [],
	};
}

async function defaultProcessHook(input: NativeHookInput): Promise<{ observation: HookObservation | null; output: HookOutput }> {
	const { handleHookEvent } = await importFromMemorix("hooks/handler.js");
	return handleHookEvent(input);
}

async function defaultStoreObservation(
	observation: HookObservation,
	metadata: { cwd: string; sessionId: string },
): Promise<void> {
	const { detectProject } = await importFromMemorix("project/detector.js");
	const { getProjectDataDir } = await importFromMemorix("store/persistence.js");
	const { initAliasRegistry, registerAlias } = await importFromMemorix("project/aliases.js");
	const { initObservationStore } = await importFromMemorix("store/obs-store.js");
	const { initMiniSkillStore } = await importFromMemorix("store/mini-skill-store.js");
	const { initSessionStore } = await importFromMemorix("store/session-store.js");
	const { initObservations, storeObservation } = await importFromMemorix("memory/observations.js");

	const rawProject = detectProject(metadata.cwd || process.cwd());
	if (!rawProject) {
		throw new Error("No .git found for native hook storage");
	}

	const dataDir = await getProjectDataDir(rawProject.id);
	initAliasRegistry(dataDir);
	const projectId = await registerAlias(rawProject);
	await initObservationStore(dataDir);
	await initMiniSkillStore(dataDir);
	await initSessionStore(dataDir);
	await initObservations(dataDir);
	await storeObservation({
		...observation,
		projectId,
		sessionId: metadata.sessionId,
		sourceDetail: "hook",
	});
}

export function createMemorixHookBridge(options: MemorixHookBridgeOptions = {}): MemorixHookBridge {
	const processHook = options.processHook ?? defaultProcessHook;
	const storeObservation = options.storeObservation ?? defaultStoreObservation;
	const logger = options.logger ?? console;
	currentStatus.active = true;

	async function capture(input: NativeHookInput): Promise<void> {
		try {
			markContextFrom(input.cwd, input.sessionId);
			pushRecentEvent(input.event, input.toolName ?? input.command ?? input.userPrompt ?? input.aiResponse ?? input.event);
			const result = await processHook(input);
			if (result.observation) {
				await storeObservation(result.observation, {
					cwd: input.cwd,
					sessionId: input.sessionId,
				});
				currentStatus.lastStoredObservation = {
					title: result.observation.title,
					type: result.observation.type,
					entityName: result.observation.entityName,
					at: new Date().toISOString(),
				};
				const last = currentStatus.recentEvents[0];
				if (last) last.stored = true;
			}
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			currentStatus.lastError = message;
			const last = currentStatus.recentEvents[0];
			if (last) last.skipped = "error";
			logger.error("[memcode] native hook failed:", message);
		}
	}

	return {
		async captureSessionStart(event, ctx) {
			markContext(ctx);
			pushRecentEvent("session_start", `reason=${event.reason}`);
		},

		async captureSessionBeforeCompact(event, ctx) {
			markContext(ctx);
			pushRecentEvent("session_before_compact", `entries=${event.branchEntries.length}`);
		},

		async captureSessionCompact(event, ctx) {
			markContext(ctx);
			pushRecentEvent("session_compact", `fromExtension=${event.fromExtension}`);
		},

		async captureSessionShutdown(event, ctx) {
			markContext(ctx);
			pushRecentEvent("session_shutdown", `reason=${event.reason}`);
		},

		async captureUserBash(event, ctx) {
			markContext(ctx);
			const command = event.command.trim();
			if (!command) return;
			await capture({
				...createBaseInput("post_command", ctx, {
					type: event.type,
					command,
					excludeFromContext: event.excludeFromContext,
				}),
				command,
			});
		},

		async captureUserPrompt(event, ctx) {
			markContext(ctx);
			const prompt = event.prompt.trim();
			if (!prompt) return;
			await capture({
				...createBaseInput("user_prompt", ctx, {
					type: event.type,
					prompt: event.prompt,
				}),
				userPrompt: prompt,
			});
		},

		async captureToolResult(event, ctx) {
			markContext(ctx);
			if (shouldSkipTool(event.toolName)) return;
			const toolResult = stringifyToolResult(event.content);
			const command = extractCommand(event.toolName, event.input);
			await capture({
				...createBaseInput("post_tool", ctx, {
					type: event.type,
					toolName: event.toolName,
					toolCallId: event.toolCallId,
					isError: event.isError,
				}),
				toolName: event.toolName,
				toolInput: event.input,
				toolResult,
				command,
			});
		},

		async captureAssistantMessage(event, ctx) {
			markContext(ctx);
			const aiResponse = extractAssistantText(event.message);
			if (!aiResponse) return;
			await capture({
				...createBaseInput("post_response", ctx, {
					type: event.type,
					role: event.message.role,
				}),
				aiResponse,
			});
		},

		async captureSessionEnd(event, ctx) {
			markContext(ctx);
			const aiResponse = event.messages.map(extractAssistantText).filter(Boolean).join("\n\n").trim();
			if (!aiResponse) return;
			await capture({
				...createBaseInput("session_end", ctx, {
					type: event.type,
					messageCount: event.messages.length,
				}),
				aiResponse,
			});
		},

		getStatus() {
			return getMemorixHookBridgeStatus();
		},
	};
}
