/**
 * Memcode TUI root App component.
 *
 * Composes Header, MessageList, StatusBar, and InputBar into the main
 * terminal UI layout. Wires up to the real agent runtime for message
 * sending, event streaming, and status updates.
 *
 * Integrates git context auto-injection: when the working tree has dirty
 * files, a compact diff summary is prepended to user messages so the LLM
 * has current code context without explicit /git commands.
 */

import { useState, useCallback, useEffect, useRef } from "react";
import type { AgentSessionRuntime } from "../core/agent-session-runtime.ts";
import type { AgentSessionEvent } from "../core/agent-session.ts";
import { theme } from "./theme.ts";
import { Header } from "./components/header.tsx";
import { InputBar } from "./components/inputbar.tsx";
import { MessageList } from "./components/messages.tsx";
import type { MessageListHandle } from "./components/messages.tsx";
import { StatusBar } from "./components/statusbar.tsx";
import type { Message, MemorySource } from "./components/messages.tsx";
import {
	getGitDiffContext,
	createGitCommandHandlers,
} from "./integrations/git.ts";
import { useKeymap } from "./keymap.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AppProps {
	/** Agent runtime handle providing cwd, session info, and agent calls. */
	runtime: AgentSessionRuntime;
}

// ---------------------------------------------------------------------------
// Memory attribution extraction
// ---------------------------------------------------------------------------

/**
 * Extract MemorySource entries from a memorix_search tool result.
 *
 * The tool_execution_end event carries `result.details` which contains
 * { entryCount, totalTokens } (the full entries array is not passed through).
 * We use entryCount to build attribution sources.
 */
function extractMemorySources(details: any): MemorySource[] {
	if (!details || details.error) return [];

	const entryCount = details.entryCount ?? 0;
	if (entryCount === 0) return [];

	// All project-scoped memories (global detection TBD)
	return [{ scope: "project", name: "memory", count: entryCount }];
}

// ---------------------------------------------------------------------------
// Git context cache
// ---------------------------------------------------------------------------

/** Cached git-diff context to avoid re-running git on every message. */
let gitContextCache: { context: string; ts: number } | null = null;
const GIT_CONTEXT_TTL_MS = 10_000; // re-check every 10 seconds

async function getCachedGitDiffContext(cwd: string): Promise<string> {
	const now = Date.now();
	if (gitContextCache && now - gitContextCache.ts < GIT_CONTEXT_TTL_MS) {
		return gitContextCache.context;
	}
	const context = await getGitDiffContext(cwd);
	gitContextCache = { context, ts: now };
	return context;
}

/** Invalidate the git context cache (e.g. after a commit). */
function invalidateGitContextCache(): void {
	gitContextCache = null;
}

// ---------------------------------------------------------------------------
// /git command detection
// ---------------------------------------------------------------------------

/** Check if text matches a /git subcommand. Returns the subcommand or null. */
function parseGitCommand(text: string): { sub: string; arg: string } | null {
	const trimmed = text.trim();
	if (!trimmed.startsWith("/git")) return null;

	const rest = trimmed.slice(4).trim();
	const spaceIdx = rest.indexOf(" ");
	if (spaceIdx === -1) {
		return { sub: rest, arg: "" };
	}
	return { sub: rest.slice(0, spaceIdx), arg: rest.slice(spaceIdx + 1).trim() };
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

function App({ runtime }: AppProps) {
	// Derive stable values from the runtime
	const cwd = runtime.cwd;
	const sessionId = runtime.session.sessionId ?? runtime.session.sessionFile ?? "local";

	// --- State ---
	const [messages, setMessages] = useState<Message[]>([]);
	const [status, setStatus] = useState("");
	const [memoryCount] = useState(0);
	const [streamingContent, setStreamingContent] = useState("");
	const pendingAttributionRef = useRef<MemorySource[]>([]);

	// --- Git command handlers ---
	const addMessage = useCallback((role: "assistant", content: string) => {
		setMessages((prev) => [...prev, { role, content }]);
	}, []);

	const sendMessage = useCallback(async (text: string) => {
		await runtime.session.prompt(text);
	}, [runtime]);

	const gitHandlers = useRef(createGitCommandHandlers(cwd, addMessage, sendMessage));
	// Update handlers when addMessage/sendMessage identity changes
	useEffect(() => {
		gitHandlers.current = createGitCommandHandlers(cwd, addMessage, sendMessage);
	}, [addMessage, sendMessage, cwd]);

	// --- Message list scroll ref (for vim-mode keyboard scrolling) ---

	const messageListRef = useRef<MessageListHandle>(null);

	// --- Help overlay state ---

	const [showHelp, setShowHelp] = useState(false);

	// --- Keyboard shortcuts & vim mode ---

	const keymap = useKeymap({
		onInterrupt: useCallback(() => {
			// TODO: wire to agent runtime interrupt when available
			setStatus("Interrupted");
			setStreamingContent("");
			setTimeout(() => setStatus(""), 2000);
		}, []),

		onExit: useCallback(() => {
			// TODO: show confirm dialog; for now, exit directly
			process.exit(0);
		}, []),

		onHelp: useCallback(() => {
			// Returns true if help was open and got closed (for Esc priority)
			let wasOpen = false;
			setShowHelp((prev) => {
				wasOpen = prev;
				return !prev;
			});
			return wasOpen;
		}, []),

		onPromote: useCallback(async () => {
			// Promote the last assistant message to a stored memory
			try {
				const mod = await import("./commands/memory-commands.ts");
				const promoteHandler = mod.MEMORY_COMMANDS.promote;
				if (promoteHandler) {
					const result = await promoteHandler("", {
						cwd,
						runtime,
						toast: (msg: string) => setStatus(msg),
						addMessage: (msg: string) =>
							setMessages((prev) => [
								...prev,
								{ role: "assistant", content: msg },
							]),
					});
					if (result.toast) {
						setStatus(result.toast.msg);
						setTimeout(() => setStatus(""), 3000);
					}
				}
			} catch (err) {
				setStatus(`Promote failed: ${err instanceof Error ? err.message : String(err)}`);
				setTimeout(() => setStatus(""), 3000);
			}
		}, [cwd, runtime]),

		scroll: {
			scrollDown: useCallback(() => {
				messageListRef.current?.scrollDown();
			}, []),
			scrollUp: useCallback(() => {
				messageListRef.current?.scrollUp();
			}, []),
			scrollToTop: useCallback(() => {
				messageListRef.current?.scrollToTop();
			}, []),
			scrollToBottom: useCallback(() => {
				messageListRef.current?.scrollToBottom();
			}, []),
			pageDown: useCallback(() => {
				messageListRef.current?.pageDown();
			}, []),
			pageUp: useCallback(() => {
				messageListRef.current?.pageUp();
			}, []),
		},
	});

	// --- Subscribe to agent events ---
	useEffect(() => {
		const unsubscribe = runtime.session.subscribe((event: AgentSessionEvent) => {
			switch (event.type) {
				case "message_start":
					if (event.message.role === "assistant") {
						setStatus("Thinking...");
						setStreamingContent("");
					}
					break;

				case "message_update":
					if (event.message.role === "assistant") {
						// Extract text content from streaming message
						const textParts = event.message.content
							.filter((c: any) => c.type === "text")
							.map((c: any) => c.text);
						setStreamingContent(textParts.join(""));
					}
					break;

				case "message_end":
					if (event.message.role === "assistant") {
						// Finalize assistant message
						const textParts = event.message.content
							.filter((c: any) => c.type === "text")
							.map((c: any) => c.text);
						const content = textParts.join("") || streamingContent;
						if (content) {
							const attribution = pendingAttributionRef.current.length > 0
								? pendingAttributionRef.current
								: undefined;
							setMessages((prev) => [
								...prev,
								{ role: "assistant", content, attribution },
							]);
						}
						pendingAttributionRef.current = [];
						setStreamingContent("");
						setStatus("");
					}
					break;

				case "tool_execution_start":
					setStatus(`Using ${event.toolName}...`);
					break;

				case "tool_execution_end": {
					// Track memorix_search results for attribution
					if (event.toolName === "memorix_search" && !event.isError && event.result) {
						const newSources = extractMemorySources(event.result.details);
						if (newSources.length > 0) {
							pendingAttributionRef.current.push(...newSources);
						}
					}
					setStatus("");
					break;
				}

				case "turn_end":
					setStatus("");
					break;

				case "agent_end":
					setStatus("");
					setStreamingContent("");
					break;
			}
		});

		return unsubscribe;
	}, [runtime]);

	// --- Handlers ---

	const handleSend = useCallback(
		async (text: string) => {
			if (!text.trim()) return;

			// 1. Handle /git commands locally
			const gitCmd = parseGitCommand(text);
			if (gitCmd) {
				const fullKey = `git ${gitCmd.sub}` as keyof typeof gitHandlers.current;
				const handler = gitHandlers.current[fullKey];
				if (handler) {
					setMessages((prev) => [...prev, { role: "user", content: text }]);
					setStatus("Running git...");
					try {
						const result = await handler(gitCmd.arg || undefined);
						setMessages((prev) => [...prev, { role: "assistant", content: result }]);
						// Invalidate context cache after any git operation
						invalidateGitContextCache();
					} catch (err) {
						setMessages((prev) => [
							...prev,
							{ role: "assistant", content: `Error: ${err instanceof Error ? err.message : String(err)}` },
						]);
					}
					setStatus("");
					return;
				}
				// Unknown /git subcommand — fall through to LLM
			}

			// 2. Auto-inject git diff context if working tree is dirty
			let promptText = text;
			if (!text.startsWith("/")) {
				try {
					const gitContext = await getCachedGitDiffContext(cwd);
					if (gitContext) {
						promptText = `${gitContext}\n\n${text}`;
					}
				} catch {
					// Git context injection failure is non-fatal; send without it
				}
			}

			// 3. Append user message immediately (show original text to user)
			setMessages((prev) => [...prev, { role: "user", content: text }]);

			// 4. Show thinking status
			setStatus("Sending...");

			// 5. Send to real agent runtime (with git context if injected)
			try {
				await runtime.session.prompt(promptText);
			} catch (err) {
				setStatus("");
				setMessages((prev) => [
					...prev,
					{ role: "assistant", content: `Error: ${err instanceof Error ? err.message : String(err)}` },
				]);
			}
		},
		[runtime, cwd],
	);

	// --- Render ---

	return (
		<box
			width="100%"
			height="100%"
			backgroundColor={theme.bgBase}
			border
			borderColor={theme.bgBorder}
			title="memcode"
			titleColor={theme.brand}
			flexDirection="column"
		>
			<Header
				cwd={cwd}
				memoryCount={memoryCount}
				sessionId={sessionId}
			/>

			<MessageList ref={messageListRef} messages={messages} />

			{streamingContent && (
				<box paddingLeft={2}>
					<text fg={theme.textPrimary}>{streamingContent}</text>
				</box>
			)}

			<StatusBar status={status} vimMode={keymap.vimMode} cmdLineBuffer={keymap.cmdLineBuffer} />

			<InputBar
				onSend={handleSend}
				vimMode={keymap.vimMode}
				onSwitchToNormal={() => keymap.setVimMode("NORMAL")}
			/>

			{/* ── Help overlay ── */}
			{showHelp ? (
				<box
					position="absolute"
					top={0}
					left={0}
					width="100%"
					height="100%"
					flexDirection="column"
					alignItems="center"
					justifyContent="center"
					zIndex={100}
				>
					{/* Backdrop */}
					<box
						position="absolute"
						top={0}
						left={0}
						width="100%"
						height="100%"
						backgroundColor={theme.bgBase}
						opacity={0.7}
					/>
					{/* Help content */}
					<box
						width={52}
						flexDirection="column"
						border
						borderColor={theme.brand}
						backgroundColor={theme.bgElevated}
						paddingLeft={1}
						paddingRight={1}
					>
						<text fg={theme.brand}>{"Keyboard Shortcuts"}</text>
						<text fg={theme.textMuted}>{"─".repeat(48)}</text>
						<text fg={theme.textPrimary}>{"Global:"}</text>
						<text fg={theme.textSecondary}>{"  Esc ......... vim NORMAL / interrupt"}</text>
						<text fg={theme.textSecondary}>{"  Ctrl+C ...... exit (confirm)"}</text>
						<text fg={theme.textSecondary}>{"  ? ........... toggle this help"}</text>
						<text fg={theme.textPrimary}>{"Chat (NORMAL mode):"}</text>
						<text fg={theme.textSecondary}>{"  j/k ......... scroll down/up"}</text>
						<text fg={theme.textSecondary}>{"  gg .......... scroll to top"}</text>
						<text fg={theme.textSecondary}>{"  G ........... scroll to bottom"}</text>
						<text fg={theme.textSecondary}>{"  PgUp/PgDn ... page scroll"}</text>
						<text fg={theme.textPrimary}>{"Tool calls:"}</text>
						<text fg={theme.textSecondary}>{"  Space/Tab ... expand/collapse"}</text>
						<text fg={theme.textSecondary}>{"  n/N ......... next/prev tool call"}</text>
						<text fg={theme.textPrimary}>{"Memory:"}</text>
						<text fg={theme.textSecondary}>{"  p ........... promote last response"}</text>
						<text fg={theme.textPrimary}>{"Vim mode:"}</text>
						<text fg={theme.textSecondary}>{"  /vim ........ toggle vim mode"}</text>
						<text fg={theme.textSecondary}>{"  i ........... INSERT mode"}</text>
						<text fg={theme.textSecondary}>{"  Esc ......... NORMAL mode"}</text>
						<text fg={theme.textMuted}>{"─".repeat(48)}</text>
						<text fg={theme.textMuted}>{"Press ? or Esc to close"}</text>
					</box>
				</box>
			) : null}
		</box>
	);
}

export { App };
export type { AppProps };
