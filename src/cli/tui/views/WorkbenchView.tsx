/**
 * WorkbenchView — Session center with context assembly and chat.
 *
 * Session: read-only status on render. Explicit Bind/End via user action.
 * Context: lists knowledge items, memory search results, session handoff
 *   that form the current workbench context.
 * Chat: inline chat interface powered by chat-service.ts.
 *
 * Deliberately excluded: no auto session_start, no placeholder agent harness
 * buttons, no file/shell access.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Box, Text, useInput } from 'ink';
import { COLORS, SEP, SYMBOLS, STATUS_DOTS } from '../theme.js';
import { ChatView } from '../ChatView.js';
import type { ChatTranscriptMessage, ChatViewRef } from '../ChatView.js';
import { askMemoryQuestionStream } from '../chat-service.js';
import type { ChatAnswer } from '../chat-service.js';
import type { SessionState } from '../data.js';
import { getSessionState, bindSession, unbindSession, getKnowledgeBase } from '../data.js';
import type { ProjectInfo } from '../data.js';

function separator(width = 50): string {
  return SEP.thin.repeat(width);
}

function truncate(text: string, max = 80): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}...`;
}

interface WorkbenchViewProps {
  project: ProjectInfo | null;
  contentWidth: number;
  viewportHeight: number;
  inputFocused: boolean;
}

export function WorkbenchView({ project, contentWidth, viewportHeight, inputFocused }: WorkbenchViewProps): React.ReactElement {
  const MAX_CHAT_MESSAGES = 100;
  const CHAT_GLOBAL_TIMEOUT_MS = 90_000;

  const [session, setSession] = useState<SessionState>({ status: 'unbound' });
  const [sessionLoading, setSessionLoading] = useState(false);
  const [knowledgeCount, setKnowledgeCount] = useState(0);
  const [chatMessages, setChatMessages] = useState<ChatTranscriptMessage[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [lastChat, setLastChat] = useState<ChatAnswer | null>(null);
  const chatViewRef = useRef<ChatViewRef>(null);
  const chatAbortRef = useRef<AbortController | null>(null);

  // Load session state on mount and project change
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const state = await getSessionState(project?.id);
      if (cancelled) return;
      setSession(state);

      // Also load knowledge count for context summary
      if (project) {
        const kb = await getKnowledgeBase(project.id);
        if (!cancelled) {
          setKnowledgeCount(kb?.stats.observationsUsed ?? 0);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [project]);

  const handleBind = useCallback(async () => {
    setSessionLoading(true);
    const result = await bindSession();
    setSession(result);
    setSessionLoading(false);
  }, []);

  const handleEnd = useCallback(async () => {
    if (!session.sessionId) return;
    setSessionLoading(true);
    const result = await unbindSession(session.sessionId);
    setSession(result);
    setSessionLoading(false);
  }, [session.sessionId]);

  const cancelChat = useCallback(() => {
    if (chatAbortRef.current) {
      chatAbortRef.current.abort('User cancelled');
      chatAbortRef.current = null;
    }
  }, []);

  // ── Keyboard: Enter triggers bind/end based on current status ──
  useInput((_ch, key) => {
    if (key.return && !inputFocused) {
      if (session.status === 'unbound' || session.status === 'error') {
        handleBind();
      } else if (session.status === 'bound') {
        handleEnd();
      }
    }
  });

  const submitChat = useCallback(async (question: string) => {
    const trimmed = question.trim();
    if (!trimmed) return;

    cancelChat();
    const ac = new AbortController();
    chatAbortRef.current = ac;
    const globalTimer = setTimeout(() => ac.abort('Chat timed out'), CHAT_GLOBAL_TIMEOUT_MS);

    const userMessage: ChatTranscriptMessage = {
      role: 'user',
      content: trimmed,
      timestamp: new Date().toISOString(),
    };
    const history = chatMessages.map((m) => ({ role: m.role, content: m.content }));

    setChatLoading(true);
    setChatMessages((prev) => {
      const next = [...prev, userMessage];
      return next.length > MAX_CHAT_MESSAGES ? next.slice(-MAX_CHAT_MESSAGES) : next;
    });

    const streamingMsg: ChatTranscriptMessage = {
      role: 'assistant',
      content: '',
      timestamp: new Date().toISOString(),
      meta: { usedLLM: true },
    };
    setChatMessages((prev) => {
      const next = [...prev, streamingMsg];
      return next.length > MAX_CHAT_MESSAGES ? next.slice(-MAX_CHAT_MESSAGES) : next;
    });

    try {
      const result = await askMemoryQuestionStream(trimmed, history, {
        onChunk: (text) => {
          setChatMessages((prev) => {
            const updated = [...prev];
            const lastIdx = updated.length - 1;
            if (lastIdx >= 0 && updated[lastIdx].role === 'assistant') {
              updated[lastIdx] = { ...updated[lastIdx], content: updated[lastIdx].content + text };
            }
            return updated;
          });
        },
        onToolCall: (name) => {
          setChatMessages((prev) => {
            const updated = [...prev];
            const lastIdx = updated.length - 1;
            if (lastIdx >= 0 && updated[lastIdx].role === 'assistant') {
              updated[lastIdx] = { ...updated[lastIdx], content: `Searching memories (${name})…` };
            }
            return updated;
          });
        },
      }, ac.signal);

      const assistantMessage: ChatTranscriptMessage = {
        role: 'assistant',
        content: result.answer,
        sources: result.sources,
        timestamp: new Date().toISOString(),
        error: false,
        meta: { usedLLM: result.usedLLM, searchMode: result.searchMode, llmModel: result.llmModel, warning: result.warning },
      };
      setLastChat(result);
      setChatMessages((prev) => {
        const updated = [...prev];
        const lastIdx = updated.length - 1;
        if (lastIdx >= 0 && updated[lastIdx].role === 'assistant') {
          updated[lastIdx] = assistantMessage;
        }
        return updated;
      });
    } catch (err) {
      const isCancelled = (err instanceof Error && err.message === 'User cancelled') ||
        (err instanceof DOMException && err.name === 'AbortError');
      const errorMsg: ChatTranscriptMessage = {
        role: 'assistant',
        content: isCancelled ? 'Chat cancelled.' : `Chat failed: ${err instanceof Error ? err.message : String(err)}`,
        error: !isCancelled,
        timestamp: new Date().toISOString(),
      };
      setChatMessages((prev) => {
        const updated = [...prev];
        const lastIdx = updated.length - 1;
        if (lastIdx >= 0 && updated[lastIdx].role === 'assistant') {
          updated[lastIdx] = errorMsg;
        }
        return updated;
      });
    } finally {
      clearTimeout(globalTimer);
      chatAbortRef.current = null;
      setChatLoading(false);
    }
  }, [chatMessages, cancelChat]);

  // Chat area height: 40% of viewport, at least 8 rows
  const chatHeight = Math.max(8, Math.floor(viewportHeight * 0.4));
  const sessionColor = session.status === 'bound' ? COLORS.success :
    session.status === 'error' ? COLORS.error :
    session.status === 'binding' ? COLORS.warning : COLORS.muted;

  return (
    <Box flexDirection="column" paddingX={1}>
      {/* Session bar */}
      <Box flexDirection="column" marginBottom={1}>
        <Box>
          <Text color={COLORS.brand} bold>Session</Text>
          <Box marginLeft={2}>
            <Text color={sessionColor}>
              {session.status === 'bound' ? `${STATUS_DOTS.running} Bound` :
               session.status === 'binding' ? `${STATUS_DOTS.warn} Binding…` :
               session.status === 'error' ? `${STATUS_DOTS.error} Error` :
               `${STATUS_DOTS.stopped} Unbound`}
            </Text>
          </Box>
          {session.sessionId && (
            <Text color={COLORS.muted}>  {session.sessionId.slice(0, 20)}</Text>
          )}
        </Box>
        <Text color={COLORS.border}>{separator()}</Text>

        {/* Session actions */}
        <Box marginTop={1}>
          {session.status === 'unbound' || session.status === 'error' ? (
            <Box>
              <Text color={COLORS.brand}>[Bind Session]</Text>
              <Text color={COLORS.muted}>  enter to start</Text>
            </Box>
          ) : session.status === 'bound' ? (
            <Box>
              <Text color={COLORS.warning}>[End Session]</Text>
              <Text color={COLORS.muted}>  enter to end</Text>
            </Box>
          ) : null}
          {sessionLoading && <Text color={COLORS.muted}>  working…</Text>}
        </Box>

        {session.status === 'error' && session.error && (
          <Box marginTop={1}>
            <Text color={COLORS.error}>  {truncate(session.error, 100)}</Text>
          </Box>
        )}
      </Box>

      {/* Context sources summary */}
      <Box flexDirection="column" marginBottom={1}>
        <Text color={COLORS.brandDim} bold>Context Sources</Text>
        <Text color={COLORS.border}>{separator()}</Text>
        <Box>
          <Text color={COLORS.muted}>Knowledge items: </Text>
          <Text color={COLORS.text}>{knowledgeCount}</Text>
        </Box>
        {session.context && (
          <Box>
            <Text color={COLORS.muted}>Last handoff: </Text>
            <Text color={COLORS.textDim}>{truncate(session.context.split('\n')[0] || '(empty)', 60)}</Text>
          </Box>
        )}
        {lastChat && (
          <Box>
            <Text color={COLORS.muted}>Last chat: </Text>
            <Text color={COLORS.textDim}>
              {lastChat.usedLLM ? `LLM (${lastChat.llmModel || '?'})` : 'Local search'}
              {lastChat.sources && ` · ${lastChat.sources.length} sources`}
            </Text>
          </Box>
        )}
        {session.status === 'bound' && (
          <Box marginTop={1}>
            <Text color={COLORS.textDim}>
              Session bound — knowledge context loaded. Chat below uses memory + knowledge.
            </Text>
          </Box>
        )}
      </Box>

      {/* Chat area */}
      <Box flexDirection="column" height={chatHeight}>
        <Text color={COLORS.brandDim} bold>Chat</Text>
        <Box flexGrow={1} flexShrink={1}>
          <ChatView
            ref={chatViewRef}
            project={project}
            messages={chatMessages}
            loading={chatLoading}
            contentWidth={contentWidth}
            viewportHeight={chatHeight}
            threadId="workbench"
            keyboardScrollEnabled={true}
          />
        </Box>
      </Box>
    </Box>
  );
}
