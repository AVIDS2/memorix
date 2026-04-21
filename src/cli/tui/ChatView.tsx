import React, { useRef, useEffect, useCallback, useImperativeHandle, forwardRef } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import { ScrollView, type ScrollViewRef } from 'ink-scroll-view';
import Spinner from 'ink-spinner';
import { COLORS, SEP, SYMBOLS, computeLayoutWidths } from './theme.js';
import type { ProjectInfo } from './data.js';
import type { ChatSource } from './chat-service.js';

export interface ChatTranscriptMessage {
  role: 'user' | 'assistant';
  content: string;
  sources?: ChatSource[];
  error?: boolean;
  timestamp?: string;
  meta?: {
    usedLLM?: boolean;
    searchMode?: string;
    llmModel?: string;
    warning?: string;
  };
}

interface ChatViewProps {
  project: ProjectInfo | null;
  messages: ChatTranscriptMessage[];
  loading: boolean;
  contentWidth?: number;
  viewportHeight?: number;
  threadId?: string;
  keyboardScrollEnabled?: boolean;
}

function separator(width: number): string {
  return SEP.thin.repeat(Math.max(12, Math.min(width, 72)));
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

/** Measure the display width of a string, counting CJK characters as 2 columns. */
function displayWidth(str: string): number {
  let w = 0;
  for (const ch of str) {
    const cp = ch.codePointAt(0)!;
    // CJK Unified Ideographs + CJK Extension + Katakana + Hangul + fullwidth forms
    if ((cp >= 0x4E00 && cp <= 0x9FFF) || (cp >= 0x3040 && cp <= 0x30FF) ||
        (cp >= 0xAC00 && cp <= 0xD7AF) || (cp >= 0xFF01 && cp <= 0xFF60) ||
        (cp >= 0x3400 && cp <= 0x4DBF)) {
      w += 2;
    } else {
      w += 1;
    }
  }
  return w;
}

/** Split text into lines respecting CJK double-width characters.
 *  Ink's wrap="wrap" doesn't understand CJK width, causing garbled text. */
function cjkAwareLines(text: string, maxCols: number): string[] {
  if (maxCols < 4) return [text];
  const lines: string[] = [];
  let line = '';
  let lineW = 0;
  for (const ch of text) {
    if (ch === '\n') {
      lines.push(line);
      line = '';
      lineW = 0;
      continue;
    }
    const cw = displayWidth(ch);
    if (lineW + cw > maxCols && line.length > 0) {
      lines.push(line);
      line = ch;
      lineW = cw;
    } else {
      line += ch;
      lineW += cw;
    }
  }
  if (line) lines.push(line);
  return lines.length > 0 ? lines : [''];
}

function MessageBlock({ message, width }: { message: ChatTranscriptMessage; width: number }): React.ReactElement {
  const heading = message.role === 'user' ? 'You' : 'Memorix';
  const headingColor = message.role === 'user'
    ? COLORS.brand
    : message.error
      ? COLORS.error
      : COLORS.assistant;

  return (
    <Box flexDirection="column" marginBottom={0}>
      <Box>
        <Text color={headingColor} bold wrap="truncate-end">{heading}</Text>
        {message.meta?.usedLLM && message.role === 'assistant' && (
          <Text color={COLORS.muted} wrap="truncate-end">  {SYMBOLS.pill(message.meta.llmModel || 'LLM')}</Text>
        )}
        {message.meta?.searchMode && message.role === 'assistant' && (
          <Text color={COLORS.textDim} wrap="truncate-end">{`  ${SYMBOLS.pill(message.meta.searchMode)}`}</Text>
        )}
      </Box>
      <Box flexDirection="column">
        {cjkAwareLines(message.content, Math.max(20, width - 4)).map((ln, i) => (
          <Text key={i} color={message.error ? COLORS.error : COLORS.text}>{ln}</Text>
        ))}
      </Box>
      {message.meta?.warning && !message.error && (
        <Text color={COLORS.warning} wrap="truncate-end">{message.meta.warning}</Text>
      )}
      {message.sources && message.sources.length > 0 && (
        <Box flexDirection="column">
          <Text color={COLORS.muted} wrap="truncate-end">Sources</Text>
          {message.sources.slice(0, 3).map((source) => (
            <Text key={source.id} color={COLORS.textDim} wrap="truncate-end">
              {`  [obs:${source.id}] ${truncate(source.title, Math.max(20, width - 16))}`}
            </Text>
          ))}
        </Box>
      )}
    </Box>
  );
}

export interface ChatViewRef {
  scrollBy: (offset: number) => void;
}

export const ChatView = forwardRef<ChatViewRef, ChatViewProps>(function ChatView(
  { project, messages, loading, contentWidth: _contentWidth, viewportHeight, threadId, keyboardScrollEnabled = true },
  ref,
): React.ReactElement {
  const scrollRef = useRef<ScrollViewRef>(null);
  const { stdout } = useStdout();

  // Compute responsive content width from terminal size (shared with App.tsx)
  const termWidth = stdout?.columns || 80;
  const { contentWidth } = computeLayoutWidths(termWidth);

  // Expose scrollBy to parent for centralized mouse handling
  useImperativeHandle(ref, () => ({
    scrollBy: (offset: number) => scrollRef.current?.scrollBy(offset),
  }), []);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (scrollRef.current && messages.length > 0) {
      // Small delay to let ink-scroll-view measure new content
      const timer = setTimeout(() => {
        scrollRef.current?.remeasure();
        // Scroll to bottom: use getBottomOffset
        const bottom = scrollRef.current?.getBottomOffset?.() ?? 0;
        if (bottom > 0) {
          scrollRef.current?.scrollTo?.(bottom);
        }
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [messages.length, loading]);

  // Handle terminal resize
  useEffect(() => {
    const handleResize = () => scrollRef.current?.remeasure();
    stdout?.on('resize', handleResize);
    return () => { stdout?.off('resize', handleResize); };
  }, [stdout]);

  // Capture up/down keys for scrolling when in chat view
  useInput(useCallback((_ch: string, key: any) => {
    if (!scrollRef.current) return;
    if (key.upArrow) {
      scrollRef.current.scrollBy(-3);
    } else if (key.downArrow) {
      scrollRef.current.scrollBy(3);
    } else if (key.pageUp) {
      const vh = scrollRef.current.getViewportHeight?.() ?? 10;
      scrollRef.current.scrollBy(-(vh - 2));
    } else if (key.pageDown) {
      const vh = scrollRef.current.getViewportHeight?.() ?? 10;
      scrollRef.current.scrollBy(vh - 2);
    }
  }, []), { isActive: keyboardScrollEnabled });

  // Reserve 2 rows for header ("Conversation" + separator), 1 for loading
  const headerRows = 2;
  const loadingRows = loading ? 1 : 0;
  const scrollHeight = viewportHeight ? Math.max(4, viewportHeight - headerRows - loadingRows) : 20;

  const threadLabel = threadId && threadId !== 'default' ? ` (${threadId})` : '';

  if (messages.length === 0) {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text color={COLORS.brand} bold>Memory Chat{threadLabel}</Text>
        <Text color={COLORS.border}>{separator(contentWidth - 4)}</Text>
        <Text color={COLORS.text}>Ask Memorix about project decisions, bugs, rationale, or recent changes.</Text>
        <Text color={COLORS.textDim}>{project ? `Project: ${project.name}` : 'Open inside a git project to query its memory graph.'}</Text>
        <Box marginTop={1} flexDirection="column">
          <Text color={COLORS.muted}>Try asking</Text>
          <Text color={COLORS.textDim}>  {SYMBOLS.arrow} Why did we choose this architecture?</Text>
          <Text color={COLORS.textDim}>  {SYMBOLS.arrow} What changed in auth recently?</Text>
          <Text color={COLORS.textDim}>  {SYMBOLS.arrow} Summarize known issues around embeddings</Text>
          <Text color={COLORS.textDim}>  {SYMBOLS.arrow} /search timeout bug</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text color={COLORS.brand} bold>Conversation{threadLabel}</Text>
      <Text color={COLORS.border}>{separator(contentWidth - 4)}</Text>
      <Box height={scrollHeight} flexDirection="column">
        <ScrollView ref={scrollRef}>
          {messages.map((message, index) => (
            <MessageBlock
              key={`${message.role}-${index}-${message.timestamp || index}`}
              message={message}
              width={contentWidth}
            />
          ))}
          {loading && (
            <Box>
              <Text color={COLORS.brand}><Spinner type="dots" />{' '}Thinking…</Text>
            </Box>
          )}
        </ScrollView>
      </Box>
    </Box>
  );
});
