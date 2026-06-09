/**
 * Memcode TUI root App component.
 *
 * Composes Header, MessageList, StatusBar, and InputBar into the main
 * terminal UI layout. Wires up to the real agent runtime for message
 * sending, event streaming, and status updates.
 */

import { useState, useCallback, useEffect } from "react";
import type { AgentSessionRuntime } from "../core/agent-session-runtime.ts";
import type { AgentSessionEvent } from "../core/agent-session.ts";
import { theme } from "./theme.ts";
import { Header } from "./components/header.tsx";
import { InputBar } from "./components/inputbar.tsx";
import { MessageList } from "./components/messages.tsx";
import { StatusBar } from "./components/statusbar.tsx";
import type { Message } from "./components/messages.tsx";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AppProps {
	/** Agent runtime handle providing cwd, session info, and agent calls. */
	runtime: AgentSessionRuntime;
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
							setMessages((prev) => [
								...prev,
								{ role: "assistant", content },
							]);
						}
						setStreamingContent("");
						setStatus("");
					}
					break;

				case "tool_execution_start":
					setStatus(`Using ${event.toolName}...`);
					break;

				case "tool_execution_end":
					setStatus("");
					break;

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

			// 1. Append user message immediately
			setMessages((prev) => [...prev, { role: "user", content: text }]);

			// 2. Show thinking status
			setStatus("Sending...");

			// 3. Send to real agent runtime
			try {
				await runtime.session.prompt(text);
			} catch (err) {
				setStatus("");
				setMessages((prev) => [
					...prev,
					{ role: "assistant", content: `Error: ${err instanceof Error ? err.message : String(err)}` },
				]);
			}
		},
		[runtime],
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

			<MessageList messages={messages} />

			{streamingContent && (
				<box paddingLeft={2}>
					<text fg={theme.textPrimary}>{streamingContent}</text>
				</box>
			)}

			<StatusBar status={status} />

			<InputBar onSend={handleSend} />
		</box>
	);
}

export { App };
export type { AppProps };
