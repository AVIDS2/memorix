/**
 * Memcode TUI — opencode-style two-route layout.
 *
 * Home: centered logo + input (welcome page)
 * Session: scrollbox messages + fixed input at bottom (conversation view)
 * Auto-transitions from Home to Session on first message send.
 */

import { useState, useCallback, useEffect, useRef } from "react";
import type { AgentSessionRuntime } from "../core/agent-session-runtime.ts";
import type { AgentSessionEvent } from "../core/agent-session.ts";
import { theme } from "./theme.ts";
import { InputBar } from "./components/inputbar.tsx";
import type { Message, MemorySource } from "./components/messages.tsx";
import { useKeymap } from "./keymap.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AppProps {
	runtime: AgentSessionRuntime;
}

function parseGitCommand(text: string): { sub: string; arg: string } | null {
	const trimmed = text.trim();
	if (!trimmed.startsWith("/git")) return null;
	const rest = trimmed.slice(4).trim();
	const spaceIdx = rest.indexOf(" ");
	if (spaceIdx === -1) return { sub: rest, arg: "" };
	return { sub: rest.slice(0, spaceIdx), arg: rest.slice(spaceIdx + 1).trim() };
}

// ---------------------------------------------------------------------------
// Message component (inline for simplicity)
// ---------------------------------------------------------------------------

function MessageItem({ msg }: { msg: Message }) {
	return (
		<box flexDirection="column" marginBottom={1} paddingLeft={2} paddingRight={2}>
			<text fg={msg.role === "user" ? theme.brand : theme.textSecondary}>
				{msg.role === "user" ? "You" : "memcode"}
			</text>
			<box
				border={["left"]}
				borderColor={theme.borderSubtle}
				paddingLeft={1}
				marginTop={0}
			>
				<text fg={theme.textPrimary} >{msg.content}</text>
			</box>
		</box>
	);
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

function App({ runtime }: AppProps) {
	const cwd = runtime.cwd;
	const sessionId = (runtime.session.sessionId ?? runtime.session.sessionFile ?? "local").slice(-6);
	const modelName = runtime.session.model?.name ?? runtime.session.model?.id ?? "unknown";
	const thinkingLevel = runtime.session.thinkingLevel ?? "off";

	// --- State ---
	const [view, setView] = useState<"home" | "session">("home");
	const [messages, setMessages] = useState<Message[]>([]);
	const [status, setStatus] = useState("");
	const [streamingContent, setStreamingContent] = useState("");
	const [showHelp, setShowHelp] = useState(false);
	const scrollRef = useRef<any>(null);
	const pendingAttributionRef = useRef<MemorySource[]>([]);

	// --- Keyboard shortcuts ---
	const keymap = useKeymap({
		onInterrupt: useCallback(() => {
			setStatus("Interrupted");
			setStreamingContent("");
			setTimeout(() => setStatus(""), 1500);
		}, []),
		onExit: useCallback(() => { process.exit(0); }, []),
		onHelp: useCallback(() => {
			let wasOpen = false;
			setShowHelp((prev) => { wasOpen = prev; return !prev; });
			return wasOpen;
		}, []),
		onPromote: useCallback(async () => {
			try {
				const mod = await import("./commands/memory-commands.ts");
				const promoteHandler = mod.MEMORY_COMMANDS.promote;
				if (promoteHandler) {
					const result = await promoteHandler("", {
						cwd, runtime,
						toast: (msg: string) => setStatus(msg),
						addMessage: (msg: string) => setMessages((prev) => [...prev, { role: "assistant", content: msg }]),
					});
					if (result.toast) {
						setStatus(result.toast.msg);
						setTimeout(() => setStatus(""), 2000);
					}
				}
			} catch (err) {
				setStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
				setTimeout(() => setStatus(""), 2000);
			}
		}, [cwd, runtime]),
		scroll: {
			scrollDown: useCallback(() => {}, []),
			scrollUp: useCallback(() => {}, []),
			scrollToTop: useCallback(() => {}, []),
			scrollToBottom: useCallback(() => {}, []),
			pageDown: useCallback(() => {}, []),
			pageUp: useCallback(() => {}, []),
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
						const textParts = event.message.content
							.filter((c: any) => c.type === "text")
							.map((c: any) => c.text);
						setStreamingContent(textParts.join(""));
					}
					break;
				case "message_end":
					if (event.message.role === "assistant") {
						const textParts = event.message.content
							.filter((c: any) => c.type === "text")
							.map((c: any) => c.text);
						const content = textParts.join("") || streamingContent;
						if (content) {
							const attribution = pendingAttributionRef.current.length > 0
								? pendingAttributionRef.current : undefined;
							setMessages((prev) => [...prev, { role: "assistant", content, attribution }]);
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
					setStatus("");
					break;
				}
				case "turn_end":
				case "agent_end":
					setStatus("");
					setStreamingContent("");
					break;
			}
		});
		return unsubscribe;
	}, [runtime]);

	// --- Send handler ---
	const handleSend = useCallback(async (text: string) => {
		if (!text.trim()) return;

		// Switch to session view on first message
		if (view === "home") {
			setView("session");
		}

		// Append user message
		setMessages((prev) => [...prev, { role: "user", content: text }]);
		setStatus("Sending...");

		try {
			await runtime.session.prompt(text);
		} catch (err) {
			setStatus("");
			setMessages((prev) => [...prev, { role: "assistant", content: `Error: ${err instanceof Error ? err.message : String(err)}` }]);
		}
	}, [runtime, view]);

	// --- RENDER: HOME VIEW ---
	if (view === "home") {
		return (
			<box width="100%" height="100%" backgroundColor={theme.bgBase} flexDirection="column" alignItems="center">
				{/* Spacer to center vertically */}
				<box flexGrow={1} />
				<box height={4} flexShrink={0} />

				{/* Logo */}
				<box flexDirection="column" alignItems="center" flexShrink={0}>
					<text fg={theme.brand}>{"◆ MEMCODE"}</text>
					<text fg={theme.textMuted}>{"v1.0.10"}</text>
				</box>

				{/* Spacer */}
				<box height={1} flexShrink={0} />

				{/* Input box — centered */}
				<box width="75%" maxWidth={90} flexShrink={0}>
					<InputBar
						onSend={handleSend}
						vimMode={keymap.vimMode}
						onSwitchToNormal={() => keymap.setVimMode("NORMAL")}
					/>
				</box>

				{/* Footer */}
				<box height={1} flexDirection="row" justifyContent="space-between" paddingLeft={2} paddingRight={2} flexShrink={0}>
					<text fg={theme.textMuted}>{`${modelName} · ${thinkingLevel}`}</text>
					<text fg={theme.textMuted}>{"esc  ctrl+c  ? help"}</text>
				</box>
			</box>
		);
	}

	// --- RENDER: SESSION VIEW ---
	return (
		<box width="100%" height="100%" backgroundColor={theme.bgBase} flexDirection="column">
			{/* Messages scrollbox — takes remaining space */}
			<box flexGrow={1} flexDirection="column" paddingTop={1} paddingBottom={1} paddingLeft={1} paddingRight={1}>
				{/* Project info line at top */}
				<box flexDirection="row" justifyContent="center" marginBottom={1}>
					<text fg={theme.textMuted}>
						{`project: ${cwd.split(/[\\/]/).pop()} · session: ${sessionId}`}
					</text>
				</box>

				{/* Messages */}
				{messages.map((msg, i) => (
					<MessageItem key={i} msg={msg} />
				))}

				{/* Streaming content */}
				{streamingContent ? (
					<box flexDirection="column" paddingLeft={2} paddingRight={2}>
						<text fg={theme.textSecondary}>{"memcode"}</text>
						<box border={["left"]} borderColor={theme.borderSubtle} paddingLeft={1}>
							<text fg={theme.textPrimary} >{streamingContent.slice(0, 2000)}</text>
						</box>
					</box>
				) : null}

				{/* Status */}
				{status ? (
					<box flexDirection="row" justifyContent="center" marginTop={1}>
						<text fg={theme.textSecondary}>{status}</text>
					</box>
				) : null}
			</box>

			{/* Input bar — fixed at bottom */}
			<box flexShrink={0} paddingLeft={1} paddingRight={1} paddingBottom={1}>
				<InputBar
					onSend={handleSend}
					vimMode={keymap.vimMode}
					onSwitchToNormal={() => keymap.setVimMode("NORMAL")}
				/>
			</box>

			{/* Footer — fixed at very bottom */}
			<box height={1} flexDirection="row" justifyContent="space-between" paddingLeft={2} paddingRight={2}>
				<text fg={theme.textMuted}>{`${modelName} · ${thinkingLevel}`}</text>
				<text fg={theme.textMuted}>{"esc  ctrl+c  ? help"}</text>
			</box>

			{/* Help overlay */}
			{showHelp ? (
				<box position="absolute" top={0} left={0} width="100%" height="100%" flexDirection="column" alignItems="center" justifyContent="center" zIndex={100}>
					<box position="absolute" top={0} left={0} width="100%" height="100%" backgroundColor={theme.bgBase} opacity={0.8} />
					<box width={50} flexDirection="column" border borderColor={theme.borderSubtle} backgroundColor={theme.bgSurface} paddingLeft={1} paddingRight={1}>
						<text fg={theme.brand}>{"Keyboard Shortcuts"}</text>
						<text fg={theme.textMuted}>{"────────────────────────────────"}</text>
						<text fg={theme.textSecondary}>{"  Esc ........ interrupt / vim NORMAL"}</text>
						<text fg={theme.textSecondary}>{"  Ctrl+C ..... exit"}</text>
						<text fg={theme.textSecondary}>{"  ? .......... toggle help"}</text>
						<text fg={theme.textSecondary}>{"  j/k ........ scroll down/up"}</text>
						<text fg={theme.textSecondary}>{"  gg/G ....... top/bottom"}</text>
						<text fg={theme.textSecondary}>{"  p .......... promote to memory"}</text>
						<text fg={theme.textMuted}>{"────────────────────────────────"}</text>
						<text fg={theme.textMuted}>{"Press ? or Esc to close"}</text>
					</box>
				</box>
			) : null}
		</box>
	);
}

export { App };
export type { AppProps };
