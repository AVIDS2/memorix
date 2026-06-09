/**
 * Memcode TUI root App component.
 *
 * Composes Header, MessageList, StatusBar, and InputBar into the main
 * terminal UI layout. Wires up user input to a mock agent runtime that
 * echoes messages back until the real agent is integrated.
 */

import { useState, useCallback } from "react";
import type { AgentSessionRuntime } from "../core/agent-session-runtime.ts";
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
	/** Agent runtime handle providing cwd, session info, and future agent calls. */
	runtime: AgentSessionRuntime;
}

// ---------------------------------------------------------------------------
// Mock agent response
// ---------------------------------------------------------------------------

/**
 * Simulates an agent response after a short delay.
 * Returns an echo of the user's message wrapped in markdown, so the TUI
 * is fully functional for layout and interaction testing.
 */
function mockAgentResponse(userText: string): Promise<string> {
	return new Promise((resolve) => {
		setTimeout(() => {
			resolve(
				`> ${userText}\n\nI received your message. The real agent runtime is not yet connected — this is a mock response.`,
			);
		}, 600);
	});
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

function App({ runtime }: AppProps) {
	// Derive stable values from the runtime
	const cwd = runtime.cwd;
	const sessionId = runtime.session.sessionId ?? runtime.session.sessionFile ?? "local";

	// --- State (signals) ---
	const [messages, setMessages] = useState<Message[]>([]);
	const [status, setStatus] = useState("");
	const [memoryCount] = useState(0);

	// --- Handlers ---

	const handleSend = useCallback(
		async (text: string) => {
			// 1. Append user message
			setMessages((prev) => [...prev, { role: "user", content: text }]);

			// 2. Show thinking status
			setStatus("thinking...");

			// 3. Get agent response (mock for now — replace with runtime call later)
			const reply = await mockAgentResponse(text);

			// 4. Append assistant message and clear status
			setMessages((prev) => [
				...prev,
				{ role: "assistant", content: reply },
			]);
			setStatus("");
		},
		[],
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

			<StatusBar status={status} />

			<InputBar onSend={handleSend} />
		</box>
	);
}

export { App };
export type { AppProps };
