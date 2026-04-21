import { compactDetail, compactSearch } from '../../compact/engine.js';
import { loadDotenv } from '../../config/dotenv-loader.js';
import { initLLM, isLLMEnabled, getLLMConfig, callLLMWithTools } from '../../llm/provider.js';
import type { ChatMessage, ToolDefinition, ToolCall } from '../../llm/provider.js';
import { initObservations, storeObservation, resolveObservations, getObservation, getAllObservations } from '../../memory/observations.js';
import type { ObservationType } from '../../types.js';
import { detectProject } from '../../project/detector.js';
import { initObservationStore } from '../../store/obs-store.js';
import { getDb, getLastSearchMode, hydrateIndex } from '../../store/orama-store.js';
import { getProjectDataDir } from '../../store/persistence.js';
import type { MemorixDocument } from '../../types.js';

export interface ChatHistoryTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatSource {
  id: number;
  title: string;
  type: string;
  entityName: string;
  excerpt: string;
  score: number;
  createdAt?: string;
}

export interface ChatAnswer {
  question: string;
  answer: string;
  sources: ChatSource[];
  usedLLM: boolean;
  llmModel?: string;
  searchMode: string;
  warning?: string;
  toolCallsCount?: number;
}

const SEARCH_LIMIT = 6;
const DETAIL_LIMIT = 4;
const HISTORY_LIMIT = 8;
const MAX_TOOL_ROUNDS = 5;

// ── Tool definitions (harness pattern) ────────────────────────────

const MEMORY_TOOLS: ToolDefinition[] = [
  {
    name: 'search_memories',
    description: 'Search the project memory knowledge base for relevant decisions, bugs, architecture notes, gotchas, or other engineering context. Use this when the user asks about project history, design rationale, known issues, or technical details.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query — keywords or natural language describing what to find' },
        limit: { type: 'number', description: 'Maximum results to return (default 6, max 10)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_memory_detail',
    description: 'Retrieve the full narrative and facts of a specific memory observation by its ID. Use this after search_memories when you need more context about a specific result.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'The observation ID (e.g. the number from obs:42)' },
      },
      required: ['id'],
    },
  },
  {
    name: 'store_memory',
    description: 'Store a new memory observation to the project knowledge base. Use this when the user wants to save a decision, gotcha, bug fix, architecture note, or any engineering context worth remembering.',
    parameters: {
      type: 'object',
      properties: {
        entityName: { type: 'string', description: 'The entity this observation belongs to (e.g. "auth-module", "database-schema")' },
        type: { type: 'string', description: 'Observation type: gotcha, decision, problem-solution, how-it-works, what-changed, discovery, why-it-exists, trade-off, reasoning', enum: ['gotcha', 'decision', 'problem-solution', 'how-it-works', 'what-changed', 'discovery', 'why-it-exists', 'trade-off', 'reasoning'] },
        title: { type: 'string', description: 'Short descriptive title (5-10 words)' },
        narrative: { type: 'string', description: 'Full description of the observation' },
        facts: { type: 'array', items: { type: 'string' }, description: 'Key facts as structured strings (e.g. "Default timeout: 60s")' },
      },
      required: ['entityName', 'type', 'title', 'narrative'],
    },
  },
  {
    name: 'update_memory',
    description: 'Update an existing memory observation by its ID. Use this when the user wants to modify or add to an existing memory. Provide the ID and the fields to update.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'The observation ID to update' },
        narrative: { type: 'string', description: 'New or appended narrative text' },
        facts: { type: 'array', items: { type: 'string' }, description: 'New facts to add' },
        append: { type: 'boolean', description: 'If true, append to existing narrative/facts instead of replacing (default: true)' },
      },
      required: ['id', 'narrative'],
    },
  },
  {
    name: 'delete_memory',
    description: 'Delete/archive a memory observation by marking it as resolved. Use this when the user wants to remove outdated or incorrect memories.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'The observation ID to delete/archive' },
        reason: { type: 'string', description: 'Reason for deletion (stored for audit trail)' },
      },
      required: ['id'],
    },
  },
  {
    name: 'list_recent_memories',
    description: 'List recent memory observations for the project. Use this when the user wants to see what has been stored recently or browse the knowledge base.',
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Maximum results to return (default 10, max 20)' },
        type: { type: 'string', description: 'Filter by observation type (optional)' },
      },
    },
  },
];

const SYSTEM_PROMPT = [
  'You are Memorix, a memory-grounded AI assistant for a software project.',
  'You have access to the project\'s memory knowledge base via tools.',
  '',
  'Behavior guidelines:',
  '- For casual conversation (greetings, small talk, meta questions), respond naturally WITHOUT calling any tools.',
  '- When the user asks about project decisions, architecture, bugs, rationale, recent changes, or technical details, use search_memories to find relevant context.',
  '- If initial search results are sparse, try a different query or use get_memory_detail on promising results.',
  '- When the user wants to SAVE information (decisions, gotchas, fixes, notes), use store_memory to persist it.',
  '- When the user wants to UPDATE existing memories, use update_memory with the observation ID.',
  '- When the user wants to DELETE outdated memories, use delete_memory to archive them.',
  '- When the user wants to BROWSE recent memories, use list_recent_memories.',
  '- Always cite supporting memories inline as [obs:<id>].',
  '- Do not invent memories, IDs, files, or decisions that are not in the retrieved context.',
  '- If the retrieved context is insufficient, say so explicitly and suggest what to store.',
  '- Prefer concise, practical answers for engineers revisiting project history.',
].join('\n');

// ── Helpers ─────────────────────────────────────────────────────────

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

function buildExcerpt(doc: MemorixDocument): string {
  const combined = [doc.narrative, doc.facts]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!combined) return 'No narrative available.';
  return truncate(combined, 180);
}

function toSource(doc: MemorixDocument, score: number): ChatSource {
  return {
    id: doc.observationId,
    title: doc.title || '(untitled)',
    type: doc.type || 'discovery',
    entityName: doc.entityName || '',
    excerpt: buildExcerpt(doc),
    score,
    createdAt: doc.createdAt,
  };
}

function buildFallbackAnswer(question: string, sources: ChatSource[], warning?: string): string {
  if (sources.length === 0) {
    return [
      warning || 'I could not find relevant project memories for that question.',
      `Question: ${question}`,
      'Try /search with narrower terms, or store the missing context first.',
    ].join('\n');
  }

  const lines = [
    warning || 'LLM chat is not configured, so here are the most relevant project memories I found:',
    '',
    ...sources.map((source) => `- [obs:${source.id}] ${source.title} — ${source.excerpt}`),
  ];

  return lines.join('\n');
}

function normalizeSearchMode(raw: string): string {
  if (raw.includes('vector')) return 'vector';
  if (raw.includes('rerank')) return 'rerank';
  if (raw.includes('hybrid')) return 'hybrid';
  return 'fulltext';
}

/** Track which projectIds have already been prepared to avoid redundant loadAll(). */
const preparedProjects = new Set<string>();

async function prepareProjectSearch(projectId: string, dataDir: string): Promise<void> {
  if (preparedProjects.has(projectId)) return;

  await initObservationStore(dataDir);
  await initObservations(dataDir);      // loads observations into memory once
  await getDb();
  // Use the already-loaded in-memory observations (from initObservations)
  // instead of calling loadAll() a second time.
  const allObs = getAllObservations() as any[];
  await hydrateIndex(allObs);           // idempotent: skips if index already populated
  preparedProjects.add(projectId);
}

// ── Tool execution ──────────────────────────────────────────────────

interface ToolExecutionContext {
  projectId: string;
  collectedSources: ChatSource[];
}

function executeSearchMemories(args: { query: string; limit?: number }, ctx: ToolExecutionContext): Promise<string> {
  const limit = Math.min(args.limit ?? SEARCH_LIMIT, 10);
  return compactSearch({ query: args.query, limit, projectId: ctx.projectId, status: 'active' })
    .then((result) => {
      const entries = result.entries.slice(0, DETAIL_LIMIT);
      if (entries.length === 0) return 'No memories found for that query.';

      // Collect sources for citation tracking
      const refs = entries.map((e) => ({ id: e.id, projectId: ctx.projectId }));
      return compactDetail(refs).then((detail) => {
        for (let i = 0; i < detail.documents.length; i++) {
          const doc = detail.documents[i];
          const score = entries[i]?.score ?? 0;
          ctx.collectedSources.push(toSource(doc, score));
        }
        return detail.documents.map((doc) =>
          `[obs:${doc.observationId}] ${doc.title}\n  Type: ${doc.type} | Entity: ${doc.entityName}\n  ${truncate(doc.narrative || doc.facts || 'No details', 200)}`,
        ).join('\n\n');
      });
    })
    .catch((err) => `Search error: ${err instanceof Error ? err.message : String(err)}`);
}

function executeGetMemoryDetail(args: { id: number }, ctx: ToolExecutionContext): Promise<string> {
  return compactDetail([{ id: args.id, projectId: ctx.projectId }])
    .then((detail) => {
      if (detail.documents.length === 0) return `Observation ${args.id} not found.`;
      const doc = detail.documents[0];
      ctx.collectedSources.push(toSource(doc, 1.0));
      return [
        `[obs:${doc.observationId}] ${doc.title}`,
        `Type: ${doc.type}`,
        `Entity: ${doc.entityName}`,
        doc.narrative ? `Narrative: ${doc.narrative}` : '',
        doc.facts ? `Facts: ${doc.facts}` : '',
        doc.filesModified ? `Files: ${doc.filesModified}` : '',
        doc.concepts ? `Concepts: ${doc.concepts}` : '',
        doc.createdAt ? `Created: ${doc.createdAt}` : '',
      ].filter(Boolean).join('\n');
    })
    .catch((err) => `Detail error: ${err instanceof Error ? err.message : String(err)}`);
}

async function executeToolCall(tc: ToolCall, ctx: ToolExecutionContext): Promise<string> {
  let args: Record<string, unknown>;
  try {
    args = JSON.parse(tc.arguments);
  } catch {
    return `Error: invalid JSON arguments for tool ${tc.name}`;
  }

  switch (tc.name) {
    case 'search_memories':
      return executeSearchMemories(args as { query: string; limit?: number }, ctx);
    case 'get_memory_detail':
      return executeGetMemoryDetail(args as { id: number }, ctx);
    case 'store_memory':
      return executeStoreMemory(args as { entityName: string; type: string; title: string; narrative: string; facts?: string[] }, ctx);
    case 'update_memory':
      return executeUpdateMemory(args as { id: number; narrative: string; facts?: string[]; append?: boolean }, ctx);
    case 'delete_memory':
      return executeDeleteMemory(args as { id: number; reason?: string }, ctx);
    case 'list_recent_memories':
      return executeListRecentMemories(args as { limit?: number; type?: string }, ctx);
    default:
      return `Unknown tool: ${tc.name}`;
  }
}

function executeStoreMemory(
  args: { entityName: string; type: string; title: string; narrative: string; facts?: string[] },
  ctx: ToolExecutionContext,
): Promise<string> {
  const validTypes: ObservationType[] = ['gotcha', 'decision', 'problem-solution', 'how-it-works', 'what-changed', 'discovery', 'why-it-exists', 'trade-off', 'reasoning', 'session-request'];
  const type = validTypes.includes(args.type as ObservationType) ? args.type as ObservationType : 'discovery';

  return storeObservation({
    entityName: args.entityName,
    type,
    title: args.title,
    narrative: args.narrative,
    facts: args.facts,
    projectId: ctx.projectId,
    source: 'agent',
  }).then((result) => {
    const obs = result.observation;
    ctx.collectedSources.push({
      id: obs.id,
      title: obs.title,
      type: obs.type,
      entityName: obs.entityName,
      excerpt: truncate(obs.narrative, 180),
      score: 1.0,
    });
    return `Stored observation [obs:${obs.id}] "${obs.title}" (${type}, entity: ${args.entityName})${result.upserted ? ' [updated existing via topicKey]' : ''}`;
  }).catch((err) => `Error storing memory: ${err instanceof Error ? err.message : String(err)}`);
}

function executeUpdateMemory(
  args: { id: number; narrative: string; facts?: string[]; append?: boolean },
  ctx: ToolExecutionContext,
): string {
  const obs = getObservation(args.id, ctx.projectId);
  if (!obs) return `Observation ${args.id} not found.`;

  const shouldAppend = args.append !== false; // default true
  const newNarrative = shouldAppend
    ? `${obs.narrative}\n\n${args.narrative}`
    : args.narrative;
  const newFacts = shouldAppend && obs.facts
    ? [...obs.facts, ...(args.facts ?? [])]
    : args.facts ?? obs.facts;

  // Use storeObservation with topicKey for upsert
  storeObservation({
    entityName: obs.entityName,
    type: obs.type,
    title: obs.title,
    narrative: newNarrative,
    facts: newFacts,
    projectId: ctx.projectId,
    topicKey: obs.topicKey,
    source: 'agent',
  }).catch(() => {/* non-blocking */});

  return `Updated observation [obs:${args.id}] — ${shouldAppend ? 'appended to' : 'replaced'} narrative${args.facts?.length ? ` and added ${args.facts.length} facts` : ''}. Changes will be persisted asynchronously.`;
}

function executeDeleteMemory(
  args: { id: number; reason?: string },
  ctx: ToolExecutionContext,
): Promise<string> {
  const obs = getObservation(args.id, ctx.projectId);
  if (!obs) return Promise.resolve(`Observation ${args.id} not found.`);

  return resolveObservations([args.id], 'resolved')
    .then((result) => {
      if (result.resolved.includes(args.id)) {
        return `Archived observation [obs:${args.id}] "${obs.title}"${args.reason ? ` — reason: ${args.reason}` : ''}`;
      }
      return `Could not archive observation ${args.id} (not found or already resolved)`;
    })
    .catch((err) => `Error deleting memory: ${err instanceof Error ? err.message : String(err)}`);
}

function executeListRecentMemories(
  args: { limit?: number; type?: string },
  ctx: ToolExecutionContext,
): string {
  const limit = Math.min(args.limit ?? 10, 20);
  let allObs = getAllObservations()
    .filter(o => o.projectId === ctx.projectId && o.status !== 'archived' && o.status !== 'resolved');

  if (args.type) {
    allObs = allObs.filter(o => o.type === args.type);
  }

  // Sort by creation date, most recent first
  allObs.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  const recent = allObs.slice(0, limit);

  if (recent.length === 0) {
    return args.type ? `No ${args.type} memories found.` : 'No memories found for this project.';
  }

  return recent.map(o =>
    `[obs:${o.id}] ${o.title}\n  Type: ${o.type} | Entity: ${o.entityName} | ${o.createdAt?.slice(0, 10) || '?'}`
  ).join('\n\n');
}

// ── Agentic harness loop ────────────────────────────────────────────

export async function askMemoryQuestion(
  question: string,
  history: ChatHistoryTurn[] = [],
): Promise<ChatAnswer> {
  const trimmedQuestion = question.trim();
  if (!trimmedQuestion) {
    return {
      question: '',
      answer: 'Ask a question about your project memories.',
      sources: [],
      usedLLM: false,
      searchMode: 'fulltext',
      warning: 'Empty question.',
    };
  }

  const project = detectProject(process.cwd());

  // No project + no LLM → dead end
  if (!project) {
    loadDotenv(process.cwd());
    initLLM();
    if (!isLLMEnabled()) {
      return {
        question: trimmedQuestion,
        answer: 'No project detected. Open Memorix inside a git repository to chat with project memories.',
        sources: [],
        usedLLM: false,
        searchMode: 'fulltext',
        warning: 'No project detected.',
      };
    }

    // No project but LLM available → chat without memory tools
    const messages: ChatMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT + '\n\nNote: No project is currently detected. You can chat normally, but memory search tools are not available. Suggest the user run Memorix inside a git repository to enable memory features.' },
    ];
    const recentHistory = history.slice(-HISTORY_LIMIT);
    for (const turn of recentHistory) {
      messages.push({ role: turn.role, content: turn.content });
    }
    messages.push({ role: 'user', content: trimmedQuestion });

    const response = await callLLMWithTools(messages, []);
    return {
      question: trimmedQuestion,
      answer: response.content.trim() || 'I could not generate a response.',
      sources: [],
      usedLLM: true,
      llmModel: getLLMConfig()?.model,
      searchMode: 'fulltext',
      warning: 'No project detected — memory tools unavailable.',
    };
  }

  loadDotenv(project.rootPath);
  initLLM();

  const dataDir = await getProjectDataDir(project.id);
  await prepareProjectSearch(project.id, dataDir);

  const searchMode = normalizeSearchMode(getLastSearchMode(project.id) || 'fulltext');

  // LLM not configured — legacy fallback
  if (!isLLMEnabled()) {
    const searchResult = await compactSearch({
      query: trimmedQuestion,
      limit: SEARCH_LIMIT,
      projectId: project.id,
      status: 'active',
    });
    const topEntries = searchResult.entries.slice(0, DETAIL_LIMIT);
    const detailRefs = topEntries.map((entry) => ({ id: entry.id, projectId: project.id }));
    const detailResult = detailRefs.length > 0
      ? await compactDetail(detailRefs)
      : { documents: [], formatted: '', totalTokens: 0 };
    const sources = detailResult.documents.map((doc, index) => toSource(doc, topEntries[index]?.score ?? 0));

    return {
      question: trimmedQuestion,
      answer: buildFallbackAnswer(trimmedQuestion, sources),
      sources,
      usedLLM: false,
      searchMode,
      warning: sources.length === 0 ? 'No relevant memories found.' : 'LLM not configured.',
    };
  }

  // ── Agentic harness loop ──────────────────────────────────────
  // Build the message history for the LLM
  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
  ];

  // Inject recent conversation history
  const recentHistory = history.slice(-HISTORY_LIMIT);
  for (const turn of recentHistory) {
    messages.push({ role: turn.role, content: turn.content });
  }

  // Add the current user question
  messages.push({ role: 'user', content: trimmedQuestion });

  const ctx: ToolExecutionContext = {
    projectId: project.id,
    collectedSources: [],
  };

  let totalToolCalls = 0;
  let finalContent = '';

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await callLLMWithTools(messages, MEMORY_TOOLS);

    // No tool calls — LLM is done, return its text response
    if (response.toolCalls.length === 0) {
      finalContent = response.content.trim();
      break;
    }

    // LLM requested tool calls — execute them and feed results back
    totalToolCalls += response.toolCalls.length;

    // Add the assistant's message (with tool calls) to the conversation
    messages.push({
      role: 'assistant',
      content: response.content,
      toolCalls: response.toolCalls,
    });

    // Execute each tool call and add results
    for (const tc of response.toolCalls) {
      const result = await executeToolCall(tc, ctx);
      messages.push({
        role: 'tool',
        content: result,
        toolCallId: tc.id,
        name: tc.name,
      });
    }

    // If this is the last allowed round, force a final answer
    if (round === MAX_TOOL_ROUNDS - 1) {
      const finalResponse = await callLLMWithTools(messages, []); // no tools = force text answer
      finalContent = finalResponse.content.trim();
      break;
    }
  }

  // Deduplicate sources by ID
  const seenIds = new Set<number>();
  const sources = ctx.collectedSources.filter((s) => {
    if (seenIds.has(s.id)) return false;
    seenIds.add(s.id);
    return true;
  });

  return {
    question: trimmedQuestion,
    answer: finalContent || buildFallbackAnswer(trimmedQuestion, sources, 'The LLM returned an empty answer.'),
    sources,
    usedLLM: true,
    llmModel: getLLMConfig()?.model,
    searchMode,
    toolCallsCount: totalToolCalls,
  };
}

// ── Streaming version ──────────────────────────────────────────────

export interface StreamingChatCallbacks {
  /** Called for each text chunk from the LLM */
  onChunk?: (text: string) => void;
  /** Called when a tool is being executed */
  onToolCall?: (name: string, args: string) => void;
}

/**
 * Streaming version of askMemoryQuestion.
 * Uses onChunk callback to deliver the LLM response to the UI.
 * Currently uses non-streaming API calls for reliability;
 * streaming can be enabled later when SSE parsing is hardened.
 */
export async function askMemoryQuestionStream(
  question: string,
  history: ChatHistoryTurn[] = [],
  callbacks?: StreamingChatCallbacks,
  signal?: AbortSignal,
): Promise<ChatAnswer> {
  const trimmedQuestion = question.trim();
  if (!trimmedQuestion) {
    return {
      question: '',
      answer: 'Ask a question about your project memories.',
      sources: [],
      usedLLM: false,
      searchMode: 'fulltext',
      warning: 'Empty question.',
    };
  }

  const project = detectProject(process.cwd());

  // No project + no LLM → dead end
  if (!project) {
    loadDotenv(process.cwd());
    initLLM();
    if (!isLLMEnabled()) {
      return {
        question: trimmedQuestion,
        answer: 'No project detected. Open Memorix inside a git repository to chat with project memories.',
        sources: [],
        usedLLM: false,
        searchMode: 'fulltext',
        warning: 'No project detected.',
      };
    }

    // No project but LLM available — use non-streaming for reliability
    const messages: ChatMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT + '\n\nNote: No project is currently detected. You can chat normally, but memory search tools are not available.' },
    ];
    const recentHistory = history.slice(-HISTORY_LIMIT);
    for (const turn of recentHistory) {
      messages.push({ role: turn.role, content: turn.content });
    }
    messages.push({ role: 'user', content: trimmedQuestion });

    const response = await callLLMWithTools(messages, [], signal);
    const fullContent = response.content.trim();
    callbacks?.onChunk?.(fullContent);

    return {
      question: trimmedQuestion,
      answer: fullContent || 'I could not generate a response.',
      sources: [],
      usedLLM: true,
      llmModel: getLLMConfig()?.model,
      searchMode: 'fulltext',
      warning: 'No project detected — memory tools unavailable.',
    };
  }

  loadDotenv(project.rootPath);
  initLLM();

  const dataDir = await getProjectDataDir(project.id);
  await prepareProjectSearch(project.id, dataDir);

  const searchMode = normalizeSearchMode(getLastSearchMode(project.id) || 'fulltext');

  // LLM not configured — legacy fallback (no streaming possible)
  if (!isLLMEnabled()) {
    const searchResult = await compactSearch({
      query: trimmedQuestion,
      limit: SEARCH_LIMIT,
      projectId: project.id,
      status: 'active',
    });
    const topEntries = searchResult.entries.slice(0, DETAIL_LIMIT);
    const detailRefs = topEntries.map((entry) => ({ id: entry.id, projectId: project.id }));
    const detailResult = detailRefs.length > 0
      ? await compactDetail(detailRefs)
      : { documents: [], formatted: '', totalTokens: 0 };
    const sources = detailResult.documents.map((doc, index) => toSource(doc, topEntries[index]?.score ?? 0));

    return {
      question: trimmedQuestion,
      answer: buildFallbackAnswer(trimmedQuestion, sources),
      sources,
      usedLLM: false,
      searchMode,
      warning: sources.length === 0 ? 'No relevant memories found.' : 'LLM not configured.',
    };
  }

  // ── Agentic harness loop with streaming final answer ──────────
  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
  ];

  const recentHistory = history.slice(-HISTORY_LIMIT);
  for (const turn of recentHistory) {
    messages.push({ role: turn.role, content: turn.content });
  }
  messages.push({ role: 'user', content: trimmedQuestion });

  const ctx: ToolExecutionContext = {
    projectId: project.id,
    collectedSources: [],
  };

  let totalToolCalls = 0;
  let finalContent = '';

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    signal?.throwIfAborted();
    const response = await callLLMWithTools(messages, MEMORY_TOOLS, signal);

    // No tool calls — LLM is done, deliver the answer
    if (response.toolCalls.length === 0) {
      finalContent = response.content.trim();
      // Deliver the full content via onChunk for UI update
      callbacks?.onChunk?.(finalContent);
      break;
    }

    // LLM requested tool calls — execute them and feed results back
    totalToolCalls += response.toolCalls.length;

    messages.push({
      role: 'assistant',
      content: response.content,
      toolCalls: response.toolCalls,
    });

    for (const tc of response.toolCalls) {
      signal?.throwIfAborted();
      callbacks?.onToolCall?.(tc.name, tc.arguments);
      const result = await executeToolCall(tc, ctx);
      messages.push({
        role: 'tool',
        content: result,
        toolCallId: tc.id,
        name: tc.name,
      });
    }

    // If this is the last allowed round, force a final answer
    if (round === MAX_TOOL_ROUNDS - 1) {
      const finalResponse = await callLLMWithTools(messages, [], signal);
      finalContent = finalResponse.content.trim();
      callbacks?.onChunk?.(finalContent);
      break;
    }
  }

  // Deduplicate sources by ID
  const seenIds = new Set<number>();
  const sources = ctx.collectedSources.filter((s) => {
    if (seenIds.has(s.id)) return false;
    seenIds.add(s.id);
    return true;
  });

  return {
    question: trimmedQuestion,
    answer: finalContent || buildFallbackAnswer(trimmedQuestion, sources, 'The LLM returned an empty answer.'),
    sources,
    usedLLM: true,
    llmModel: getLLMConfig()?.model,
    searchMode,
    toolCallsCount: totalToolCalls,
  };
}
