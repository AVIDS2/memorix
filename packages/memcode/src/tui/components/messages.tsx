/**
 * Message display components for the memcode TUI.
 *
 * Renders the conversation history: user messages, assistant responses
 * (with native markdown rendering), and memory attribution footers.
 */

import { useEffect, useRef } from "react";
import { SyntaxStyle } from "@opentui/core";
import { theme } from "../theme.ts";

/** Shared syntax style for markdown code blocks (plain, no highlighting theme). */
const syntaxStyle = SyntaxStyle.create();

// ============================================================================
// Types
// ============================================================================

interface MemorySource {
	scope: "project" | "global";
	name: string;
	count: number;
}

interface UserMessageProps {
	content: string;
	attachments?: string[];
}

interface AssistantMessageProps {
	content: string;
	attribution?: MemorySource[];
}

interface Message {
	role: "user" | "assistant";
	content: string;
	attachments?: string[];
	attribution?: MemorySource[];
}

interface MessageListProps {
	messages: Message[];
}

// ============================================================================
// MemoryAttribution
// ============================================================================

function MemoryAttribution({ sources }: { sources: MemorySource[] }) {
	if (sources.length === 0) return null;

	const label = sources.map((s) => `${s.scope}:${s.name}×${s.count}`).join("  ");

	return (
		<box paddingLeft={1} paddingTop={1}>
			<text>
				<span fg={theme.textMuted}>{"retrieved: "}</span>
				<span fg={theme.memHit}>{label}</span>
			</text>
		</box>
	);
}

// ============================================================================
// UserMessage
// ============================================================================

function UserMessage({ content, attachments }: UserMessageProps) {
	return (
		<box paddingLeft={1} paddingRight={1} paddingTop={1} paddingBottom={1}>
			<box flexDirection="column">
				<text>
					<b fg={theme.brand}>{"You"}</b>
				</text>
				<text fg={theme.textPrimary}>{content}</text>
				{attachments && attachments.length > 0 && (
					<box paddingTop={1}>
						<text fg={theme.textMuted}>{attachments.join(", ")}</text>
					</box>
				)}
			</box>
		</box>
	);
}

// ============================================================================
// AssistantMessage
// ============================================================================

function AssistantMessage({ content, attribution }: AssistantMessageProps) {
	return (
		<box paddingLeft={1} paddingRight={1} paddingTop={1} paddingBottom={1}>
			<box flexDirection="column">
				<text>
					<b fg={theme.textMuted}>{"memcode"}</b>
				</text>
				<markdown content={content} syntaxStyle={syntaxStyle} fg={theme.textPrimary} />
				{attribution && attribution.length > 0 && <MemoryAttribution sources={attribution} />}
			</box>
		</box>
	);
}

// ============================================================================
// MessageList
// ============================================================================

function MessageList({ messages }: MessageListProps) {
	const scrollboxRef = useRef<any>(null);

	useEffect(() => {
		if (scrollboxRef.current) {
			scrollboxRef.current.scrollTo({ y: scrollboxRef.current.scrollHeight });
		}
	}, [messages]);

	return (
		<scrollbox
			ref={scrollboxRef}
			flexGrow={1}
			stickyScroll
			stickyStart="bottom"
			paddingBottom={6}
		>
			{messages.map((msg, i) =>
				msg.role === "user" ? (
					<UserMessage
						key={i}
						content={msg.content}
						attachments={msg.attachments}
					/>
				) : (
					<AssistantMessage
						key={i}
						content={msg.content}
						attribution={msg.attribution}
					/>
				),
			)}
		</scrollbox>
	);
}

// ============================================================================
// Exports
// ============================================================================

export { MessageList, UserMessage, AssistantMessage, MemoryAttribution };
export type { Message, MemorySource, MessageListProps, UserMessageProps, AssistantMessageProps };
