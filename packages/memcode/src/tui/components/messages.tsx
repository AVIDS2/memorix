/**
 * Message display components for the memcode TUI.
 *
 * Renders the conversation history: user messages, assistant responses
 * (with native markdown rendering), and memory attribution footers.
 */

import { useEffect, useRef, forwardRef, useImperativeHandle } from "react";
import { SyntaxStyle, createTextAttributes } from "@opentui/core";
import { theme } from "../theme.ts";

/** Shared syntax style for markdown code blocks (plain, no highlighting theme). */
const syntaxStyle = SyntaxStyle.create();

const DIM = createTextAttributes({ dim: true });

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

/** Scroll methods exposed by MessageList via ref. Used by the keymap for keyboard-driven scrolling. */
interface MessageListHandle {
	scrollDown: () => void;
	scrollUp: () => void;
	scrollToTop: () => void;
	scrollToBottom: () => void;
	pageDown: () => void;
	pageUp: () => void;
}

// ============================================================================
// MemoryAttribution
// ============================================================================

function MemoryAttribution({ sources }: { sources: MemorySource[] }) {
	if (sources.length === 0) return null;

	const totalCount = sources.reduce((sum, s) => sum + s.count, 0);
	const memoryLabel = totalCount === 1 ? "memory" : "memories";

	return (
		<box flexDirection="column" paddingLeft={1} paddingTop={1}>
			{/* Header row */}
			<text>
				<span fg={theme.textMuted} attributes={DIM}>
					{"  "}
					{totalCount} {memoryLabel} retrieved
				</span>
			</text>
			{/* Source badges row */}
			<box paddingTop={0}>
				<text>
					<span fg={theme.textMuted} attributes={DIM}>{"  "}</span>
					{sources.map((s, i) => (
						<span key={i}>
							{i > 0 && <span fg={theme.textMuted} attributes={DIM}> </span>}
							<span fg={s.scope === "project" ? theme.brand : theme.info}>
								{s.scope}:{s.name}
							</span>
							<span fg={s.scope === "project" ? theme.brandDim : theme.textMuted}>
								{"x" + s.count}
							</span>
						</span>
					))}
				</text>
			</box>
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

const SCROLL_STEP = 3;
const PAGE_STEP = 20;

const MessageList = forwardRef<MessageListHandle, MessageListProps>(
	function MessageList({ messages }, ref) {
		const scrollboxRef = useRef<any>(null);
		const scrollYRef = useRef(0);

		// Auto-scroll to bottom when new messages arrive
		useEffect(() => {
			if (scrollboxRef.current) {
				scrollboxRef.current.scrollTo({ y: scrollboxRef.current.scrollHeight });
				scrollYRef.current = scrollboxRef.current.scrollHeight;
			}
		}, [messages]);

		// Expose scroll methods to parent via ref
		useImperativeHandle(
			ref,
			() => ({
				scrollDown() {
					if (scrollboxRef.current) {
						scrollYRef.current += SCROLL_STEP;
						const maxY = scrollboxRef.current.scrollHeight ?? scrollYRef.current;
						scrollYRef.current = Math.min(scrollYRef.current, maxY);
						scrollboxRef.current.scrollTo({ y: scrollYRef.current });
					}
				},
				scrollUp() {
					if (scrollboxRef.current) {
						scrollYRef.current = Math.max(0, scrollYRef.current - SCROLL_STEP);
						scrollboxRef.current.scrollTo({ y: scrollYRef.current });
					}
				},
				scrollToTop() {
					if (scrollboxRef.current) {
						scrollYRef.current = 0;
						scrollboxRef.current.scrollTo({ y: 0 });
					}
				},
				scrollToBottom() {
					if (scrollboxRef.current) {
						const maxY = scrollboxRef.current.scrollHeight ?? 0;
						scrollYRef.current = maxY;
						scrollboxRef.current.scrollTo({ y: maxY });
					}
				},
				pageDown() {
					if (scrollboxRef.current) {
						scrollYRef.current += PAGE_STEP;
						const maxY = scrollboxRef.current.scrollHeight ?? scrollYRef.current;
						scrollYRef.current = Math.min(scrollYRef.current, maxY);
						scrollboxRef.current.scrollTo({ y: scrollYRef.current });
					}
				},
				pageUp() {
					if (scrollboxRef.current) {
						scrollYRef.current = Math.max(0, scrollYRef.current - PAGE_STEP);
						scrollboxRef.current.scrollTo({ y: scrollYRef.current });
					}
				},
			}),
			[],
		);

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
	},
);

// ============================================================================
// Exports
// ============================================================================

export { MessageList, UserMessage, AssistantMessage, MemoryAttribution };
export type { Message, MemorySource, MessageListProps, MessageListHandle, UserMessageProps, AssistantMessageProps };
